/* Replicode Figma clipboard interceptor.
 *
 * Runs in the MAIN world of *.figma.com and *.figjam.com so it can
 * monkey-patch navigator.clipboard.write and observe copy events
 * before the browser sanitizes the clipboard. Intended only for
 * reverse-engineering Figma's proprietary clipboard format during
 * development of Replicode's Figma export path; gated behind a
 * localStorage flag so it never runs for normal users.
 *
 * Activate from Figma's DevTools console:
 *   localStorage.replicodeFigmaIntercept = "on"
 * Then reload the page and press ⌘C on a selection. Captured
 * payloads are logged and auto-downloaded as figma-write-<mime>.bin
 * (or figma-decoded-from-html.bin when smuggled via figmeta).
 *
 * Deactivate:
 *   delete localStorage.replicodeFigmaIntercept
 */

;(() => {
  if (typeof window === "undefined") return
  try {
    if (window.__replicodeFigmaInterceptInstalled) return
    if (localStorage.getItem("replicodeFigmaIntercept") !== "on") return
    window.__replicodeFigmaInterceptInstalled = true
  } catch {
    // localStorage might be blocked (incognito, etc.); bail silently.
    return
  }

  const STORE_KEY = "__replicodeFigmaIntercept"
  window[STORE_KEY] = window[STORE_KEY] || {}

  function hexHead(bytes, count) {
    const n = Math.min(count || 64, bytes.length)
    return Array.from(bytes.slice(0, n))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ")
  }

  function downloadBytes(name, bytes) {
    try {
      const a = document.createElement("a")
      a.href = URL.createObjectURL(new Blob([bytes]))
      a.download = name
      a.click()
    } catch (e) {
      console.warn("[replicode] download failed:", name, e.message)
    }
  }

  // ── Hook navigator.clipboard.write ─────────────────────────────────
  if (navigator.clipboard && typeof navigator.clipboard.write === "function") {
    const origWrite = navigator.clipboard.write.bind(navigator.clipboard)
    navigator.clipboard.write = async function (items) {
      try {
        console.log("[replicode] clipboard.write —", items.length, "item(s)")
        for (let i = 0; i < items.length; i += 1) {
          const item = items[i]
          console.log("[replicode] item", i, "types:", item.types)
          for (const t of item.types) {
            try {
              const blob = await item.getType(t)
              const buf = new Uint8Array(await blob.arrayBuffer())
              window[STORE_KEY][t] = buf
              console.log(
                "[replicode]",
                t, "—", buf.length, "bytes; first 64:", hexHead(buf, 64)
              )
              if (t !== "image/png") {
                downloadBytes("figma-write-" + t.replace(/[^\w]/g, "_") + ".bin", buf)
              }
            } catch (err) {
              console.warn("[replicode] inspect failed for", t, err.message)
            }
          }
        }
      } catch (err) {
        console.warn("[replicode] interceptor error:", err.message)
      }
      return origWrite(items)
    }
  }

  // ── Listen on the legacy copy event ────────────────────────────────
  document.addEventListener("copy", (event) => {
    if (!event.clipboardData) return
    try {
      console.log("[replicode] copy event types:", event.clipboardData.types)
      for (const t of event.clipboardData.types) {
        const data = event.clipboardData.getData(t)
        if (!data) continue
        window[STORE_KEY]["copyEvent_" + t] = data
        console.log(
          "[replicode] copy event " + t + " —", data.length,
          "chars; first 300:", data.slice(0, 300)
        )
        if (t === "text/html") {
          const figmeta = data.match(/<!--\(figmeta\)([A-Za-z0-9+/=]+)\(\/figmeta\)-->/i)
            || data.match(/<!--\(figma\)([A-Za-z0-9+/=]+)\(\/figma\)-->/i)
            || data.match(/<!--\(buffer\)([A-Za-z0-9+/=]+)\(\/buffer\)-->/i)
          if (figmeta) {
            console.log(
              "[replicode] figma-encoded payload found in text/html —",
              figmeta[1].length, "base64 chars"
            )
            try {
              const decoded = atob(figmeta[1])
              const bytes = new Uint8Array(decoded.length)
              for (let j = 0; j < decoded.length; j += 1) bytes[j] = decoded.charCodeAt(j)
              window[STORE_KEY].__decoded_html = bytes
              downloadBytes("figma-decoded-from-html.bin", bytes)
              console.log(
                "[replicode] decoded", bytes.length, "bytes; first 64:",
                hexHead(bytes, 64)
              )
            } catch (err) {
              console.warn("[replicode] base64 decode failed:", err.message)
            }
          }
        }
      }
    } catch (err) {
      console.warn("[replicode] copy listener error:", err.message)
    }
  }, true)

  // ── Listen on paste events (diagnose Replicode→Figma round-trip) ──
  // When the user ⌘V's into Figma, the browser fires a `paste` event
  // before Figma's own handler. We log every MIME type Figma sees
  // and try to extract the (figma) base64 block. If our writer's
  // payload survives Chrome's clipboard sanitization, the bytes here
  // will start with "fig-kiwi". If they don't, Chrome mangled the
  // HTML in transit.
  document.addEventListener("paste", (event) => {
    if (!event.clipboardData) return
    try {
      console.log(
        "[replicode] PASTE event — types:", event.clipboardData.types,
        "target:", event.target && (event.target.tagName + (event.target.id ? "#" + event.target.id : ""))
      )
      for (const t of event.clipboardData.types) {
        const data = event.clipboardData.getData(t)
        if (!data) continue
        window[STORE_KEY]["pasteEvent_" + t] = data
        console.log(
          "[replicode] paste " + t + " —", data.length, "chars/bytes; first 400:",
          data.slice(0, 400)
        )
        if (t === "text/html") {
          const meta = data.match(/<!--\(figmeta\)([A-Za-z0-9+/=]+)\(\/figmeta\)-->/i)
          const buf = data.match(/<!--\(figma\)([A-Za-z0-9+/=]+)\(\/figma\)-->/i)
          if (meta) {
            try {
              const j = JSON.parse(atob(meta[1]))
              console.log("[replicode] paste figmeta:", j)
            } catch (err) {
              console.warn("[replicode] paste figmeta decode failed:", err.message)
            }
          } else {
            console.warn("[replicode] paste text/html does NOT contain a (figmeta) block — Chrome may have stripped the comment")
          }
          if (buf) {
            try {
              const decoded = atob(buf[1])
              const bytes = new Uint8Array(decoded.length)
              for (let j = 0; j < decoded.length; j += 1) bytes[j] = decoded.charCodeAt(j)
              window[STORE_KEY].__paste_decoded = bytes
              const head = String.fromCharCode.apply(null, bytes.slice(0, 8))
              console.log(
                "[replicode] paste figma block —", bytes.length,
                "bytes; magic:", JSON.stringify(head),
                "first 32 hex:", hexHead(bytes, 32)
              )
              downloadBytes("figma-paste-received.bin", bytes)
            } catch (err) {
              console.warn("[replicode] paste figma block decode failed:", err.message)
            }
          } else {
            console.warn("[replicode] paste text/html does NOT contain a (figma) block — Chrome may have stripped the comment")
          }
        }
      }
    } catch (err) {
      console.warn("[replicode] paste listener error:", err.message)
    }
  }, true)

  console.log(
    "[replicode] Figma clipboard interceptor armed. Press ⌘C on a selection — " +
    "captured payloads will be logged + downloaded. ⌘V (paste) is also " +
    "intercepted now: paste events are logged + the figma block is " +
    "extracted and downloaded as figma-paste-received.bin. window." +
    STORE_KEY + " holds the latest set."
  )
})()

/* global window */
;(() => {
  // ──────────────────────────────────────────────────────────────────
  // Replicode → Figma clipboard writer (Phase 2 round-trip foundation)
  //
  // Produces the same `text/html` clipboard payload Figma's web app
  // writes when you press ⌘C on a frame: an HTML wrapper containing
  // <!--(figmeta)…(/figmeta)--> JSON metadata and <!--(figma)…(/figma)-->
  // base64-encoded kiwi-binary scene graph. Pasted into Figma it
  // reconstructs the source scene with auto-layout, text ranges, native
  // vectors, gradients — same fidelity as a cross-Figma copy/paste, no
  // plugin install.
  //
  // What ships in this milestone:
  //   * kiwi byte writer + primitives (varuint/varint/string/etc.)
  //   * the captured 30,731-byte raw-deflate schema chunk, embedded
  //     verbatim and base64-encoded — paste compatibility doesn't need
  //     us to re-emit Figma's schema, only to ship a cached one
  //   * a captured "Document/Page/Frame/Text" scene fixture, also
  //     embedded — the writer can echo this byte-for-byte to prove the
  //     end-to-end round-trip (paste-tested first)
  //   * a "store-only" zstd frame wrapper (no actual compression)
  //   * the kiwi container layout: magic + flag + reserved + chunk
  //     length-prefixes
  //   * the HTML envelope with figmeta + figma comment blocks
  //   * `buildFigmaClipboardHtml(capture)` returning the clipboard
  //     string, falling back to null when the writer can't synthesise
  //     a payload from a particular capture (caller falls back to JSON)
  //
  // What still needs encoding work (next iterations):
  //   * Full Replicode-capture → NodeChange[] mapping that emits real
  //     scene graphs from arbitrary captures — for now the writer
  //     emits the captured fixture with patched metadata so we can
  //     verify Figma accepts the round-trip end-to-end before
  //     investing in the full schema port.
  //
  // Format reference: figma-clipboard-spec.md
  // ──────────────────────────────────────────────────────────────────

  if (typeof window === "undefined") return

  // ── 1. Byte writer ────────────────────────────────────────────────
  function createByteWriter(initialCapacity) {
    const cap = Math.max(64, initialCapacity || 256)
    let buffer = new Uint8Array(cap)
    let length = 0

    function ensure(extra) {
      if (length + extra <= buffer.length) return
      let next = buffer.length * 2
      while (next < length + extra) next *= 2
      const grown = new Uint8Array(next)
      grown.set(buffer.subarray(0, length))
      buffer = grown
    }

    return {
      writeByte(b) { ensure(1); buffer[length++] = b & 0xff },
      writeBytes(bytes) {
        ensure(bytes.length)
        buffer.set(bytes, length)
        length += bytes.length
      },
      toUint8Array() { return buffer.slice(0, length) },
      get length() { return length }
    }
  }

  // ── 2. Kiwi primitives ────────────────────────────────────────────
  // https://github.com/evanw/kiwi#binary-format
  function writeVarUint(w, value) {
    let v = value >>> 0
    while (v >= 0x80) {
      w.writeByte((v & 0x7f) | 0x80)
      v >>>= 7
    }
    w.writeByte(v & 0x7f)
  }
  function writeVarInt(w, value) {
    const n = value | 0
    writeVarUint(w, ((n << 1) ^ (n >> 31)) >>> 0)
  }
  function writeBool(w, value) { w.writeByte(value ? 0x01 : 0x00) }
  function writeFloat32(w, value) {
    const ab = new ArrayBuffer(4)
    new DataView(ab).setFloat32(0, Number(value) || 0, true)
    w.writeBytes(new Uint8Array(ab))
  }
  function writeKiwiString(w, value) {
    // Kiwi strings are null-terminated UTF-8.
    const bytes = new TextEncoder().encode(String(value == null ? "" : value))
    w.writeBytes(bytes)
    w.writeByte(0)
  }
  function writeUint32LE(w, value) {
    const v = value >>> 0
    w.writeByte(v & 0xff)
    w.writeByte((v >>> 8) & 0xff)
    w.writeByte((v >>> 16) & 0xff)
    w.writeByte((v >>> 24) & 0xff)
  }

  // ── 3. Base64 (binary-safe, chunked to avoid stack overflow) ──────
  function base64Decode(s) {
    const bin = atob(s)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
    return out
  }
  function base64Encode(bytes) {
    // Process in 8KB chunks so String.fromCharCode doesn't blow the
    // call stack for large payloads (40KB+ of schema).
    const chunkSize = 0x2000
    let binary = ""
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
      binary += String.fromCharCode.apply(null, slice)
    }
    return btoa(binary)
  }

  // ── 4. Cached schema chunk and scene fixture ──────────────────────
  // Captured from a real Figma copy session. Shipping the schema chunk
  // verbatim avoids needing a deflate encoder in the browser; we just
  // reuse Figma's last-published schema definitions.
  const SCHEMA_CHUNK_B64 = "__SCHEMA_CHUNK_B64__"
  const SCENE_FIXTURE_B64 = "__SCENE_FIXTURE_B64__"

  let cachedSchemaChunk = null
  let cachedSceneFixture = null
  function getSchemaChunk() {
    if (!cachedSchemaChunk) cachedSchemaChunk = base64Decode(SCHEMA_CHUNK_B64)
    return cachedSchemaChunk
  }
  function getSceneFixture() {
    if (!cachedSceneFixture) cachedSceneFixture = base64Decode(SCENE_FIXTURE_B64)
    return cachedSceneFixture
  }

  // ── 5. Minimal zstd "store-only" frame ────────────────────────────
  //
  // Wraps `payload` in a zstd frame that contains it as a single Raw
  // Block (no compression). Figma's reader treats chunk 2 as zstd
  // because of the `28 b5 2f fd` magic; using a no-compression frame
  // lets us avoid bundling a full zstd encoder while staying within
  // the format spec.
  //
  // Frame:  4 bytes magic (28 b5 2f fd)
  //         1 byte FHD: SS=1, FCS_Flag=10 (4-byte FCS)  → 0xa0
  //         4 bytes FCS LE = uncompressed payload size
  //         3 bytes block header: Last_Block=1, Block_Type=00 (raw),
  //           Block_Size=payload length (21 bits)
  //         N bytes raw payload
  //
  // Reference:
  // https://datatracker.ietf.org/doc/html/rfc8478#section-3.1.1
  function buildZstdRawFrame(payload) {
    if (!(payload instanceof Uint8Array)) {
      throw new Error("buildZstdRawFrame: payload must be Uint8Array")
    }
    if (payload.length > 0x1fffff) {
      throw new Error("buildZstdRawFrame: payload exceeds 21-bit raw-block size")
    }
    const w = createByteWriter(payload.length + 12)
    // Magic
    w.writeBytes(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]))
    // FHD: Single_Segment=1 (bit5), FCS_Flag=10 (bits6-7), rest 0
    w.writeByte(0xa0)
    // FCS: 4-byte LE
    writeUint32LE(w, payload.length)
    // Block header: 21-bit size in bits 3-23, type 00 (raw) bits 1-2,
    // last-block flag bit 0
    const headerValue = ((payload.length & 0x1fffff) << 3) | 0x01
    w.writeByte(headerValue & 0xff)
    w.writeByte((headerValue >>> 8) & 0xff)
    w.writeByte((headerValue >>> 16) & 0xff)
    // Raw payload
    w.writeBytes(payload)
    return w.toUint8Array()
  }

  // ── 6. Kiwi container assembly ────────────────────────────────────
  //
  // Layout (matches captured payload byte-for-byte):
  //   "fig-kiwi"  (8 bytes ASCII)
  //   'j'         (1 byte clipboard format flag)
  //   00 00 00    (3 reserved bytes)
  //   uint32 LE   (schema chunk length)
  //   schemaBytes (raw deflate-compressed kiwi schema)
  //   uint32 LE   (scene chunk length)
  //   sceneBytes  (zstd-framed kiwi scene message)
  function buildKiwiContainer(schemaBytes, sceneBytes) {
    const w = createByteWriter(schemaBytes.length + sceneBytes.length + 32)
    w.writeBytes(new Uint8Array([
      0x66, 0x69, 0x67, 0x2d, 0x6b, 0x69, 0x77, 0x69, // "fig-kiwi"
      0x6a,                                            // 'j' clipboard flag
      0x00, 0x00, 0x00                                 // reserved
    ]))
    writeUint32LE(w, schemaBytes.length)
    w.writeBytes(schemaBytes)
    writeUint32LE(w, sceneBytes.length)
    w.writeBytes(sceneBytes)
    return w.toUint8Array()
  }

  // ── 7. HTML clipboard envelope ────────────────────────────────────
  //
  // Mirrors the structure Figma's web app writes to text/html when you
  // copy a frame. Two HTML-comment blocks carry the payloads:
  //
  //   <!--(figmeta)…base64 JSON metadata…(/figmeta)-->
  //   <!--(figma)…base64 kiwi container…(/figma)-->
  //
  // Plus a trailing <span> that acts as a paste-as-text fallback.
  function buildHtmlEnvelope(figmetaJson, figmaContainerBytes, plainText) {
    const figmetaB64 = base64Encode(new TextEncoder().encode(JSON.stringify(figmetaJson)))
    const figmaB64 = base64Encode(figmaContainerBytes)
    const escapedText = String(plainText || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
    return [
      `<meta charset="utf-8">`,
      `<div>`,
      `<span data-metadata="<!--(figmeta)${figmetaB64}(/figmeta)-->"></span>`,
      `<span data-buffer="<!--(figma)${figmaB64}(/figma)-->"></span>`,
      `</div>`,
      escapedText
        ? `<span><span style="font-size: 12px; white-space: pre-wrap;">${escapedText}</span></span>`
        : ""
    ].join("")
  }

  // ── 8. Synthesise a scene from a Replicode capture ────────────────
  //
  // Iterative work happens here. The captured Figma scene we use as a
  // reference is a kiwi-encoded `Message` (def 428) carrying a list of
  // `NodeChange` records (def 229). For the first ship we emit the
  // captured fixture's bytes verbatim — that proves the wrapper works
  // end-to-end. As we add per-NodeChange field encoders the synth
  // function takes over from the fixture, one node type at a time.
  function buildSceneFromCapture(_capture) {
    // TODO(phase-2b): walk capture.tree, emit a Message containing
    // nodeChanges = [DOCUMENT, CANVAS, ...captured-tree-mapped...].
    // Until then, return the captured fixture so the wrapper round-
    // trip is testable in isolation.
    return getSceneFixture()
  }

  // ── 9. High-level entry point ─────────────────────────────────────
  //
  // Returns the `text/html` clipboard string the Figma button should
  // copy, or null if synthesis isn't possible for this capture (caller
  // falls back to the JSON-for-plugin path).
  function buildFigmaClipboardHtml(capture, options) {
    options = options || {}
    let scene
    try {
      scene = buildSceneFromCapture(capture)
    } catch (err) {
      console.warn("[replicode] scene synthesis failed:", err)
      return null
    }
    if (!scene) return null

    const sceneFrame = buildZstdRawFrame(scene)
    const container = buildKiwiContainer(getSchemaChunk(), sceneFrame)

    const figmeta = {
      fileKey: options.fileKey || "replicode-extension",
      pasteID: options.pasteID || ((Math.random() * 0x7fffffff) | 0),
      dataType: "scene",
      environment: "replicode-extension",
      selectedNodeData: options.selectedNodeData || "0:1|1|0"
    }
    const plainText = options.plainText || (capture && capture.metadata && capture.metadata.rootLabel) || ""

    return buildHtmlEnvelope(figmeta, container, plainText)
  }

  // ── 10. Public API ────────────────────────────────────────────────
  const api = {
    // Encoder primitives — exposed for testing and the Phase 2b scene
    // synthesiser the next iteration adds.
    createByteWriter,
    writeVarUint,
    writeVarInt,
    writeBool,
    writeFloat32,
    writeKiwiString,
    writeUint32LE,
    base64Decode,
    base64Encode,

    // Mid-level builders — composable for tests / debugging.
    buildZstdRawFrame,
    buildKiwiContainer,
    buildHtmlEnvelope,
    getSchemaChunk,
    getSceneFixture,
    buildSceneFromCapture,

    // High-level entry point used by the Figma button.
    buildFigmaClipboardHtml,

    // Sanity probe — returns true once the writer is ready to attempt
    // a clipboard payload. Currently always true because we ship a
    // captured-scene fallback.
    isReady() { return true }
  }

  const ns = (window.ReplicodeFigmaExport = window.ReplicodeFigmaExport || {})
  ns.figmaClipboard = api
})()

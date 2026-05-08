const runtime = globalThis.chrome?.runtime || null
const storage = globalThis.chrome?.storage || null
const statusBadge = document.getElementById("statusBadge")
const captureMeta = document.getElementById("captureMeta")
const startCaptureButton = document.getElementById("startCapture")
const stopCaptureButton = document.getElementById("stopCapture")
const openReviewButton = document.getElementById("openReview")

function setStatus(label, message, tone = "idle") {
  if (statusBadge) {
    statusBadge.textContent = label
    statusBadge.className = `status-badge status-badge--${tone}`
  }

  if (captureMeta) {
    captureMeta.textContent = message
  }
}

function applyControlState({ captureMode = false, previewOnly = false } = {}) {
  startCaptureButton.disabled = previewOnly || captureMode
  stopCaptureButton.disabled = previewOnly || !captureMode
}

async function sendMessage(message) {
  if (!runtime?.sendMessage) {
    return { ok: false, error: "Extension runtime unavailable." }
  }

  try {
    return await runtime.sendMessage(message)
  } catch (error) {
    return { ok: false, error: error?.message || String(error) }
  }
}

function applyPreviewState() {
  setStatus("Preview", "Load the unpacked extension in Chrome to use live capture.", "preview")
  applyControlState({ previewOnly: true })
}

async function refreshStatus() {
  if (!runtime?.sendMessage) {
    applyPreviewState()
    return
  }

  const state = await sendMessage({ type: "GET_EXTENSION_STATE" })
  if (!state?.ok) {
    setStatus("Error", state?.error || "Couldn't read the extension state.", "preview")
    applyControlState({ previewOnly: false, captureMode: false })
    return
  }

  const captureMode = Boolean(state.tabState?.captureMode)
  const captureLabel = state.capture?.metadata?.rootLabel || null
  applyControlState({ captureMode })

  if (captureMode) {
    setStatus("Live", "Use the floating bar on the page to capture a component.", "live")
    return
  }

  if (captureLabel) {
    setStatus("Ready", `Last capture: ${captureLabel}`, "ready")
    return
  }

  setStatus("Idle", "Open any page, then capture the component you want to export.", "idle")
}

startCaptureButton.addEventListener("click", async () => {
  setStatus("Live", "Starting capture mode…", "live")
  const result = await sendMessage({ type: "START_CAPTURE" })
  if (!result?.ok) {
    setStatus("Error", result?.error || "Could not start capture mode.", "preview")
  }
  await refreshStatus()
})

stopCaptureButton.addEventListener("click", async () => {
  const result = await sendMessage({ type: "STOP_CAPTURE" })
  if (!result?.ok) {
    setStatus("Error", result?.error || "Nothing to stop.", "preview")
  }
  await refreshStatus()
})

openReviewButton.addEventListener("click", async () => {
  const result = await sendMessage({ type: "OPEN_REVIEW" })
  if (!result?.ok) {
    setStatus("Error", result?.warning || result?.error || "Could not open the review panel.", "preview")
  }
})

if (storage?.onChanged?.addListener) {
  storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && (changes.currentTabId || Object.keys(changes).some((key) => key.startsWith("capture:") || key.startsWith("state:")))) {
      refreshStatus()
    }
  })
}

window.addEventListener("focus", refreshStatus)

refreshStatus()

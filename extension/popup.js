const statusText = document.getElementById("statusText")
const copyForFigmaButton = document.getElementById("copyForFigma")

async function sendMessage(message) {
  return chrome.runtime.sendMessage(message)
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.setAttribute("readonly", "readonly")
    textarea.style.cssText = "position:fixed;left:-99999px;top:-99999px;opacity:0;"
    document.body.appendChild(textarea)
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)
    const copied = document.execCommand("copy")
    document.body.removeChild(textarea)
    return copied
  }
}

async function refreshStatus() {
  const state = await sendMessage({ type: "GET_EXTENSION_STATE" })
  if (!state?.ok) {
    statusText.textContent = "Unable to read extension state."
    copyForFigmaButton.disabled = true
    return
  }

  copyForFigmaButton.disabled = !state.capture?.tree

  if (state.tabState?.captureMode) {
    statusText.textContent = "Capture mode is active on the current tab."
    return
  }

  if (state.capture?.metadata?.rootLabel) {
    statusText.textContent = `Last capture: ${state.capture.metadata.rootLabel}`
    return
  }

  statusText.textContent = "Ready."
}

document.getElementById("startCapture").addEventListener("click", async () => {
  statusText.textContent = "Starting capture mode..."
  const result = await sendMessage({ type: "START_CAPTURE" })
  statusText.textContent = result?.ok
    ? "Capture mode is live. Hover the page and click a component."
    : result?.error || "Could not start capture mode."
})

document.getElementById("openReview").addEventListener("click", async () => {
  const result = await sendMessage({ type: "OPEN_REVIEW" })
  statusText.textContent = result?.ok
    ? "Review panel opened."
    : result?.warning || result?.error || "Could not open the review panel."
})

document.getElementById("stopCapture").addEventListener("click", async () => {
  const result = await sendMessage({ type: "STOP_CAPTURE" })
  statusText.textContent = result?.ok ? "Capture mode stopped." : result?.error || "Nothing to stop."
})

document.getElementById("copyForFigma").addEventListener("click", async () => {
  const state = await sendMessage({ type: "GET_EXTENSION_STATE" })
  if (!state?.ok || !state.capture?.tree) {
    statusText.textContent = "Capture a component first, then copy the Figma payload."
    copyForFigmaButton.disabled = true
    return
  }

  const payload = window.ReplicodeFigmaExport?.generateImportJson(state.capture)
  if (!payload) {
    statusText.textContent = "Could not prepare the Figma payload."
    return
  }

  const copied = await copyText(payload)
  statusText.textContent = copied
    ? "Copied Figma payload. Paste it into the Replicode Figma plugin."
    : "Copy failed. Open the review panel and copy the Figma output there."
})

refreshStatus()

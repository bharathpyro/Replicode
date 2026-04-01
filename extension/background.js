const CURRENT_TAB_KEY = "currentTabId"

function captureKey(tabId) {
  return `capture:${tabId}`
}

function stateKey(tabId) {
  return `state:${tabId}`
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab || null
}

async function getCurrentTabId() {
  const stored = await chrome.storage.local.get(CURRENT_TAB_KEY)
  if (stored[CURRENT_TAB_KEY]) {
    return stored[CURRENT_TAB_KEY]
  }

  const tab = await getActiveTab()
  return tab?.id ?? null
}

async function getTabState(tabId) {
  if (!tabId) {
    return null
  }

  const stored = await chrome.storage.local.get(stateKey(tabId))
  return stored[stateKey(tabId)] || null
}

async function setTabState(tabId, patch) {
  if (!tabId) {
    return null
  }

  const key = stateKey(tabId)
  const existing = await chrome.storage.local.get(key)
  const nextState = {
    ...(existing[key] || {}),
    ...patch,
    tabId,
    updatedAt: new Date().toISOString()
  }

  await chrome.storage.local.set({
    [CURRENT_TAB_KEY]: tabId,
    [key]: nextState
  })

  return nextState
}

async function setCapture(tabId, payload) {
  await chrome.storage.local.set({
    [CURRENT_TAB_KEY]: tabId,
    [captureKey(tabId)]: payload
  })

  await setTabState(tabId, {
    captureMode: false,
    interactionRecording: false,
    hasCapture: true,
    selectedTag: payload?.metadata?.rootTag || null,
    selectedLabel: payload?.metadata?.rootLabel || null,
    lastCaptureAt: payload?.metadata?.capturedAt || null
  })
}

async function getCapture(tabId) {
  if (!tabId) {
    return null
  }

  const stored = await chrome.storage.local.get(captureKey(tabId))
  return stored[captureKey(tabId)] || null
}

async function clearCapture(tabId) {
  if (!tabId) {
    return
  }

  await chrome.storage.local.remove(captureKey(tabId))
  await setTabState(tabId, {
    interactionRecording: false,
    hasCapture: false,
    selectedTag: null,
    selectedLabel: null,
    lastCaptureAt: null
  })
}

async function sendToTab(tabId, message) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, message)
    return { ok: true, response }
  } catch (error) {
    return { ok: false, error: error?.message || String(error) }
  }
}

async function ensureSidePanel(tabId) {
  if (!chrome.sidePanel?.setOptions) {
    return
  }

  await chrome.sidePanel.setOptions({
    tabId,
    path: "sidepanel.html",
    enabled: true
  })
}

async function openSidePanel(tabId) {
  await ensureSidePanel(tabId)

  if (!chrome.sidePanel?.open) {
    return { ok: false, warning: "Side panel API is unavailable in this Chrome build." }
  }

  try {
    await chrome.sidePanel.open({ tabId })
    return { ok: true }
  } catch (error) {
    return { ok: false, warning: error?.message || String(error) }
  }
}

async function startCapture() {
  const tab = await getActiveTab()
  if (!tab?.id) {
    return { ok: false, error: "No active tab found." }
  }

  await setTabState(tab.id, {
    captureMode: true,
    hasCapture: false
  })

  const panelResult = await openSidePanel(tab.id)
  const result = await sendToTab(tab.id, { type: "SET_CAPTURE_MODE", enabled: true })

  if (!result.ok) {
    await setTabState(tab.id, { captureMode: false })
    return {
      ok: false,
      error: "Could not enable capture mode on the page. Refresh the page and try again.",
      details: result.error
    }
  }

  return {
    ok: true,
    tabId: tab.id,
    panel: panelResult
  }
}

async function stopCapture(tabId) {
  const resolvedTabId = tabId || (await getCurrentTabId())
  if (!resolvedTabId) {
    return { ok: false, error: "No tab is currently being inspected." }
  }

  await sendToTab(resolvedTabId, { type: "STOP_INTERACTION_RECORDING" })
  await setTabState(resolvedTabId, { captureMode: false, interactionRecording: false })
  const result = await sendToTab(resolvedTabId, { type: "SET_CAPTURE_MODE", enabled: false })

  return {
    ok: result.ok,
    error: result.ok ? null : result.error,
    tabId: resolvedTabId
  }
}

async function recaptureFromPanel(options) {
  const tabId = options?.tabId || (await getCurrentTabId())
  if (!tabId) {
    return { ok: false, error: "No active capture tab is available." }
  }

  await setTabState(tabId, { lastOptions: options })
  const result = await sendToTab(tabId, { type: "RECAPTURE", options })

  return {
    ok: result.ok,
    error: result.ok ? null : result.error,
    tabId
  }
}

async function startInteractionRecording(tabId) {
  const resolvedTabId = tabId || (await getCurrentTabId())
  if (!resolvedTabId) {
    return { ok: false, error: "No active capture tab is available." }
  }

  const result = await sendToTab(resolvedTabId, { type: "START_INTERACTION_RECORDING" })
  if (!result.ok || result.response?.ok === false) {
    return {
      ok: false,
      error: result.response?.error || result.error || "Could not start interaction recording."
    }
  }

  await setTabState(resolvedTabId, { interactionRecording: true })
  return { ok: true, tabId: resolvedTabId }
}

async function stopInteractionRecording(tabId) {
  const resolvedTabId = tabId || (await getCurrentTabId())
  if (!resolvedTabId) {
    return { ok: false, error: "No active capture tab is available." }
  }

  const result = await sendToTab(resolvedTabId, { type: "STOP_INTERACTION_RECORDING" })
  await setTabState(resolvedTabId, { interactionRecording: false })

  if (!result.ok || result.response?.ok === false) {
    return {
      ok: false,
      error: result.response?.error || result.error || "Could not stop interaction recording."
    }
  }

  return {
    ok: true,
    tabId: resolvedTabId,
    recordedStates: result.response?.recordedStates || 0
  }
}

async function getExtensionState() {
  const tabId = await getCurrentTabId()
  const tabState = await getTabState(tabId)
  const capture = await getCapture(tabId)

  return {
    ok: true,
    currentTabId: tabId,
    tabState,
    capture
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-capture") {
    return
  }

  const tabId = await getCurrentTabId()
  const currentState = await getTabState(tabId)
  if (currentState?.captureMode) {
    await stopCapture(tabId)
    return
  }

  await startCapture()
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  ;(async () => {
    switch (message?.type) {
      case "START_CAPTURE":
        sendResponse(await startCapture())
        return

      case "STOP_CAPTURE":
        sendResponse(await stopCapture(message?.tabId))
        return

      case "OPEN_REVIEW": {
        const tabId = message?.tabId || (await getCurrentTabId())
        if (!tabId) {
          sendResponse({ ok: false, error: "No active tab found." })
          return
        }
        sendResponse(await openSidePanel(tabId))
        return
      }

      case "GET_EXTENSION_STATE":
        sendResponse(await getExtensionState())
        return

      case "RECAPTURE_FROM_PANEL":
        sendResponse(await recaptureFromPanel(message?.options || {}))
        return

      case "START_INTERACTION_RECORDING":
        sendResponse(await startInteractionRecording(message?.tabId))
        return

      case "STOP_INTERACTION_RECORDING":
        sendResponse(await stopInteractionRecording(message?.tabId))
        return

      case "CLEAR_CAPTURE": {
        const tabId = message?.tabId || (await getCurrentTabId())
        await clearCapture(tabId)
        sendResponse({ ok: true, tabId })
        return
      }

      case "CAPTURE_RESULT": {
        const tabId = sender?.tab?.id || message?.tabId || (await getCurrentTabId())
        if (!tabId || !message?.payload) {
          sendResponse({ ok: false, error: "Capture payload is missing." })
          return
        }

        await setCapture(tabId, message.payload)
        await ensureSidePanel(tabId)
        chrome.runtime.sendMessage({ type: "CAPTURE_UPDATED", tabId }).catch(() => {})
        sendResponse({ ok: true, tabId })
        return
      }

      default:
        sendResponse({ ok: false, error: "Unknown message type." })
    }
  })()

  return true
})

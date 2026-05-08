;(() => {
  const OVERLAY_ROOT_ID = "__ui_extractor_overlay__"
  const MAX_CAPTURE_NODES = 180
  const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"])
  const ALLOWED_HTML_ATTRIBUTES = new Set([
    "alt",
    "src",
    "srcset",
    "href",
    "role",
    "type",
    "name",
    "value",
    "placeholder",
    "title",
    "aria-label",
    "aria-hidden",
    "aria-describedby",
    "aria-labelledby",
    "aria-controls",
    "aria-expanded",
    "aria-pressed",
    "aria-selected",
    "width",
    "height"
  ])
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg"
  const INHERITED_PROPERTIES = new Set([
    "color",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "letter-spacing",
    "line-height",
    "text-align",
    "text-transform",
    "white-space",
    "cursor"
  ])
  const TYPOGRAPHY_PROPERTIES = new Set([
    "color",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "line-height",
    "letter-spacing",
    "text-align",
    "text-transform",
    "text-decoration",
    "white-space"
  ])
  const STYLE_PROPERTIES = [
    "display",
    "visibility",
    "position",
    "top",
    "right",
    "bottom",
    "left",
    "z-index",
    "width",
    "height",
    "min-width",
    "min-height",
    "max-width",
    "max-height",
    "flex-direction",
    "flex-wrap",
    "flex-grow",
    "flex-shrink",
    "flex-basis",
    "justify-content",
    "align-items",
    "align-content",
    "align-self",
    "grid-template-columns",
    "grid-template-rows",
    "grid-auto-flow",
    "grid-column",
    "grid-row",
    "gap",
    "row-gap",
    "column-gap",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "border-top-style",
    "border-right-style",
    "border-bottom-style",
    "border-left-style",
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
    "border-radius",
    "background-color",
    "background-image",
    "background-size",
    "background-position",
    "background-repeat",
    "background-clip",
    "-webkit-background-clip",
    "-webkit-text-fill-color",
    "box-shadow",
    "opacity",
    "filter",
    "backdrop-filter",
    "mix-blend-mode",
    "color",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "line-height",
    "letter-spacing",
    "text-align",
    "text-transform",
    "text-decoration",
    "white-space",
    "overflow",
    "overflow-x",
    "overflow-y",
    "object-fit",
    "object-position",
    "cursor",
    "transform",
    "transform-origin",
    "transition-property",
    "transition-duration",
    "transition-timing-function",
    "transition-delay",
    "animation-name",
    "animation-duration",
    "animation-timing-function",
    "animation-delay",
    "animation-iteration-count",
    "animation-direction",
    "animation-fill-mode",
    "animation-play-state"
  ]
  const STATE_STYLE_PROPERTIES = STYLE_PROPERTIES.filter(
    (property) => !property.startsWith("transition") && !property.startsWith("animation")
  )

  let captureMode = false
  let hoveredElement = null
  let selectedElement = null
  let overlayRoot = null
  let highlightBox = null
  let labelBox = null
  let statusPill = null
  let hudPanel = null
  let scopeDownButton = null
  let scopeUpButton = null
  let captureButton = null
  let exitButton = null
  let copyFigmaButton = null
  let copyCodeButton = null
  let dragHandle = null
  let dragState = null
  let hudPosition = null
  let defaultStylesFrame = null
  let defaultStyleCache = new Map()
  let lastCaptureOptions = { ancestorLevel: 0, maxDepth: null }
  let lastCapturePayload = null
  let recordedStateMap = {}
  let recordedEvents = []
  let interactionRecorder = null
  let hoverState = null
  let ancestorAdjustment = 0

  function clampNumber(value, min, max) {
    return Math.min(Math.max(value, min), max)
  }

  function ensureOverlay() {
    if (overlayRoot) {
      return
    }

    const style = document.createElement("style")
    style.id = `${OVERLAY_ROOT_ID}-styles`
    style.textContent = `
      #${OVERLAY_ROOT_ID} {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 2147483647;
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-highlight {
        position: fixed;
        border: 1.5px solid #ef4cd4;
        background: rgba(239, 76, 212, 0.08);
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.92), 0 12px 30px rgba(110, 24, 90, 0.18);
        border-radius: 12px;
        pointer-events: none;
        transition: top 90ms ease, left 90ms ease, width 90ms ease, height 90ms ease;
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-label {
        position: fixed;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(14, 16, 24, 0.94);
        border: 1px solid rgba(255, 255, 255, 0.16);
        color: white;
        font: 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
        white-space: nowrap;
        pointer-events: none;
        box-shadow: 0 10px 26px rgba(6, 8, 14, 0.24);
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-hud {
        position: fixed;
        top: 14px;
        left: 50%;
        transform: translateX(-50%);
        width: min(620px, calc(100vw - 32px));
        padding: 6px 8px 6px 10px;
        border-radius: 12px;
        background:
          radial-gradient(circle at top right, rgba(239, 76, 212, 0.16), transparent 34%),
          rgba(12, 14, 22, 0.94);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: white;
        font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: auto;
        box-shadow: 0 16px 32px rgba(6, 8, 14, 0.3);
        backdrop-filter: blur(18px);
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-hud-row {
        display: flex;
        align-items: center;
        gap: 10px;
        cursor: grab;
        user-select: none;
        touch-action: none;
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-hud--dragging .ui-extractor-hud-row {
        cursor: grabbing;
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-hud-grip {
        flex: 0 0 auto;
        display: inline-block;
        width: 7px;
        height: 14px;
        background-image: radial-gradient(circle, rgba(255, 255, 255, 0.5) 1px, transparent 1.4px);
        background-size: 3.5px 3.5px;
        opacity: 0.5;
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-hud-segmented,
      #${OVERLAY_ROOT_ID} .ui-extractor-hud-cta,
      #${OVERLAY_ROOT_ID} .ui-extractor-hud-segmented-btn,
      #${OVERLAY_ROOT_ID} .ui-extractor-hud-button,
      #${OVERLAY_ROOT_ID} .ui-extractor-hud-close {
        cursor: pointer;
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-hud-cta {
        margin-left: auto;
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-hud--dragged {
        left: var(--hud-left, 50%);
        top: var(--hud-top, 14px);
        transform: none;
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-hud-brand {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-hud-dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: linear-gradient(135deg, #ef4cd4, #ff9472);
        box-shadow: 0 0 0 3px rgba(239, 76, 212, 0.16);
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-hud-title {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.7);
      }


      #${OVERLAY_ROOT_ID} .ui-extractor-hud-segmented {
        display: inline-flex;
        align-items: stretch;
        height: 28px;
        flex: 0 0 auto;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        overflow: hidden;
        user-select: none;
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-hud-segmented-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 100%;
        padding: 0 9px;
        border: none;
        background: transparent;
        color: rgba(255, 255, 255, 0.88);
        font: inherit;
        font-size: 11.5px;
        font-weight: 600;
        line-height: 1;
        cursor: pointer;
        transition: background-color 120ms ease;
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-hud-segmented-btn + .ui-extractor-hud-segmented-btn {
        border-left: 1px solid rgba(255, 255, 255, 0.08);
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-hud-segmented-btn:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.1);
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-hud-segmented-btn:disabled {
        opacity: 0.32;
        cursor: not-allowed;
      }


      #${OVERLAY_ROOT_ID} .ui-extractor-hud-close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        padding: 0;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: rgba(255, 255, 255, 0.55);
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
        transition: background-color 120ms ease, color 120ms ease;
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-hud-close:hover {
        background: rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.95);
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-hud-cta {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex: 0 0 auto;
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-hud-icon {
        flex: 0 0 auto;
        display: inline-block;
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-hud-button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 26px;
        padding: 0 9px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.05);
        color: rgba(255, 255, 255, 0.92);
        font: inherit;
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
        transition: transform 120ms ease, background-color 120ms ease, border-color 120ms ease;
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-hud-button:hover {
        transform: translateY(-1px);
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.18);
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-hud-button:disabled {
        opacity: 0.42;
        cursor: not-allowed;
        transform: none;
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-hud-button--primary {
        background: linear-gradient(135deg, #ef4cd4, #ff9472);
        border-color: transparent;
        color: #fff;
        box-shadow: 0 10px 22px rgba(239, 76, 212, 0.22);
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-hud-button--success,
      #${OVERLAY_ROOT_ID} .ui-extractor-hud-button--success:hover {
        background: linear-gradient(135deg, #14a34a, #4cd07d);
        border-color: transparent;
        color: #fff;
        box-shadow: 0 10px 22px rgba(20, 163, 74, 0.28);
        transform: none;
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-hud-icon[hidden],
      #${OVERLAY_ROOT_ID} .ui-extractor-hud-button kbd[hidden] {
        display: none;
      }

      @keyframes ui-extractor-hud-attention {
        0% { box-shadow: 0 0 0 0 rgba(239, 76, 212, 0.45); }
        70% { box-shadow: 0 0 0 6px rgba(239, 76, 212, 0); }
        100% { box-shadow: 0 0 0 0 rgba(239, 76, 212, 0); }
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-hud-button--attention {
        animation: ui-extractor-hud-attention 1s ease-out;
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-hud-button kbd,
      #${OVERLAY_ROOT_ID} .ui-extractor-hud-segmented-btn kbd {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 16px;
        height: 16px;
        padding: 0 4px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.8);
        font: 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
      }

      #${OVERLAY_ROOT_ID} .ui-extractor-status {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 11px;
        color: rgba(255, 255, 255, 0.78);
      }

      @media (max-width: 640px) {
        #${OVERLAY_ROOT_ID} .ui-extractor-hud {
          width: calc(100vw - 16px);
          top: 8px;
          padding: 7px 9px;
        }
      }
    `
    document.documentElement.appendChild(style)

    overlayRoot = document.createElement("div")
    overlayRoot.id = OVERLAY_ROOT_ID

    highlightBox = document.createElement("div")
    highlightBox.className = "ui-extractor-highlight"

    labelBox = document.createElement("div")
    labelBox.className = "ui-extractor-label"

    hudPanel = document.createElement("div")
    hudPanel.className = "ui-extractor-hud"
    hudPanel.innerHTML = `
      <div class="ui-extractor-hud-row" data-role="drag-handle" title="Drag to move">
        <span class="ui-extractor-hud-grip" aria-hidden="true"></span>
        <div class="ui-extractor-hud-brand">
          <span class="ui-extractor-hud-dot"></span>
          <span class="ui-extractor-hud-title">Replicode</span>
        </div>
        <div class="ui-extractor-hud-segmented" role="group" aria-label="Adjust capture scope">
          <button type="button" class="ui-extractor-hud-segmented-btn" data-action="narrow" title="Narrow scope (])">Child <kbd>]</kbd></button>
          <button type="button" class="ui-extractor-hud-segmented-btn" data-action="widen" title="Widen scope ([)">Parent <kbd>[</kbd></button>
        </div>
        <div class="ui-extractor-hud-cta">
          <button type="button" class="ui-extractor-hud-button" data-action="copy-code" title="Copy HTML + CSS for vibe-coding tools" disabled>
            <svg class="ui-extractor-hud-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="16 18 22 12 16 6"></polyline>
              <polyline points="8 6 2 12 8 18"></polyline>
            </svg>
            <span data-role="code-label">Code</span>
          </button>
          <button type="button" class="ui-extractor-hud-button" data-action="copy-figma" title="Copy Figma plugin payload (JSON)" disabled>
            <svg class="ui-extractor-hud-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span data-role="figma-label">Figma</span>
          </button>
          <button type="button" class="ui-extractor-hud-button ui-extractor-hud-button--primary" data-action="capture">
            <svg class="ui-extractor-hud-icon ui-extractor-hud-icon--check" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" hidden>
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span data-role="capture-label">Capture</span>
            <kbd data-role="capture-kbd">↵</kbd>
          </button>
        </div>
        <button type="button" class="ui-extractor-hud-close" data-action="exit" aria-label="Close" title="Close (Esc)">×</button>
      </div>
    `

    statusPill = hudPanel.querySelector('[data-role="status"]')
    scopeDownButton = hudPanel.querySelector('[data-action="narrow"]')
    scopeUpButton = hudPanel.querySelector('[data-action="widen"]')
    captureButton = hudPanel.querySelector('[data-action="capture"]')
    exitButton = hudPanel.querySelector('[data-action="exit"]')
    copyFigmaButton = hudPanel.querySelector('[data-action="copy-figma"]')
    copyCodeButton = hudPanel.querySelector('[data-action="copy-code"]')
    dragHandle = hudPanel.querySelector('[data-role="drag-handle"]')

    dragHandle.addEventListener("pointerdown", onDragStart)

    hudPanel.addEventListener("mousedown", (event) => {
      event.stopPropagation()
    })

    hudPanel.addEventListener("click", (event) => {
      event.stopPropagation()
    })

    scopeDownButton.addEventListener("click", () => adjustHoveredScope(-1))
    scopeUpButton.addEventListener("click", () => adjustHoveredScope(1))
    captureButton.addEventListener("click", () => {
      captureHoveredSelection()
    })
    exitButton.addEventListener("click", () => disableCaptureMode())
    copyFigmaButton.addEventListener("click", () => copyFigmaPayloadFromHud())
    copyCodeButton.addEventListener("click", () => copyCodeFromHud())

    overlayRoot.appendChild(highlightBox)
    overlayRoot.appendChild(labelBox)
    overlayRoot.appendChild(hudPanel)
    overlayRoot.style.display = "none"
    document.documentElement.appendChild(overlayRoot)
  }

  function removeOverlay() {
    const style = document.getElementById(`${OVERLAY_ROOT_ID}-styles`)
    style?.remove()
    overlayRoot?.remove()
    overlayRoot = null
    highlightBox = null
    labelBox = null
    statusPill = null
    hudPanel = null
    scopeDownButton = null
    scopeUpButton = null
    captureButton = null
    exitButton = null
    copyFigmaButton = null
    copyCodeButton = null
    dragHandle = null
    dragState = null
  }

  function applyHudPosition() {
    if (!hudPanel || !hudPosition) {
      return
    }

    const margin = 8
    const rect = hudPanel.getBoundingClientRect()
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin)
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin)
    const left = clampNumber(hudPosition.left, margin, maxLeft)
    const top = clampNumber(hudPosition.top, margin, maxTop)

    hudPanel.classList.add("ui-extractor-hud--dragged")
    hudPanel.style.setProperty("--hud-left", `${left}px`)
    hudPanel.style.setProperty("--hud-top", `${top}px`)
    hudPosition = { left, top }
  }

  function onDragStart(event) {
    if (!hudPanel || event.button !== 0) {
      return
    }

    // Don't start a drag from interactive widgets (buttons, kbd inside buttons, etc.)
    if (event.target instanceof Element && event.target.closest("button, kbd")) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const rect = hudPanel.getBoundingClientRect()
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      width: rect.width,
      height: rect.height
    }

    hudPanel.classList.add("ui-extractor-hud--dragging")
    try {
      dragHandle?.setPointerCapture?.(event.pointerId)
    } catch {}
    window.addEventListener("pointermove", onDragMove, true)
    window.addEventListener("pointerup", onDragEnd, true)
    window.addEventListener("pointercancel", onDragEnd, true)
  }

  function onDragMove(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return
    }

    event.preventDefault()
    const margin = 8
    const dx = event.clientX - dragState.startX
    const dy = event.clientY - dragState.startY
    const maxLeft = Math.max(margin, window.innerWidth - dragState.width - margin)
    const maxTop = Math.max(margin, window.innerHeight - dragState.height - margin)
    const left = clampNumber(dragState.originLeft + dx, margin, maxLeft)
    const top = clampNumber(dragState.originTop + dy, margin, maxTop)

    hudPanel.classList.add("ui-extractor-hud--dragged")
    hudPanel.style.setProperty("--hud-left", `${left}px`)
    hudPanel.style.setProperty("--hud-top", `${top}px`)
    hudPosition = { left, top }
  }

  function onDragEnd(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return
    }

    try {
      dragHandle?.releasePointerCapture?.(event.pointerId)
    } catch {}
    hudPanel?.classList.remove("ui-extractor-hud--dragging")
    dragState = null
    window.removeEventListener("pointermove", onDragMove, true)
    window.removeEventListener("pointerup", onDragEnd, true)
    window.removeEventListener("pointercancel", onDragEnd, true)
  }

  function attachSelectionListeners() {
    window.addEventListener("mousemove", onMouseMove, true)
    window.addEventListener("click", onClick, true)
    window.addEventListener("keydown", onKeyDown, true)
    window.addEventListener("scroll", onViewportChange, true)
    window.addEventListener("resize", onViewportChange, true)
  }

  function detachSelectionListeners() {
    window.removeEventListener("mousemove", onMouseMove, true)
    window.removeEventListener("click", onClick, true)
    window.removeEventListener("keydown", onKeyDown, true)
    window.removeEventListener("scroll", onViewportChange, true)
    window.removeEventListener("resize", onViewportChange, true)
  }

  function onHudReposition() {
    if (hudPosition) {
      applyHudPosition()
    }
  }

  let captureSuccessTimeout = null

  function flashCaptureSuccess() {
    if (!captureButton) {
      return
    }

    const labelEl = captureButton.querySelector('[data-role="capture-label"]')
    const kbdEl = captureButton.querySelector('[data-role="capture-kbd"]')
    const checkEl = captureButton.querySelector(".ui-extractor-hud-icon--check")

    if (captureSuccessTimeout) {
      window.clearTimeout(captureSuccessTimeout)
    }

    captureButton.classList.add("ui-extractor-hud-button--success")
    captureButton.classList.remove("ui-extractor-hud-button--primary")
    if (kbdEl) {
      kbdEl.hidden = true
    }
    if (checkEl) {
      checkEl.hidden = false
    }
    if (labelEl) {
      labelEl.textContent = "Captured"
    }

    captureSuccessTimeout = window.setTimeout(() => {
      captureSuccessTimeout = null
      if (!captureButton) {
        return
      }
      captureButton.classList.remove("ui-extractor-hud-button--success")
      captureButton.classList.add("ui-extractor-hud-button--primary")
      if (kbdEl) {
        kbdEl.hidden = false
      }
      if (checkEl) {
        checkEl.hidden = true
      }
      if (labelEl) {
        labelEl.textContent = "Capture"
      }
    }, 1400)
  }

  function pulseFigmaAttention() {
    if (!copyFigmaButton) {
      return
    }
    copyFigmaButton.classList.remove("ui-extractor-hud-button--attention")
    // Force reflow so the animation can replay.
    void copyFigmaButton.offsetWidth
    copyFigmaButton.classList.add("ui-extractor-hud-button--attention")
    window.setTimeout(() => {
      copyFigmaButton?.classList.remove("ui-extractor-hud-button--attention")
    }, 1100)
  }

  function noteCaptureCompleted(payload) {
    const metadata = payload?.metadata || {}
    const rootLabel = metadata.rootLabel || metadata.rootTag || "component"
    const wasDisabled = !!(copyFigmaButton?.disabled || copyCodeButton?.disabled)

    if (copyFigmaButton) {
      copyFigmaButton.disabled = false
    }
    if (copyCodeButton) {
      copyCodeButton.disabled = false
    }
    if (wasDisabled) {
      pulseFigmaAttention()
    }

    flashCaptureSuccess()
    updateStatus(`✓ Captured ${rootLabel} · pick Code or Figma to copy`)
  }

  function enableCaptureMode() {
    ensureOverlay()
    captureMode = true
    overlayRoot.style.display = "block"
    hoveredElement = null
    hoverState = null
    ancestorAdjustment = 0
    clearHighlight()
    updateHud(null)
    applyHudPosition()
    if (copyFigmaButton) {
      copyFigmaButton.disabled = !lastCapturePayload
    }
    if (copyCodeButton) {
      copyCodeButton.disabled = !lastCapturePayload
    }
    updateStatus(
      lastCapturePayload
        ? "Hover to capture again, or pick Code / Figma to copy."
        : "Hover any component, then click to capture."
    )
    window.addEventListener("keydown", onOverlayKeyDown, true)
    window.addEventListener("resize", onHudReposition, true)
    attachSelectionListeners()
  }

  function disableCaptureMode() {
    detachSelectionListeners()
    window.removeEventListener("keydown", onOverlayKeyDown, true)
    window.removeEventListener("resize", onHudReposition, true)
    captureMode = false
    hoveredElement = null
    hoverState = null
    ancestorAdjustment = 0
    overlayRoot && (overlayRoot.style.display = "none")
  }

  async function copyFigmaPayloadFromHud() {
    if (!copyFigmaButton) {
      return
    }

    const exporter = window.ReplicodeFigmaExport
    if (!exporter?.generateImportJson) {
      updateStatus("Figma exporter is not available on this page.")
      return
    }

    const labelEl = copyFigmaButton.querySelector("span") || copyFigmaButton
    const previousLabel = labelEl.textContent
    copyFigmaButton.disabled = true
    labelEl.textContent = "Copying…"

    const restore = () => {
      labelEl.textContent = previousLabel
      copyFigmaButton.disabled = false
    }

    try {
      const state = await chrome.runtime.sendMessage({ type: "GET_EXTENSION_STATE" })
      const capture = state?.ok ? state.capture : null
      if (!capture?.tree) {
        updateStatus("No capture is available yet. Capture a component first.")
        restore()
        return
      }

      const payload = exporter.generateImportJson(capture)
      if (!payload) {
        updateStatus("Could not prepare the Figma payload for this capture.")
        restore()
        return
      }

      const copied = await copyTextToClipboard(payload)
      labelEl.textContent = copied ? "Copied" : "Failed"
      updateStatus(
        copied
          ? "Figma payload copied. Paste it into the Replicode Figma plugin."
          : "Copy failed. Open the side panel to copy from there."
      )
      window.setTimeout(() => {
        if (copyFigmaButton) {
          restore()
        }
      }, 1600)
    } catch (error) {
      updateStatus(`Could not copy the Figma payload: ${error?.message || error}`)
      restore()
    }
  }

  // Copy HTML + CSS for vibe-coding tools (Lovable, v0, Cursor, etc.).
  // Pulls the latest captured payload from the background so it works
  // even if the page reloaded and the in-content lastCapturePayload is
  // stale. Uses the same generateClipboardExport that powered the old
  // auto-copy path.
  async function copyCodeFromHud() {
    if (!copyCodeButton) {
      return
    }

    const labelEl = copyCodeButton.querySelector("span") || copyCodeButton
    const previousLabel = labelEl.textContent
    copyCodeButton.disabled = true
    labelEl.textContent = "Copying…"

    const restore = () => {
      labelEl.textContent = previousLabel
      copyCodeButton.disabled = false
    }

    try {
      const state = await chrome.runtime.sendMessage({ type: "GET_EXTENSION_STATE" })
      const capture = state?.ok ? state.capture : null
      if (!capture?.tree) {
        updateStatus("No capture is available yet. Capture a component first.")
        restore()
        return
      }

      const exportText = generateClipboardExport(capture)
      if (!exportText) {
        updateStatus("Could not generate code for this capture.")
        restore()
        return
      }

      const copied = await copyTextToClipboard(exportText)
      labelEl.textContent = copied ? "Copied" : "Failed"
      updateStatus(
        copied
          ? "HTML + CSS copied. Paste into your vibe-coding tool of choice."
          : "Copy failed. Use the side panel to copy from there."
      )
      window.setTimeout(() => {
        if (copyCodeButton) {
          restore()
        }
      }, 1600)
    } catch (error) {
      updateStatus(`Could not copy the code: ${error?.message || error}`)
      restore()
    }
  }

  function updateStatus(text) {
    if (statusPill) {
      statusPill.textContent = text
    }
  }

  function updateHud(state) {
    if (!state) {
      if (scopeDownButton) {
        scopeDownButton.disabled = true
      }
      if (scopeUpButton) {
        scopeUpButton.disabled = true
      }
      if (captureButton) {
        captureButton.disabled = true
      }
      return
    }

    if (scopeDownButton) {
      scopeDownButton.disabled = state.previewLevel <= 0
    }
    if (scopeUpButton) {
      scopeUpButton.disabled = state.previewLevel >= state.maxLevel
    }
    if (captureButton) {
      captureButton.disabled = false
    }
  }

  function clearHighlight() {
    if (highlightBox) {
      highlightBox.style.width = "0px"
      highlightBox.style.height = "0px"
      highlightBox.style.opacity = "0"
    }

    if (labelBox) {
      labelBox.style.opacity = "0"
      labelBox.textContent = ""
    }
  }

  function buildHoverState(element) {
    if (!(element instanceof Element)) {
      return null
    }

    const chain = collectAncestorChain(element)
    const recommended = chain.find((item) => item.recommended) || chain[0]
    const recommendedLevel = recommended?.level ?? 0
    const maxLevel = Math.max(chain.length - 1, 0)
    const previewLevel = clampNumber(recommendedLevel + ancestorAdjustment, 0, maxLevel)
    ancestorAdjustment = previewLevel - recommendedLevel

    return {
      element,
      hoveredLabel: describeElement(element),
      previewLevel,
      recommendedLevel,
      maxLevel,
      previewElement: resolveRoot(element, previewLevel),
      previewLabel: describeElement(resolveRoot(element, previewLevel))
    }
  }

  function syncHoverState(element) {
    const nextState = buildHoverState(element)
    if (!nextState) {
      return
    }

    hoveredElement = element
    hoverState = nextState
    renderHighlight(nextState.previewElement, nextState)
    updateHud(nextState)
    updateStatus("Click to capture · Child / Parent adjusts the root")
  }

  function adjustHoveredScope(delta) {
    if (!hoveredElement) {
      return
    }

    ancestorAdjustment += delta
    syncHoverState(hoveredElement)
  }

  async function captureHoveredSelection() {
    if (!hoverState?.element) {
      return
    }

    selectedElement = hoverState.element
    updateStatus("Capturing selection…")
    const payload = await captureSelection({ ancestorLevel: hoverState.previewLevel, maxDepth: null })
    if (payload) {
      noteCaptureCompleted(payload)
    }
  }

  function onViewportChange() {
    if (hoveredElement) {
      syncHoverState(hoveredElement)
    }
    if (hudPosition) {
      applyHudPosition()
    }
  }

  function onMouseMove(event) {
    if (!captureMode) {
      return
    }

    const target = document.elementFromPoint(event.clientX, event.clientY)
    if (!isInspectable(target)) {
      return
    }

    if (target !== hoveredElement) {
      syncHoverState(target)
    }
  }

  function onClick(event) {
    if (!captureMode || !hoverState?.element) {
      return
    }

    if (event.target instanceof Element && event.target.closest(`#${OVERLAY_ROOT_ID}`)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()

    captureHoveredSelection()
  }

  function onOverlayKeyDown(event) {
    if (!overlayRoot || overlayRoot.style.display === "none") {
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      disableCaptureMode()
    }
  }

  function onKeyDown(event) {
    if (!captureMode) {
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      disableCaptureMode()
      return
    }

    if (event.key === "Enter" && hoveredElement) {
      event.preventDefault()
      captureHoveredSelection()
      return
    }

    if ((event.key === "[" || event.key === "ArrowUp") && hoveredElement?.parentElement) {
      event.preventDefault()
      adjustHoveredScope(1)
      return
    }

    if ((event.key === "]" || event.key === "ArrowDown") && hoveredElement) {
      event.preventDefault()
      adjustHoveredScope(-1)
      return
    }
  }

  function renderHighlight(element, state = null) {
    if (!highlightBox || !labelBox || !element) {
      return
    }

    const rect = element.getBoundingClientRect()
    highlightBox.style.top = `${rect.top}px`
    highlightBox.style.left = `${rect.left}px`
    highlightBox.style.width = `${Math.max(rect.width, 0)}px`
    highlightBox.style.height = `${Math.max(rect.height, 0)}px`
    highlightBox.style.opacity = "1"

    const rootLevel = state?.previewLevel ?? 0
    const suggestionText =
      state && state.previewLevel !== state.recommendedLevel ? `Root L${rootLevel} • suggested L${state.recommendedLevel}` : `Root L${rootLevel}`
    labelBox.textContent = `${suggestionText} • ${describeElement(element)} • ${Math.round(rect.width)} × ${Math.round(rect.height)}`
    const labelTop = Math.max(rect.top - 34, 8)
    const labelLeft = Math.max(rect.left, 8)
    labelBox.style.top = `${labelTop}px`
    labelBox.style.left = `${labelLeft}px`
    labelBox.style.opacity = "1"
  }

  function isInspectable(node) {
    if (!(node instanceof Element)) {
      return false
    }

    if (node.id === OVERLAY_ROOT_ID || node.closest(`#${OVERLAY_ROOT_ID}`)) {
      return false
    }

    const tag = node.tagName.toLowerCase()
    return !["html", "head", "script", "style", "link", "meta"].includes(tag)
  }

  function shouldSkipCapturedElement(element, computedStyle) {
    const tag = element.tagName.toLowerCase()
    const display = computedStyle.display
    const visibility = computedStyle.visibility

    if (display === "none" || visibility === "hidden" || visibility === "collapse") {
      return true
    }

    if (tag === "input" && String(element.getAttribute("type") || "").toLowerCase() === "hidden") {
      return true
    }

    return false
  }

  function describeElement(element) {
    const tag = element.tagName.toLowerCase()
    const id = element.id ? `#${element.id}` : ""
    const classes = [...element.classList].slice(0, 2).map((item) => `.${item}`).join("")
    return `${tag}${id}${classes}`
  }

  function ensureDefaultStylesFrame() {
    if (defaultStylesFrame?.contentWindow) {
      return defaultStylesFrame
    }

    defaultStylesFrame = document.createElement("iframe")
    defaultStylesFrame.setAttribute("aria-hidden", "true")
    defaultStylesFrame.style.cssText = "position:fixed;left:-99999px;top:-99999px;width:0;height:0;border:0;visibility:hidden;"
    document.documentElement.appendChild(defaultStylesFrame)

    const frameDoc = defaultStylesFrame.contentDocument
    frameDoc.open()
    frameDoc.write("<!doctype html><html><body></body></html>")
    frameDoc.close()

    return defaultStylesFrame
  }

  function getDefaultStylesForTag(tagName) {
    if (defaultStyleCache.has(tagName)) {
      return defaultStyleCache.get(tagName)
    }

    const frame = ensureDefaultStylesFrame()
    const frameDoc = frame.contentDocument
    const element = frameDoc.createElement(tagName)
    frameDoc.body.appendChild(element)
    const computed = frame.contentWindow.getComputedStyle(element)
    const styles = {}

    for (const property of STYLE_PROPERTIES) {
      styles[property] = computed.getPropertyValue(property)
    }

    frameDoc.body.removeChild(element)
    defaultStyleCache.set(tagName, styles)
    return styles
  }

  function shouldKeepDimension(property, value, element) {
    if (!value) {
      return false
    }

    const inline = element.getAttribute("style") || ""
    const explicitInStyle = inline.includes(property)
    const explicitAttr = element.hasAttribute(property)
    const intrinsicTag = ["img", "svg", "video", "canvas"].includes(element.tagName.toLowerCase())
    return explicitInStyle || explicitAttr || intrinsicTag
  }

  function shouldKeepProperty(property, value, defaultValue, element, parentStyles, computedStyle) {
    if (!value) {
      return false
    }

    if (
      value === defaultValue &&
      !TYPOGRAPHY_PROPERTIES.has(property) &&
      !property.startsWith("animation") &&
      !property.startsWith("transition")
    ) {
      return false
    }

    if (property === "z-index" && value === "auto") {
      return false
    }

    if (["top", "right", "bottom", "left"].includes(property)) {
      return computedStyle.position !== "static" && value !== "auto"
    }

    if (["width", "height", "min-width", "min-height", "max-width", "max-height"].includes(property)) {
      return shouldKeepDimension(property, value, element)
    }

    if (property === "background-image") {
      return value && value !== "none"
    }

    if (property === "box-shadow") {
      return value !== "none"
    }

    if (property === "filter" || property === "backdrop-filter") {
      return value !== "none"
    }

    if (property === "transform") {
      return value !== "none"
    }

    if (property.startsWith("transition")) {
      if (property === "transition-duration" || property === "transition-delay") {
        return value.split(",").some((part) => part.trim() !== "0s")
      }
      if (property === "transition-property") {
        return value !== "all" || computedStyle.transitionDuration.split(",").some((part) => part.trim() !== "0s")
      }
      return value !== "ease" || computedStyle.transitionDuration.split(",").some((part) => part.trim() !== "0s")
    }

    if (property.startsWith("animation")) {
      if (property === "animation-name") {
        return value !== "none"
      }
      return computedStyle.animationName !== "none"
    }

    if (property === "opacity") {
      return value !== "1"
    }

    if (property === "overflow" || property === "overflow-x" || property === "overflow-y") {
      return value !== "visible"
    }

    if (INHERITED_PROPERTIES.has(property) && parentStyles && parentStyles[property] === value) {
      return false
    }

    return value !== defaultValue
  }

  function collectStyles(element, parentStyles) {
    const computedStyle = getElementWindow(element).getComputedStyle(element)
    const defaultStyles = getDefaultStylesForTag(element.tagName.toLowerCase())
    const styles = {}

    for (const property of STYLE_PROPERTIES) {
      const value = computedStyle.getPropertyValue(property)
      const defaultValue = defaultStyles[property]

      if (shouldKeepProperty(property, value, defaultValue, element, parentStyles, computedStyle)) {
        styles[property] = value
      }
    }

    return styles
  }

  function collectPseudoStyles(element, pseudoName) {
    const elementWindow = getElementWindow(element)
    const computedStyle = elementWindow.getComputedStyle(element, pseudoName)
    if (!computedStyle) {
      return null
    }

    const content = computedStyle.getPropertyValue("content")
    if (!content || content === "none" || content === "normal") {
      return null
    }

    const defaultStyles = getDefaultStylesForTag("span")
    const elementStyles = elementWindow.getComputedStyle(element)
    const pseudoStyles = { content }

    for (const property of STYLE_PROPERTIES) {
      const value = computedStyle.getPropertyValue(property)
      if (!value) {
        continue
      }

      if (INHERITED_PROPERTIES.has(property) && elementStyles.getPropertyValue(property) === value) {
        continue
      }

      if (defaultStyles[property] === value && !property.startsWith("animation") && !property.startsWith("transition")) {
        continue
      }

      if (property.startsWith("animation")) {
        if (property === "animation-name" && value === "none") {
          continue
        }
      } else if (property.startsWith("transition")) {
        if (property === "transition-duration" && value === "0s") {
          continue
        }
      } else if (["transform", "filter", "backdrop-filter", "background-image", "box-shadow"].includes(property) && (value === "none" || value === "0px none rgb(0, 0, 0)")) {
        continue
      } else if (property === "opacity" && value === "1") {
        continue
      } else if (["top", "right", "bottom", "left"].includes(property) && value === "auto") {
        continue
      } else if (property === "display" && value === "inline") {
        continue
      } else if (property === "position" && value === "static") {
        continue
      } else if (value === "initial" || value === "normal") {
        continue
      }

      pseudoStyles[property] = value
    }

    return Object.keys(pseudoStyles).length ? pseudoStyles : null
  }

  function collectAttributes(element) {
    const attributes = {}
    const isSvg = element.namespaceURI === SVG_NAMESPACE

    for (const attr of [...element.attributes]) {
      const name = attr.name
      const value = attr.value

      if (name.startsWith("on")) {
        continue
      }

      if (!isSvg && !ALLOWED_HTML_ATTRIBUTES.has(name) && !name.startsWith("aria-")) {
        continue
      }

      if ((name === "href" || name === "src") && value) {
        try {
          attributes[name] = new URL(value, location.href).href
        } catch {
          attributes[name] = value
        }
        continue
      }

      attributes[name] = value
    }

    return attributes
  }

  function collectAssetReferences(element, styles, assets) {
    if (styles["font-family"]) {
      assets.fonts.add(styles["font-family"])
    }

    if (element.tagName.toLowerCase() === "img" && element.currentSrc) {
      assets.images.add(element.currentSrc)
    }

    const backgroundImage = styles["background-image"]
    if (backgroundImage && backgroundImage !== "none") {
      const matches = [...backgroundImage.matchAll(/url\((['"]?)(.*?)\1\)/g)]
      for (const match of matches) {
        if (match[2]) {
          try {
            assets.backgrounds.add(new URL(match[2], location.href).href)
          } catch {
            assets.backgrounds.add(match[2])
          }
        }
      }
    }
  }

  function collectAnimationInfo(path, styles, computedStyle, animationNames, animationNodes) {
    const transition = {
      property: styles["transition-property"] || computedStyle.transitionProperty,
      duration: styles["transition-duration"] || computedStyle.transitionDuration,
      timingFunction: styles["transition-timing-function"] || computedStyle.transitionTimingFunction,
      delay: styles["transition-delay"] || computedStyle.transitionDelay
    }

    const animation = {
      name: styles["animation-name"] || computedStyle.animationName,
      duration: styles["animation-duration"] || computedStyle.animationDuration,
      timingFunction: styles["animation-timing-function"] || computedStyle.animationTimingFunction,
      delay: styles["animation-delay"] || computedStyle.animationDelay,
      iterationCount: styles["animation-iteration-count"] || computedStyle.animationIterationCount
    }

    const hasTransition = transition.duration && transition.duration.split(",").some((value) => value.trim() !== "0s")
    const hasAnimation = animation.name && animation.name !== "none"

    if (hasTransition || hasAnimation) {
      animationNodes.push({ path, transition, animation })
    }

    if (hasAnimation) {
      for (const name of animation.name.split(",")) {
        const trimmed = name.trim()
        if (trimmed && trimmed !== "none") {
          animationNames.add(trimmed)
        }
      }
    }
  }

  function normalizeText(value) {
    return value.replace(/\s+/g, " ").trim()
  }

  // Preserves leading/trailing whitespace so concatenated inline runs keep
  // their natural spacing (e.g. " or " between colored spans).
  function collapseInlineWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ")
  }

  function isInlineLikeChild(element) {
    if (!(element instanceof Element)) {
      return false
    }
    const tag = element.tagName.toLowerCase()
    if (tag === "br") {
      return true
    }
    const display = getElementWindow(element).getComputedStyle(element).display || ""
    return display.startsWith("inline")
  }

  function hasMeaningfulText(node) {
    if (!node) return false
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (normalizeText(child.textContent || "").length > 0) {
          return true
        }
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      if (hasMeaningfulText(child)) return true
    }
    return false
  }

  function isInlineDescendantsOnly(element) {
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) continue
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      if (!isInlineLikeChild(child)) return false
      if (!isInlineDescendantsOnly(child)) return false
    }
    return true
  }

  function shouldCaptureAsRichText(element, computedStyle) {
    const display = String(computedStyle.display || "")
    if (display.includes("flex") || display.includes("grid")) return false
    // Block-level container with only inline content + actual text.
    if (!hasMeaningfulText(element)) return false
    return isInlineDescendantsOnly(element)
  }

  function buildRichTextChild(element, parentStyles, viewportOffset) {
    const ranges = []
    let combined = ""

    function visit(node, ancestorStyles) {
      if (!node) return
      if (node.nodeType === Node.TEXT_NODE) {
        const text = collapseInlineWhitespace(node.textContent || "")
        if (!text) return
        // Skip a leading whitespace-only chunk to avoid stray spaces at the start.
        if (combined.length === 0 && text === " ") return
        ranges.push({
          start: combined.length,
          end: combined.length + text.length,
          styles: ancestorStyles
        })
        combined += text
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return
      const tag = node.tagName.toLowerCase()
      if (tag === "br") {
        ranges.push({
          start: combined.length,
          end: combined.length + 1,
          styles: ancestorStyles
        })
        combined += "\n"
        return
      }
      const ownStyles = collectStyles(node, ancestorStyles)
      for (const child of node.childNodes) {
        visit(child, ownStyles)
      }
    }

    for (const child of element.childNodes) {
      visit(child, parentStyles)
    }

    // Trim a trailing space.
    while (combined.endsWith(" ")) {
      combined = combined.slice(0, -1)
      const last = ranges[ranges.length - 1]
      if (!last) break
      if (last.end > combined.length) {
        last.end = combined.length
        if (last.end <= last.start) ranges.pop()
      }
    }

    if (!combined) return null

    // Prefer the text content's actual bbox (Range API) so the rich-text
    // child reflects only the rendered text, not the outer padding/border
    // box. Falls back to the element's bbox when Range fails.
    let rect = null
    try {
      const range = element.ownerDocument.createRange()
      range.selectNodeContents(element)
      const r = range.getBoundingClientRect()
      if (r && (r.width || r.height)) {
        rect = { x: r.x, y: r.y, width: r.width, height: r.height }
      }
    } catch {}
    if (!rect) {
      const r = element.getBoundingClientRect()
      rect = { x: r.x, y: r.y, width: r.width, height: r.height }
    }

    return {
      type: "text",
      text: combined,
      ranges,
      metrics: offsetMetrics(rect, viewportOffset)
    }
  }

  function getElementWindow(element) {
    return element?.ownerDocument?.defaultView || window
  }

  function offsetMetrics(metrics, offset) {
    if (!metrics) {
      return null
    }

    return {
      x: metrics.x + (offset?.x || 0),
      y: metrics.y + (offset?.y || 0),
      width: metrics.width,
      height: metrics.height
    }
  }

  function collectTextMetrics(textNode) {
    if (!(textNode instanceof Text)) {
      return null
    }

    try {
      const ownerDocument = textNode.ownerDocument || document
      const range = ownerDocument.createRange()
      range.selectNodeContents(textNode)
      const rect = range.getBoundingClientRect()

      if (!rect || (!rect.width && !rect.height)) {
        return null
      }

      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      }
    } catch {
      return null
    }
  }

  function getPageBackgroundColor() {
    const candidates = [document.body, document.documentElement]

    for (const element of candidates) {
      if (!(element instanceof Element)) {
        continue
      }

      const color = window.getComputedStyle(element).backgroundColor
      if (color && color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
        return color
      }
    }

    return "rgb(255, 255, 255)"
  }

  // Walk :root + body and collect every CSS custom property the page
  // defines. The plugin resolves var(--name) references in SVG markup
  // and other captured values against this map so design-system tokens
  // (e.g. --geist-background, --ds-gray-1000) survive the round-trip
  // instead of leaking through unresolved.
  function collectCssVariables() {
    const map = {}
    const sources = [document.documentElement, document.body]
    for (const element of sources) {
      if (!(element instanceof Element)) continue
      const computed = window.getComputedStyle(element)
      for (let i = 0; i < computed.length; i += 1) {
        const prop = computed[i]
        if (!prop || !prop.startsWith("--")) continue
        const value = computed.getPropertyValue(prop)
        if (value == null) continue
        const trimmed = String(value).trim()
        if (!trimmed) continue
        // First defined value wins (documentElement preferred over body).
        if (map[prop] === undefined) {
          map[prop] = trimmed
        }
      }
    }
    return map
  }

  function sanitizeSvgCloneTree(node) {
    if (!(node instanceof Element)) {
      return
    }

    for (const attr of [...node.attributes]) {
      if (attr.name.startsWith("on")) {
        node.removeAttribute(attr.name)
      }
    }

    for (const child of [...node.children]) {
      if (child.tagName.toLowerCase() === "script") {
        child.remove()
        continue
      }

      sanitizeSvgCloneTree(child)
    }
  }

  function serializeSvgInnerMarkup(element) {
    if (!(element instanceof SVGElement)) {
      return ""
    }

    const clone = element.cloneNode(true)
    sanitizeSvgCloneTree(clone)
    return clone.innerHTML
  }

  function getIframeCaptureRoot(iframeElement) {
    if (!(iframeElement instanceof HTMLIFrameElement)) {
      return null
    }

    try {
      const frameDocument = iframeElement.contentDocument
      if (!frameDocument) {
        return null
      }

      return frameDocument.body || frameDocument.documentElement || null
    } catch {
      return null
    }
  }

  function getIframeOffset(iframeElement, parentOffset) {
    const rect = iframeElement.getBoundingClientRect()
    return {
      x: (parentOffset?.x || 0) + rect.x,
      y: (parentOffset?.y || 0) + rect.y
    }
  }

  function walkNode(element, context, depth, parentStyles, path, viewportOffset = { x: 0, y: 0 }) {
    if (!(element instanceof Element) || !isInspectable(element)) {
      return null
    }

    const elementWindow = getElementWindow(element)
    const computedStyle = elementWindow.getComputedStyle(element)
    if (shouldSkipCapturedElement(element, computedStyle)) {
      return null
    }

    if (context.count >= MAX_CAPTURE_NODES) {
      context.truncated = true
      return null
    }

    context.count += 1
    const rect = element.getBoundingClientRect()
    const styles = collectStyles(element, parentStyles)
    const node = {
      type: "element",
      path,
      tag: element.tagName.toLowerCase(),
      label: describeElement(element),
      attributes: collectAttributes(element),
      styles,
      pseudo: {
        before: collectPseudoStyles(element, "::before"),
        after: collectPseudoStyles(element, "::after")
      },
      metrics: offsetMetrics({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      }, viewportOffset),
      children: []
    }

    const recorded = recordedStateMap[path]
    if (recorded?.states) {
      node.states = JSON.parse(JSON.stringify(recorded.states))
    }

    collectAssetReferences(element, styles, context.assets)
    collectAnimationInfo(path, styles, computedStyle, context.animationNames, context.animationNodes)

    if (node.tag === "svg") {
      node.svgInnerMarkup = serializeSvgInnerMarkup(element)
      return node
    }

    const maxDepth = context.options.maxDepth
    if (maxDepth !== null && depth >= maxDepth) {
      return node
    }

    if (node.tag === "iframe") {
      const frameRoot = getIframeCaptureRoot(element)
      if (!frameRoot) {
        context.warnings.push(`Could not inspect iframe ${describeElement(element)} due to cross-origin restrictions.`)
        node.attributes["data-replicode-iframe-access"] = "restricted"
        return node
      }

      node.attributes["data-replicode-iframe-access"] = "same-origin"
      const frameChild = walkNode(
        frameRoot,
        context,
        depth + 1,
        null,
        `${path}.0`,
        getIframeOffset(element, viewportOffset)
      )

      if (frameChild) {
        node.children.push(frameChild)
      }

      return node
    }

    // Text-flow short-circuit: when the element only contains inline content
    // (text nodes + <span>-like elements), emit one rich-text node carrying
    // character-range styles instead of N independent inline children. This
    // is what lets Figma render colored sub-spans (e.g. gradient "Pro" /
    // "Enterprise") inline rather than stacking them as separate frames.
    if (shouldCaptureAsRichText(element, computedStyle)) {
      const richText = buildRichTextChild(element, styles, viewportOffset)
      if (richText) {
        node.children = [richText]
        return node
      }
    }

    let childIndex = 0
    for (const child of element.childNodes) {
      if (context.count >= MAX_CAPTURE_NODES) {
        context.truncated = true
        break
      }

      if (child.nodeType === Node.TEXT_NODE) {
        const text = normalizeText(child.textContent || "")
        if (text) {
          node.children.push({
            type: "text",
            text,
            metrics: offsetMetrics(collectTextMetrics(child), viewportOffset)
          })
        }
        continue
      }

      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue
      }

      const childNode = walkNode(child, context, depth + 1, styles, `${path}.${childIndex}`, viewportOffset)
      childIndex += 1
      if (childNode) {
        node.children.push(childNode)
      }
    }

    return node
  }

  function scoreRootCandidate(element, selected) {
    const tag = element.tagName.toLowerCase()
    const rect = element.getBoundingClientRect()
    const viewportArea = Math.max(window.innerWidth * window.innerHeight, 1)
    const areaRatio = (rect.width * rect.height) / viewportArea
    const display = window.getComputedStyle(element).display
    const childCount = element.children.length
    const repeatedSiblings = element.parentElement
      ? [...element.parentElement.children].filter((sibling) => sibling !== element && sibling.tagName === element.tagName).length
      : 0

    let score = 0
    const reasons = []

    if (element === selected) {
      score += 1
      reasons.push("clicked node")
    }

    if (["section", "article", "nav", "aside", "header", "footer", "main", "form", "ul", "ol", "table", "dialog"].includes(tag)) {
      score += 4
      reasons.push("semantic container")
    }

    if (["flex", "inline-flex", "grid", "inline-grid"].includes(display)) {
      score += 3
      reasons.push(`${display} layout`)
    }

    if (childCount >= 2) {
      score += Math.min(childCount, 4)
      reasons.push(`${childCount} child elements`)
    }

    if (repeatedSiblings >= 1) {
      score += 2
      reasons.push("repeated sibling pattern")
    }

    if (element.classList.length > 0) {
      score += 1
      reasons.push("classed container")
    }

    if (element.getAttribute("role")) {
      score += 1
      reasons.push(`role=${element.getAttribute("role")}`)
    }

    if (areaRatio >= 0.01 && areaRatio <= 0.55) {
      score += 3
      reasons.push("good viewport footprint")
    } else if (areaRatio > 0.75) {
      score -= 5
      reasons.push("too large")
    } else if (areaRatio < 0.002) {
      score -= 3
      reasons.push("too small")
    }

    if (tag === "body") {
      score -= 8
      reasons.push("page shell")
    }

    if (element === selected && childCount === 0) {
      score -= 1
    }

    return {
      score,
      reasons: reasons.slice(0, 3)
    }
  }

  function collectAncestorChain(element) {
    const chain = []
    let current = element
    let level = 0

    while (current && current instanceof Element && level <= 6 && current.tagName) {
      const rect = current.getBoundingClientRect()
      const scored = scoreRootCandidate(current, element)
      chain.push({
        level,
        label: `${describeElement(current)} • ${Math.round(rect.width)} × ${Math.round(rect.height)}`,
        score: scored.score,
        reasons: scored.reasons,
        recommended: false
      })

      if (current.tagName.toLowerCase() === "body") {
        break
      }

      current = current.parentElement
      level += 1
    }

    let recommended = chain[0] || null
    for (const item of chain) {
      if (!recommended || item.score > recommended.score) {
        recommended = item
      }
    }

    if (recommended) {
      const target = chain.find((item) => item.level === recommended.level)
      if (target) {
        target.recommended = true
      }
    }

    return chain
  }

  function resolveRoot(element, ancestorLevel) {
    let current = element
    let remaining = ancestorLevel

    while (current?.parentElement && remaining > 0) {
      current = current.parentElement
      remaining -= 1
    }

    return current || element
  }

  function collectKeyframes(animationNames, warnings) {
    const keyframes = []
    const seen = new Set()

    function walkRules(rules) {
      if (!rules) {
        return
      }

      for (const rule of rules) {
        if (rule.type === CSSRule.KEYFRAMES_RULE) {
          const name = rule.name
          if (animationNames.has(name) && !seen.has(name)) {
            keyframes.push({
              name,
              cssText: rule.cssText,
              source: "readable"
            })
            seen.add(name)
          }
          continue
        }

        if (rule.cssRules) {
          walkRules(rule.cssRules)
        }
      }
    }

    for (const sheet of [...document.styleSheets]) {
      try {
        walkRules(sheet.cssRules)
      } catch (error) {
        warnings.push(`Could not inspect one stylesheet for keyframes: ${error?.message || "cross-origin restriction"}`)
      }
    }

    for (const name of animationNames) {
      if (!seen.has(name)) {
        keyframes.push({
          name,
          cssText: `@keyframes ${name} {\n  /* Original keyframes were not readable through CSSOM. Recreate manually. */\n}`,
          source: "inferred"
        })
      }
    }

    return keyframes
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
  }

  function flattenExportNodes(node, output = []) {
    if (!node) {
      return output
    }

    if (node.type === "element") {
      output.push(node)
      for (const child of node.children || []) {
        flattenExportNodes(child, output)
      }
    }

    return output
  }

  function annotateExportTree(root) {
    const nodes = flattenExportNodes(root)
    nodes.forEach((node, index) => {
      node.__className = index === 0 ? "ui-extractor-root" : `ui-extractor-node-${index}`
    })
    return nodes
  }

  function renderExportRule(selector, styles) {
    const declarations = Object.entries(styles || {})
      .map(([property, value]) => `  ${property}: ${value};`)
      .join("\n")

    return declarations ? `${selector} {\n${declarations}\n}` : ""
  }

  function isZeroLikeCssValue(value) {
    const normalized = String(value || "").trim().toLowerCase()
    return /^0(?:[a-z%]+)?(?:\s+0(?:[a-z%]+)?){0,3}$/.test(normalized)
  }

  function pruneExportStyles(styles) {
    if (!styles || typeof styles !== "object") {
      return {}
    }

    const pruned = { ...styles }

    if (!pruned.transform || pruned.transform === "none") {
      delete pruned["transform-origin"]
    }

    if (!pruned["background-image"] || pruned["background-image"] === "none") {
      delete pruned["background-size"]
      delete pruned["background-position"]
      delete pruned["background-repeat"]
    }

    for (const side of ["top", "right", "bottom", "left"]) {
      const widthKey = `border-${side}-width`
      if (isZeroLikeCssValue(pruned[widthKey])) {
        delete pruned[`border-${side}-style`]
        delete pruned[`border-${side}-color`]
      }
    }

    if (isZeroLikeCssValue(pruned["border-radius"])) {
      delete pruned["border-radius"]
    }

    return pruned
  }

  function normalizePseudoStylesForExport(styles) {
    if (!styles || typeof styles !== "object") {
      return null
    }

    const content = styles.content
    if (!content || content === "none" || content === "normal") {
      return null
    }

    const pruned = pruneExportStyles(styles)
    return Object.keys(pruned).length ? pruned : null
  }

  function renderExportStateRules(node, selector) {
    const blocks = []

    if (node.states?.hover && Object.keys(node.states.hover).length) {
      blocks.push(renderExportRule(`${selector}:hover`, node.states.hover))
    }

    if (node.states?.focus && Object.keys(node.states.focus).length) {
      blocks.push(renderExportRule(`${selector}:focus`, node.states.focus))
    }

    if (node.states?.active && Object.keys(node.states.active).length) {
      blocks.push(renderExportRule(`${selector}:active`, node.states.active))
    }

    return blocks.filter(Boolean)
  }

  function renderExportCss(nodes, keyframes) {
    const blocks = []

    for (const node of nodes) {
      const selector = `.${node.__className}`
      const baseRule = renderExportRule(selector, pruneExportStyles(node.styles || {}))
      if (baseRule) {
        blocks.push(baseRule)
      }

      const beforeRule = renderExportRule(`${selector}::before`, normalizePseudoStylesForExport(node.pseudo?.before))
      if (beforeRule) {
        blocks.push(beforeRule)
      }

      const afterRule = renderExportRule(`${selector}::after`, normalizePseudoStylesForExport(node.pseudo?.after))
      if (afterRule) {
        blocks.push(afterRule)
      }

      blocks.push(...renderExportStateRules(node, selector))
    }

    const keyframeBlocks = (keyframes || []).map((item) => item.cssText)
    return [...blocks.filter(Boolean), ...keyframeBlocks.filter(Boolean)].join("\n\n")
  }

  function renderExportHtml(node) {
    if (!node) {
      return ""
    }

    if (node.type === "text") {
      return escapeHtml(node.text)
    }

    const attrs = { ...(node.attributes || {}) }
    attrs.class = node.__className

    const attrString = Object.entries(attrs)
      .map(([key, value]) => ` ${key}="${escapeHtml(value)}"`)
      .join("")

    const childMarkup = (node.children || []).map((child) => renderExportHtml(child)).join("")
    if (VOID_TAGS.has(node.tag)) {
      return `<${node.tag}${attrString}>`
    }

    if (node.tag === "svg" && typeof node.svgInnerMarkup === "string") {
      return `<svg${attrString}>${node.svgInnerMarkup}</svg>`
    }

    return `<${node.tag}${attrString}>${childMarkup}</${node.tag}>`
  }

  function generateClipboardExport(payload) {
    const rootClone = JSON.parse(JSON.stringify(payload.tree))
    const nodes = annotateExportTree(rootClone)
    const html = renderExportHtml(rootClone)
    const css = renderExportCss(nodes, payload.animations?.keyframes || [])

    return [
      "<!-- component.html -->",
      html,
      "",
      "/* styles.css */",
      css || "/* No scoped CSS properties were captured. */"
    ].join("\n")
  }

  async function copyTextToClipboard(text) {
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

  function resetRecordedInteractions() {
    recordedStateMap = {}
    recordedEvents = []
    stopInteractionRecorderListeners()
  }

  function stopInteractionRecorderListeners() {
    if (!interactionRecorder?.cleanup) {
      interactionRecorder = null
      return
    }

    for (const cleanup of interactionRecorder.cleanup) {
      cleanup()
    }

    interactionRecorder = null
  }

  function normalizeCaptureOptions(options) {
    return {
      ancestorLevel: Number(options?.ancestorLevel || 0),
      maxDepth: options?.maxDepth === undefined ? null : options.maxDepth
    }
  }

  function sameCaptureOptions(nextOptions) {
    return (
      Number(lastCaptureOptions?.ancestorLevel || 0) === Number(nextOptions?.ancestorLevel || 0) &&
      (lastCaptureOptions?.maxDepth ?? null) === (nextOptions?.maxDepth ?? null)
    )
  }

  function computeElementPath(root, element) {
    if (!root || !element || root === element) {
      return "0"
    }

    if (!root.contains(element)) {
      return null
    }

    const parts = []
    let current = element

    while (current && current !== root) {
      const parent = current.parentElement
      if (!parent) {
        return null
      }

      let index = 0
      for (const sibling of parent.children) {
        if (sibling === current) {
          break
        }
        index += 1
      }

      parts.push(index)
      current = parent
    }

    return ["0", ...parts.reverse()].join(".")
  }

  function buildStyleMap(node, output = {}) {
    if (!node) {
      return output
    }

    if (node.type === "element") {
      output[node.path] = node.styles || {}
      for (const child of node.children || []) {
        buildStyleMap(child, output)
      }
    }

    return output
  }

  function collectRecordedStateStyles(element, baseStyles) {
    const computed = window.getComputedStyle(element)
    const defaultStyles = getDefaultStylesForTag(element.tagName.toLowerCase())
    const stateStyles = {}

    for (const property of STATE_STYLE_PROPERTIES) {
      const currentValue = computed.getPropertyValue(property)
      const baseline = baseStyles?.[property]
      const defaultValue = defaultStyles[property]

      if (baseline !== undefined && currentValue === baseline) {
        continue
      }

      if (baseline === undefined && currentValue === defaultValue) {
        continue
      }

      if (["top", "right", "bottom", "left"].includes(property) && currentValue === "auto") {
        continue
      }

      if ((property === "box-shadow" || property === "filter" || property === "backdrop-filter" || property === "background-image") && currentValue === "none") {
        continue
      }

      if (property === "transform" && currentValue === "none") {
        continue
      }

      if (property === "opacity" && currentValue === "1") {
        continue
      }

      stateStyles[property] = currentValue
    }

    return stateStyles
  }

  function storeRecordedState(path, label, state, styles) {
    if (!styles || Object.keys(styles).length === 0) {
      return
    }

    const existing = recordedStateMap[path] || { label, states: {} }
    existing.label = label
    existing.states[state] = styles
    recordedStateMap[path] = existing
  }

  function recordInteractionState(target, state, sourceEvent) {
    if (!interactionRecorder?.active || !lastCapturePayload?.tree) {
      return
    }

    if (!(target instanceof Element) || !interactionRecorder.root?.contains(target)) {
      return
    }

    const path = computeElementPath(interactionRecorder.root, target)
    if (!path) {
      return
    }

    const baseStyleMap = buildStyleMap(lastCapturePayload.tree)
    const styles = collectRecordedStateStyles(target, baseStyleMap[path] || {})
    if (!Object.keys(styles).length) {
      return
    }

    const label = describeElement(target)
    storeRecordedState(path, label, state, styles)
    recordedEvents.push({
      type: sourceEvent,
      state,
      path,
      label,
      capturedAt: new Date().toISOString(),
      changedProperties: Object.keys(styles)
    })
  }

  function scheduleInteractionCapture(target, state, sourceEvent, delay) {
    window.setTimeout(() => {
      if (!interactionRecorder?.active) {
        return
      }

      if (!(target instanceof Element) || !target.isConnected) {
        return
      }

      recordInteractionState(target, state, sourceEvent)
    }, delay)
  }

  function startInteractionRecording() {
    if (!selectedElement || !selectedElement.isConnected || !lastCapturePayload) {
      return {
        ok: false,
        error: "Capture a component before starting interaction recording."
      }
    }

    resetRecordedInteractions()

    const root = resolveRoot(selectedElement, lastCaptureOptions.ancestorLevel)
    const cleanup = []
    const addListener = (type, handler) => {
      document.addEventListener(type, handler, true)
      cleanup.push(() => document.removeEventListener(type, handler, true))
    }

    const hoverHandler = (event) => {
      const target = event.target
      if (!(target instanceof Element) || !root.contains(target) || target.closest(`#${OVERLAY_ROOT_ID}`)) {
        return
      }

      scheduleInteractionCapture(target, "hover", "mouseover", 90)
    }

    const activeHandler = (event) => {
      const target = event.target
      if (!(target instanceof Element) || !root.contains(target) || target.closest(`#${OVERLAY_ROOT_ID}`)) {
        return
      }

      scheduleInteractionCapture(target, "active", "mousedown", 30)
    }

    const focusHandler = (event) => {
      const target = event.target
      if (!(target instanceof Element) || !root.contains(target) || target.closest(`#${OVERLAY_ROOT_ID}`)) {
        return
      }

      scheduleInteractionCapture(target, "focus", "focusin", 30)
    }

    addListener("mouseover", hoverHandler)
    addListener("mousedown", activeHandler)
    addListener("focusin", focusHandler)

    interactionRecorder = {
      active: true,
      root,
      cleanup
    }

    return {
      ok: true
    }
  }

  async function stopInteractionRecording() {
    if (!interactionRecorder?.active) {
      return {
        ok: false,
        error: "No interaction recording is active."
      }
    }

    stopInteractionRecorderListeners()
    await captureSelection(lastCaptureOptions, { preserveInteractions: true, source: "interaction-recording" })

    return {
      ok: true,
      recordedStates: Object.values(recordedStateMap).reduce((count, item) => count + Object.keys(item.states || {}).length, 0)
    }
  }

  function buildCapturePayload(options) {
    if (!selectedElement || !selectedElement.isConnected) {
      return {
        ok: false,
        error: "The selected element is no longer available. Start a new capture."
      }
    }

    const resolvedOptions = normalizeCaptureOptions(options)

    const root = resolveRoot(selectedElement, resolvedOptions.ancestorLevel)
    const rootRect = root.getBoundingClientRect()
    const warnings = []
    const context = {
      count: 0,
      truncated: false,
      options: resolvedOptions,
      warnings: [],
      assets: {
        fonts: new Set(),
        images: new Set(),
        backgrounds: new Set()
      },
      animationNames: new Set(),
      animationNodes: []
    }

    const tree = walkNode(root, context, 0, null, "0")
    if (context.truncated) {
      warnings.push(`Capture was truncated at ${MAX_CAPTURE_NODES} nodes to keep the export manageable.`)
    }

    const keyframes = collectKeyframes(context.animationNames, warnings)
    const ancestorChain = collectAncestorChain(selectedElement)
    const recommended = ancestorChain.find((item) => item.recommended)
    const metadata = {
      url: location.href,
      pageTitle: document.title,
      pageBackground: getPageBackgroundColor(),
      capturedAt: new Date().toISOString(),
      selectedLabel: describeElement(selectedElement),
      rootTag: root.tagName.toLowerCase(),
      rootLabel: describeElement(root),
      rootRect: {
        x: rootRect.x,
        y: rootRect.y,
        width: rootRect.width,
        height: rootRect.height
      },
      ancestorChain,
      recommendedAncestorLevel: recommended?.level ?? 0,
      options: resolvedOptions,
      nodeCount: context.count,
      cssVariables: collectCssVariables()
    }

    if (Object.keys(recordedStateMap).length) {
      warnings.push("Recorded interaction states are approximate snapshots from the live page and may need cleanup.")
    }

    return {
      metadata,
      tree,
      animations: {
        keyframes,
        nodes: context.animationNodes
      },
      interactions: {
        recordedStates: Object.entries(recordedStateMap).flatMap(([path, item]) =>
          Object.entries(item.states || {}).map(([state, styles]) => ({
            path,
            label: item.label,
            state,
            styles
          }))
        ),
        events: recordedEvents
      },
      assets: {
        fonts: [...context.assets.fonts],
        images: [...context.assets.images],
        backgrounds: [...context.assets.backgrounds]
      },
      warnings: [...new Set([...warnings, ...context.warnings])]
    }
  }

  async function captureSelection(options, config = {}) {
    const normalizedOptions = normalizeCaptureOptions(options)

    if (!config.preserveInteractions) {
      resetRecordedInteractions()
    }

    lastCaptureOptions = normalizedOptions
    const payload = buildCapturePayload(normalizedOptions)
    if (payload.ok === false) {
      updateStatus(payload.error)
      return null
    }

    // No more auto-copy. The user picks Code or Figma explicitly from
    // the floating bar — that way the captured payload doesn't quietly
    // overwrite their clipboard, and the user gets the format they
    // actually want for the workflow they're in.
    payload.metadata.autoCopied = false

    lastCapturePayload = payload
    await chrome.runtime.sendMessage({ type: "CAPTURE_RESULT", payload })
    return payload
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "SET_CAPTURE_MODE") {
      if (message.enabled) {
        enableCaptureMode()
      } else {
        disableCaptureMode()
      }
      sendResponse({ ok: true })
      return true
    }

    if (message?.type === "START_INTERACTION_RECORDING") {
      sendResponse(startInteractionRecording())
      return true
    }

    if (message?.type === "STOP_INTERACTION_RECORDING") {
      stopInteractionRecording()
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }))
      return true
    }

    if (message?.type === "RECAPTURE") {
      if (!selectedElement) {
        sendResponse({ ok: false, error: "No previous selection is available in this tab." })
        return true
      }

      const nextOptions = normalizeCaptureOptions(message.options || { ancestorLevel: 0, maxDepth: null })
      const preserveInteractions = sameCaptureOptions(nextOptions)

      captureSelection(nextOptions, { preserveInteractions })
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }))
      return true
    }

    if (message?.type === "GET_CAPTURE_MODE") {
      sendResponse({ ok: true, captureMode })
      return true
    }

    sendResponse({ ok: false, error: "Unknown message type." })
    return true
  })

  window.addEventListener("pagehide", () => {
    stopInteractionRecorderListeners()
    disableCaptureMode()
    removeOverlay()
  })
})()

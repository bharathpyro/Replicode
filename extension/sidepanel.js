const statusText = document.getElementById("statusText")
const summaryEl = document.getElementById("summary")
const warningsEl = document.getElementById("warnings")
const manifestEl = document.getElementById("manifest")
const codeOutput = document.getElementById("codeOutput")
const copyCodeButton = document.getElementById("copyCode")
const copyFigmaPayloadButton = document.getElementById("copyFigmaPayload")
const ancestorLevelSelect = document.getElementById("ancestorLevel")
const maxDepthSelect = document.getElementById("maxDepth")
const outputFormatSelect = document.getElementById("outputFormat")
const recordingStatus = document.getElementById("recordingStatus")
const interactionList = document.getElementById("interactionList")

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"])

let extensionState = {
  currentTabId: null,
  tabState: null,
  capture: null
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message)
}

async function copyText(text, sourceElement) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    if (sourceElement instanceof HTMLTextAreaElement || sourceElement instanceof HTMLInputElement) {
      sourceElement.focus()
      sourceElement.select()
      sourceElement.setSelectionRange(0, sourceElement.value.length)
      return document.execCommand("copy")
    }

    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.setAttribute("readonly", "readonly")
    textarea.style.cssText = "position:fixed;left:-99999px;top:-99999px;opacity:0;"
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)
    const copied = document.execCommand("copy")
    document.body.removeChild(textarea)
    return copied
  }
}

function normalizeTokenList(value) {
  const tokens = String(value || "")
    .replace(/[#.]/g, " ")
    .match(/[a-zA-Z0-9]+/g)

  return tokens?.length ? tokens : []
}

function toCamelCase(value) {
  const tokens = normalizeTokenList(value)
  if (!tokens.length) {
    return "node"
  }

  return tokens
    .map((token, index) => {
      const lower = token.toLowerCase()
      if (index === 0) {
        return /^[0-9]/.test(lower) ? `n${lower}` : lower
      }

      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join("")
}

function toPascalCase(value) {
  const camel = toCamelCase(value)
  return camel.charAt(0).toUpperCase() + camel.slice(1)
}

function kebabCase(value) {
  return String(value)
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
}

function buildTreeText(node, level) {
  if (!node) {
    return ""
  }

  if (node.type === "text") {
    return `${"  ".repeat(level)}- "${node.text}"`
  }

  const lines = [`${"  ".repeat(level)}- <${node.tag}> ${node.label || ""}`]
  for (const child of node.children || []) {
    lines.push(buildTreeText(child, level + 1))
  }
  return lines.join("\n")
}

function buildSummary(capture) {
  if (!capture) {
    return "No selection captured yet."
  }

  const metadata = capture.metadata || {}
  const options = metadata.options || {}
  const recordedStates = capture.interactions?.recordedStates?.length || 0
  const recommendedAncestor = metadata.recommendedAncestorLevel ?? 0

  const lines = [
    `Selected: ${metadata.selectedLabel || "Unknown"}`,
    `Root: ${metadata.rootLabel || metadata.rootTag || "Unknown"}`,
    `Recommended root level: ${recommendedAncestor}`,
    `Page: ${metadata.pageTitle || "Untitled page"}`,
    `URL: ${metadata.url || "Unknown"}`,
    `Captured: ${metadata.capturedAt || "Unknown"}`,
    `Nodes: ${metadata.nodeCount || 0}`,
    `Root level: ${options.ancestorLevel ?? 0}`,
    `Depth: ${options.maxDepth === null ? "full" : options.maxDepth}`,
    `Recorded states: ${recordedStates}`
  ]

  if (metadata.rootRect) {
    lines.push(`Bounds: ${Math.round(metadata.rootRect.width)} x ${Math.round(metadata.rootRect.height)}`)
  }

  const recommendedNode = (metadata.ancestorChain || []).find((item) => item.recommended)
  if (recommendedNode?.reasons?.length) {
    lines.push(`Why this root: ${recommendedNode.reasons.join(", ")}`)
  }

  lines.push("")
  lines.push("Tree:")
  lines.push(buildTreeText(capture.tree, 0))

  return lines.join("\n")
}

function flattenElementNodes(node, output = []) {
  if (!node) {
    return output
  }

  if (node.type === "element") {
    output.push(node)
    for (const child of node.children || []) {
      flattenElementNodes(child, output)
    }
  }

  return output
}

function annotateTree(root) {
  const nodes = flattenElementNodes(root)
  const counts = {}

  nodes.forEach((node, index) => {
    const baseKey = index === 0 ? "root" : (() => {
      const tag = toCamelCase(node.tag || "node")
      counts[tag] = (counts[tag] || 0) + 1
      return `${tag}${counts[tag]}`
    })()

    node.__styleKey = baseKey
    node.__className = index === 0 ? "ui-extractor-root" : `ui-extractor-${kebabCase(baseKey)}`
  })

  return nodes
}

function renderHtmlNode(node) {
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

  const childMarkup = (node.children || []).map((child) => renderHtmlNode(child)).join("")
  if (VOID_TAGS.has(node.tag)) {
    return `<${node.tag}${attrString}>`
  }

  if (node.tag === "svg" && typeof node.svgInnerMarkup === "string") {
    return `<svg${attrString}>${node.svgInnerMarkup}</svg>`
  }

  return `<${node.tag}${attrString}>${childMarkup}</${node.tag}>`
}

function mapJsxAttributeName(name) {
  if (name === "class") {
    return "className"
  }

  if (name === "for") {
    return "htmlFor"
  }

  if (name === "srcset") {
    return "srcSet"
  }

  return name
}

function renderJsxAttributes(node) {
  const attrs = []
  attrs.push(`className={styles.${node.__styleKey}}`)

  for (const [key, value] of Object.entries(node.attributes || {})) {
    const attrName = mapJsxAttributeName(key)
    attrs.push(`${attrName}=${JSON.stringify(value)}`)
  }

  return attrs.length ? ` ${attrs.join(" ")}` : ""
}

function renderJsxText(text) {
  return `{${JSON.stringify(text)}}`
}

function renderJsxNode(node, depth = 2) {
  const indent = "  ".repeat(depth)
  if (!node) {
    return `${indent}null`
  }

  if (node.type === "text") {
    return `${indent}${renderJsxText(node.text)}`
  }

  const attrs = renderJsxAttributes(node)
  const children = node.children || []

  if (node.tag === "svg" && typeof node.svgInnerMarkup === "string") {
    const svgMarkup = renderHtmlNode(node)
    return `${indent}<span dangerouslySetInnerHTML={{ __html: ${JSON.stringify(svgMarkup)} }} />`
  }

  if (VOID_TAGS.has(node.tag)) {
    return `${indent}<${node.tag}${attrs} />`
  }

  if (children.length === 0) {
    return `${indent}<${node.tag}${attrs}></${node.tag}>`
  }

  if (children.length === 1 && children[0].type === "text") {
    return `${indent}<${node.tag}${attrs}>${renderJsxText(children[0].text)}</${node.tag}>`
  }

  const childMarkup = children.map((child) => renderJsxNode(child, depth + 1)).join("\n")
  return `${indent}<${node.tag}${attrs}>\n${childMarkup}\n${indent}</${node.tag}>`
}

function renderRule(selector, styles) {
  const declarations = Object.entries(styles || {})
    .map(([prop, value]) => `  ${prop}: ${value};`)
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

function renderStateRules(node, selector) {
  const rules = []
  const states = node.states || {}

  if (states.hover && Object.keys(states.hover).length) {
    rules.push(renderRule(`${selector}:hover`, states.hover))
  }

  if (states.focus && Object.keys(states.focus).length) {
    rules.push(renderRule(`${selector}:focus`, states.focus))
  }

  if (states.active && Object.keys(states.active).length) {
    rules.push(renderRule(`${selector}:active`, states.active))
  }

  return rules.filter(Boolean)
}

function renderCssBlocks(nodes, selectorBuilder) {
  const blocks = []

  for (const node of nodes) {
    const selector = selectorBuilder(node)
    const baseRule = renderRule(selector, pruneExportStyles(node.styles || {}))
    if (baseRule) {
      blocks.push(baseRule)
    }

    const beforeRule = renderRule(`${selector}::before`, normalizePseudoStylesForExport(node.pseudo?.before))
    if (beforeRule) {
      blocks.push(beforeRule)
    }

    const afterRule = renderRule(`${selector}::after`, normalizePseudoStylesForExport(node.pseudo?.after))
    if (afterRule) {
      blocks.push(afterRule)
    }

    blocks.push(...renderStateRules(node, selector))
  }

  return blocks.filter(Boolean).join("\n\n")
}

function buildManifest(capture) {
  if (!capture) {
    return "No capture manifest available."
  }

  const lines = ["Capture manifest", "================", ""]
  const metadata = capture.metadata || {}
  const assets = capture.assets || {}
  const animations = capture.animations || {}
  const interactions = capture.interactions || {}

  lines.push("Root suggestions:")
  if (metadata.ancestorChain?.length) {
    for (const item of metadata.ancestorChain) {
      const recommendation = item.recommended ? " [recommended]" : ""
      const reasons = item.reasons?.length ? ` — ${item.reasons.join(", ")}` : ""
      lines.push(`- level ${item.level}${recommendation} | score ${item.score}: ${item.label}${reasons}`)
    }
  } else {
    lines.push("- No root suggestions available")
  }

  lines.push("")
  lines.push("Fonts:")
  if (assets.fonts?.length) {
    for (const font of assets.fonts) {
      lines.push(`- ${font}`)
    }
  } else {
    lines.push("- None detected")
  }

  lines.push("")
  lines.push("Images:")
  if (assets.images?.length) {
    for (const image of assets.images) {
      lines.push(`- ${image}`)
    }
  } else {
    lines.push("- None detected")
  }

  lines.push("")
  lines.push("Background images:")
  if (assets.backgrounds?.length) {
    for (const image of assets.backgrounds) {
      lines.push(`- ${image}`)
    }
  } else {
    lines.push("- None detected")
  }

  lines.push("")
  lines.push("Animations:")
  if (animations.nodes?.length) {
    for (const item of animations.nodes) {
      const parts = []
      if (item.transition?.property) {
        parts.push(`transition ${item.transition.property} ${item.transition.duration || ""} ${item.transition.timingFunction || ""}`.trim())
      }
      if (item.animation?.name && item.animation.name !== "none") {
        parts.push(`animation ${item.animation.name} ${item.animation.duration || ""}`.trim())
      }
      lines.push(`- ${item.path}: ${parts.join(" | ") || "static"}`)
    }
  } else {
    lines.push("- None detected")
  }

  lines.push("")
  lines.push("Keyframes:")
  if (animations.keyframes?.length) {
    for (const frame of animations.keyframes) {
      lines.push(`- ${frame.name} (${frame.source})`)
    }
  } else {
    lines.push("- None captured")
  }

  lines.push("")
  lines.push("Recorded states:")
  if (interactions.recordedStates?.length) {
    for (const item of interactions.recordedStates) {
      lines.push(`- ${item.state} on ${item.path} (${item.label}) — ${Object.keys(item.styles || {}).length} properties`)
    }
  } else {
    lines.push("- None recorded")
  }

  lines.push("")
  lines.push("Warnings:")
  if (capture.warnings?.length) {
    for (const warning of capture.warnings) {
      lines.push(`- ${warning}`)
    }
  } else {
    lines.push("- None")
  }

  return lines.join("\n")
}

function generateHtmlCss(capture) {
  const rootClone = JSON.parse(JSON.stringify(capture.tree))
  const nodes = annotateTree(rootClone)
  const html = renderHtmlNode(rootClone)
  const cssBlocks = renderCssBlocks(nodes, (node) => `.${node.__className}`)
  const keyframes = (capture.animations?.keyframes || []).map((item) => item.cssText).join("\n\n")
  const css = [cssBlocks, keyframes].filter(Boolean).join("\n\n")

  return [
    "<!-- component.html -->",
    html,
    "",
    "/* styles.css */",
    css || "/* No scoped CSS properties were captured. */"
  ].join("\n")
}

function generateReactCssModule(capture) {
  const rootClone = JSON.parse(JSON.stringify(capture.tree))
  const nodes = annotateTree(rootClone)
  const componentName = toPascalCase(capture.metadata?.rootLabel || capture.metadata?.rootTag || "CapturedComponent")
  const jsx = renderJsxNode(rootClone, 2)
  const cssBlocks = renderCssBlocks(nodes, (node) => `.${node.__styleKey}`)
  const keyframes = (capture.animations?.keyframes || []).map((item) => item.cssText).join("\n\n")
  const css = [cssBlocks, keyframes].filter(Boolean).join("\n\n")

  return [
    `// ${componentName}.tsx`,
    `import styles from "./${componentName}.module.css"`,
    "",
    `export function ${componentName}() {`,
    "  return (",
    jsx,
    "  )",
    "}",
    "",
    `/* ${componentName}.module.css */`,
    css || "/* No scoped CSS properties were captured. */"
  ].join("\n")
}

function generateFigmaImportJson(capture) {
  return window.ReplicodeFigmaExport?.generateImportJson(capture) || ""
}

function getCurrentFigmaPayload() {
  if (!extensionState.capture) {
    return ""
  }

  return generateFigmaImportJson(extensionState.capture)
}

function renderInteractionList(capture) {
  interactionList.innerHTML = ""
  const states = capture?.interactions?.recordedStates || []

  if (!states.length) {
    const item = document.createElement("li")
    item.textContent = "No interaction states recorded for this capture."
    interactionList.appendChild(item)
    return
  }

  for (const state of states) {
    const item = document.createElement("li")
    item.textContent = `${state.state} on ${state.label} (${state.path}) — ${Object.keys(state.styles || {}).length} properties`
    interactionList.appendChild(item)
  }
}

function renderOutput() {
  const capture = extensionState.capture
  const format = outputFormatSelect.value

  summaryEl.textContent = buildSummary(capture)
  warningsEl.innerHTML = ""

  if (capture?.warnings?.length) {
    for (const warning of capture.warnings) {
      const item = document.createElement("li")
      item.textContent = warning
      warningsEl.appendChild(item)
    }
  } else {
    const item = document.createElement("li")
    item.textContent = "No warnings for the current capture."
    warningsEl.appendChild(item)
  }

  renderInteractionList(capture)
  manifestEl.textContent = buildManifest(capture)

  if (!capture) {
    codeOutput.value = ""
    return
  }

  if (format === "json") {
    copyCodeButton.textContent = "Copy JSON"
    codeOutput.value = JSON.stringify(capture, null, 2)
    return
  }

  if (format === "figma-import") {
    copyCodeButton.textContent = "Copy Figma payload"
    codeOutput.value = generateFigmaImportJson(capture)
    return
  }

  if (format === "react-css-module") {
    copyCodeButton.textContent = "Copy output"
    codeOutput.value = generateReactCssModule(capture)
    return
  }

  copyCodeButton.textContent = "Copy output"
  codeOutput.value = generateHtmlCss(capture)
}

async function refreshState() {
  const state = await sendMessage({ type: "GET_EXTENSION_STATE" })
  if (!state?.ok) {
    statusText.textContent = "Unable to read extension state."
    return
  }

  extensionState = state
  statusText.textContent = state.tabState?.captureMode
    ? "Capture mode is active. Hover the page and click a component."
    : state.capture?.metadata?.rootLabel
      ? `Captured ${state.capture.metadata.rootLabel}`
      : "Waiting for a capture."

  recordingStatus.textContent = state.tabState?.interactionRecording
    ? "Recording interaction states. Hover, focus, or click inside the selected component, then stop recording."
    : "Capture hover, focus, and active states from the live page."

  const ancestors = state.capture?.metadata?.ancestorChain || []
  ancestorLevelSelect.innerHTML = ""

  if (ancestors.length) {
    for (const item of ancestors) {
      const option = document.createElement("option")
      option.value = String(item.level)
      const recommendation = item.recommended ? " (recommended)" : ""
      option.textContent = `${item.level}: ${item.label}${recommendation}`
      ancestorLevelSelect.appendChild(option)
    }

    const selectedLevel = state.capture?.metadata?.options?.ancestorLevel ?? state.capture?.metadata?.recommendedAncestorLevel ?? 0
    ancestorLevelSelect.value = String(selectedLevel)
  } else {
    const option = document.createElement("option")
    option.value = "0"
    option.textContent = "0: current selection"
    ancestorLevelSelect.appendChild(option)
  }

  const currentDepth = state.capture?.metadata?.options?.maxDepth
  maxDepthSelect.value = currentDepth === null || currentDepth === undefined ? "full" : String(currentDepth)

  renderOutput()
}

async function recapture() {
  const ancestorLevel = Number(ancestorLevelSelect.value || 0)
  const maxDepthRaw = maxDepthSelect.value
  const maxDepth = maxDepthRaw === "full" ? null : Number(maxDepthRaw)

  statusText.textContent = "Re-running capture..."
  const result = await sendMessage({
    type: "RECAPTURE_FROM_PANEL",
    options: {
      ancestorLevel,
      maxDepth
    }
  })

  statusText.textContent = result?.ok ? "Capture refreshed." : result?.error || "Could not re-run capture."
  await refreshState()
}

async function startRecording() {
  statusText.textContent = "Starting interaction recording..."
  const result = await sendMessage({ type: "START_INTERACTION_RECORDING" })
  statusText.textContent = result?.ok
    ? "Recording interactions. Trigger hover, focus, or active states inside the selected component."
    : result?.error || "Could not start interaction recording."
  await refreshState()
}

async function stopRecording() {
  statusText.textContent = "Stopping interaction recording..."
  const result = await sendMessage({ type: "STOP_INTERACTION_RECORDING" })
  statusText.textContent = result?.ok
    ? `Stopped recording. Captured ${result.recordedStates || 0} state snapshots.`
    : result?.error || "Could not stop interaction recording."
  await refreshState()
}

document.getElementById("startCapture").addEventListener("click", async () => {
  statusText.textContent = "Starting capture mode..."
  const result = await sendMessage({ type: "START_CAPTURE" })
  statusText.textContent = result?.ok
    ? "Capture mode is live. Hover the page and click a component."
    : result?.error || "Could not start capture mode."
})

document.getElementById("stopCapture").addEventListener("click", async () => {
  const result = await sendMessage({ type: "STOP_CAPTURE" })
  statusText.textContent = result?.ok ? "Capture mode stopped." : result?.error || "Nothing to stop."
  await refreshState()
})

document.getElementById("refreshState").addEventListener("click", refreshState)
document.getElementById("recapture").addEventListener("click", recapture)
document.getElementById("startRecording").addEventListener("click", startRecording)
document.getElementById("stopRecording").addEventListener("click", stopRecording)
outputFormatSelect.addEventListener("change", renderOutput)

document.getElementById("copyCode").addEventListener("click", async () => {
  if (!codeOutput.value) {
    return
  }

  const copied = await copyText(codeOutput.value, codeOutput)
  statusText.textContent = copied ? "Copied generated output." : "Copy failed. Select the code manually and copy it."
})

copyFigmaPayloadButton.addEventListener("click", async () => {
  const payload = getCurrentFigmaPayload()
  if (!payload) {
    statusText.textContent = "No capture available to convert into a Figma payload."
    return
  }

  const copied = await copyText(payload, codeOutput)
  statusText.textContent = copied
    ? 'Copied Figma payload. Paste it into the Figma plugin.'
    : 'Figma payload copy failed. Switch output to "Figma Import JSON" and copy manually.'
})

document.getElementById("copyManifest").addEventListener("click", async () => {
  const copied = await copyText(manifestEl.textContent, codeOutput)
  statusText.textContent = copied ? "Copied manifest." : "Manifest copy failed."
})

document.getElementById("clearCapture").addEventListener("click", async () => {
  await sendMessage({ type: "CLEAR_CAPTURE" })
  statusText.textContent = "Cleared stored capture."
  await refreshState()
})

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "CAPTURE_UPDATED") {
    refreshState()
  }
})

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return
  }

  if (changes.currentTabId) {
    refreshState()
    return
  }

  const tabId = extensionState.currentTabId
  if (!tabId) {
    return
  }

  if (changes[`capture:${tabId}`] || changes[`state:${tabId}`]) {
    refreshState()
  }
})

refreshState()

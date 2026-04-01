figma.showUI(__html__, {
  width: 420,
  height: 620,
  themeColors: true
})

let availableFontsPromise = null

function normalizeImportOptions(options) {
  return {
    mode: options && options.mode ? options.mode : "hybrid",
    importImages: !options || options.importImages !== false
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function parseNumber(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  const match = String(value || "").match(/-?\d+(\.\d+)?/)
  return match ? Number(match[0]) : (fallback || 0)
}

function parsePx(value, fallback) {
  return parseNumber(value, fallback || 0)
}

function normalizeUnitInterval(value) {
  return clamp(value, 0, 1)
}

function normalizeRgbChannel(value) {
  const linear = clamp(value, 0, 1)
  if (linear <= 0.0031308) {
    return linear * 12.92
  }

  return 1.055 * Math.pow(linear, 1 / 2.4) - 0.055
}

function parseFunctionalColorArgs(value) {
  return String(value || "")
    .replace(/\//g, " / ")
    .split(/[\s,]+/)
    .map(function(part) {
      return part.trim()
    })
    .filter(Boolean)
}

function parseAlphaValue(value) {
  if (!value) {
    return 1
  }

  if (String(value).trim().endsWith("%")) {
    return clamp(parseNumber(value, 100) / 100, 0, 1)
  }

  return clamp(parseNumber(value, 1), 0, 1)
}

function parseOklabColor(functionName, rawArgs) {
  const parts = parseFunctionalColorArgs(rawArgs)
  const slashIndex = parts.indexOf("/")
  const colorParts = slashIndex >= 0 ? parts.slice(0, slashIndex) : parts
  const alpha = slashIndex >= 0
    ? parseAlphaValue(parts[slashIndex + 1])
    : (colorParts.length > 3 ? parseAlphaValue(colorParts[3]) : 1)

  if (colorParts.length < 3) {
    return null
  }

  const lightnessInput = colorParts[0]
  const lightness = lightnessInput.endsWith("%")
    ? parseNumber(lightnessInput, 0) / 100
    : parseNumber(lightnessInput, 0)
  let a = parseNumber(colorParts[1], 0)
  let b = parseNumber(colorParts[2], 0)

  if (functionName === "oklch") {
    const chroma = a
    const hue = parseNumber(colorParts[2], 0) * (Math.PI / 180)
    a = chroma * Math.cos(hue)
    b = chroma * Math.sin(hue)
  }

  const lComponent = Math.pow(lightness + 0.3963377774 * a + 0.2158037573 * b, 3)
  const mComponent = Math.pow(lightness - 0.1055613458 * a - 0.0638541728 * b, 3)
  const sComponent = Math.pow(lightness - 0.0894841775 * a - 1.291485548 * b, 3)

  const r = normalizeRgbChannel(4.0767416621 * lComponent - 3.3077115913 * mComponent + 0.2309699292 * sComponent)
  const g = normalizeRgbChannel(-1.2684380046 * lComponent + 2.6097574011 * mComponent - 0.3413193965 * sComponent)
  const blue = normalizeRgbChannel(-0.0041960863 * lComponent - 0.7034186147 * mComponent + 1.707614701 * sComponent)

  return {
    r: Math.round(normalizeUnitInterval(r) * 255),
    g: Math.round(normalizeUnitInterval(g) * 255),
    b: Math.round(normalizeUnitInterval(blue) * 255),
    a: alpha
  }
}

function extractFirstUrl(value) {
  const input = String(value || "").trim()
  if (!input || input === "none") {
    return ""
  }

  const cssUrlMatch = input.match(/url\((['"]?)(.*?)\1\)/i)
  if (cssUrlMatch && cssUrlMatch[2]) {
    return cssUrlMatch[2].trim()
  }

  const srcsetCandidate = input.split(",")[0].trim()
  if (!srcsetCandidate) {
    return ""
  }

  return srcsetCandidate.split(/\s+/)[0]
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function parseColor(value) {
  const input = String(value || "").trim()
  if (!input || input === "transparent" || input === "none") {
    return null
  }

  if (input.startsWith("#")) {
    let hex = input.slice(1)
    if (hex.length === 3) {
      hex = hex
        .split("")
        .map(function(part) {
          return part + part
        })
        .join("")
    }

    if (hex.length !== 6 && hex.length !== 8) {
      return null
    }

    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
    }
  }

  const rgbMatch = input.match(/rgba?\(([^)]+)\)/i)
  if (rgbMatch) {
    const parts = rgbMatch[1].split(",").map(function(part) {
      return part.trim()
    })
    if (parts.length < 3) {
      return null
    }

    return {
      r: clamp(Number(parts[0]), 0, 255),
      g: clamp(Number(parts[1]), 0, 255),
      b: clamp(Number(parts[2]), 0, 255),
      a: parts[3] === undefined ? 1 : clamp(Number(parts[3]), 0, 1)
    }
  }

  const hslMatch = input.match(/hsla?\(([^)]+)\)/i)
  if (hslMatch) {
    const parts = parseFunctionalColorArgs(hslMatch[1])
    const slashIndex = parts.indexOf("/")
    const colorParts = slashIndex >= 0 ? parts.slice(0, slashIndex) : parts
    const alpha = slashIndex >= 0
      ? parseAlphaValue(parts[slashIndex + 1])
      : (colorParts.length > 3 ? parseAlphaValue(colorParts[3]) : 1)
    if (colorParts.length < 3) {
      return null
    }

    const hue = ((parseNumber(colorParts[0], 0) % 360) + 360) % 360
    const saturation = clamp(parseNumber(colorParts[1], 0) / 100, 0, 1)
    const lightness = clamp(parseNumber(colorParts[2], 0) / 100, 0, 1)
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
    const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
    const matchLightness = lightness - chroma / 2
    let red = 0
    let green = 0
    let blue = 0

    if (hue < 60) {
      red = chroma
      green = x
    } else if (hue < 120) {
      red = x
      green = chroma
    } else if (hue < 180) {
      green = chroma
      blue = x
    } else if (hue < 240) {
      green = x
      blue = chroma
    } else if (hue < 300) {
      red = x
      blue = chroma
    } else {
      red = chroma
      blue = x
    }

    return {
      r: Math.round((red + matchLightness) * 255),
      g: Math.round((green + matchLightness) * 255),
      b: Math.round((blue + matchLightness) * 255),
      a: alpha
    }
  }

  const oklabMatch = input.match(/^(oklab|oklch)\(([^)]+)\)$/i)
  if (oklabMatch) {
    return parseOklabColor(oklabMatch[1].toLowerCase(), oklabMatch[2])
  }

  return null
}

function toSolidPaint(value) {
  const parsed = parseColor(value)
  if (!parsed) {
    return null
  }

  const paint = {
    type: "SOLID",
    color: {
      r: parsed.r / 255,
      g: parsed.g / 255,
      b: parsed.b / 255
    }
  }

  if (parsed.a < 1) {
    paint.opacity = parsed.a
  }

  return paint
}

function parseBoxValues(styles, prefix) {
  const top = parsePx(styles[prefix + "-top"], 0)
  const right = parsePx(styles[prefix + "-right"], top)
  const bottom = parsePx(styles[prefix + "-bottom"], top)
  const left = parsePx(styles[prefix + "-left"], right)

  return {
    top: top,
    right: right,
    bottom: bottom,
    left: left
  }
}

function mergeStyles(baseStyles, overrideStyles) {
  return Object.assign({}, baseStyles || {}, overrideStyles || {})
}

function parseBorderRadius(value) {
  return Math.max(0, parsePx(String(value || "").split(/\s+/)[0], 0))
}

function parseLineHeight(value) {
  const input = String(value || "").trim()
  if (!input || input === "normal") {
    return null
  }

  if (input.endsWith("px")) {
    return {
      unit: "PIXELS",
      value: Math.max(1, parsePx(input, 0))
    }
  }

  if (input.endsWith("%")) {
    return {
      unit: "PERCENT",
      value: Math.max(1, parseNumber(input, 100))
    }
  }

  const numericValue = Number(input)
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return {
      unit: "PERCENT",
      value: numericValue * 100
    }
  }

  return null
}

function parseLetterSpacing(value) {
  const input = String(value || "").trim()
  if (!input || input === "normal") {
    return null
  }

  if (input.endsWith("px")) {
    return {
      unit: "PIXELS",
      value: parsePx(input, 0)
    }
  }

  if (input.endsWith("%")) {
    return {
      unit: "PERCENT",
      value: parseNumber(input, 0)
    }
  }

  if (input.endsWith("em")) {
    return {
      unit: "PERCENT",
      value: parseNumber(input, 0) * 100
    }
  }

  return null
}

function parseBoxShadow(value) {
  const input = String(value || "").trim()
  if (!input || input === "none") {
    return null
  }

  const firstShadow = input.split(/,(?![^(]*\))/)[0]
  const colorMatch = firstShadow.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8})/)
  const color = toSolidPaint(colorMatch ? colorMatch[1] : "rgba(15, 23, 42, 0.12)")
  if (!color) {
    return null
  }

  const numericValues = []
  const numericMatcher = /-?\d+(\.\d+)?(?=px)/g
  let numericMatch = numericMatcher.exec(firstShadow)
  while (numericMatch) {
    numericValues.push(Number(numericMatch[0]))
    numericMatch = numericMatcher.exec(firstShadow)
  }

  return {
    type: "DROP_SHADOW",
    color: {
      r: color.color.r,
      g: color.color.g,
      b: color.color.b,
      a: color.opacity === undefined ? 1 : color.opacity
    },
    offset: {
      x: numericValues[0] || 0,
      y: numericValues[1] || 0
    },
    radius: numericValues[2] || 0,
    spread: numericValues[3] || 0,
    visible: true,
    blendMode: "NORMAL"
  }
}

function hasVisibleBorder(styles) {
  const borderWidths = [
    parsePx(styles["border-top-width"], 0),
    parsePx(styles["border-right-width"], 0),
    parsePx(styles["border-bottom-width"], 0),
    parsePx(styles["border-left-width"], 0)
  ]
  const borderStyles = [
    String(styles["border-top-style"] || "none"),
    String(styles["border-right-style"] || "none"),
    String(styles["border-bottom-style"] || "none"),
    String(styles["border-left-style"] || "none")
  ]

  return borderWidths.some(function(width, index) {
    return width > 0 && borderStyles[index] !== "none"
  })
}

function hasVisiblePadding(styles) {
  const padding = parseBoxValues(styles, "padding")
  return padding.top > 0 || padding.right > 0 || padding.bottom > 0 || padding.left > 0
}

function hasRenderableBoxStyles(styles) {
  return !!(
    toSolidPaint(styles["background-color"]) ||
    extractFirstUrl(styles["background-image"]) ||
    parseBoxShadow(styles["box-shadow"]) ||
    hasVisibleBorder(styles) ||
    hasVisiblePadding(styles)
  )
}

function isPlainTextContainer(node) {
  if (!node || node.type !== "element") {
    return false
  }

  if (["svg", "img", "input", "textarea", "select"].includes(node.tag)) {
    return false
  }

  const children = getRenderableChildren(node)
  if (children.length !== 1 || children[0].type !== "text") {
    return false
  }

  const styles = node.styles || {}
  const display = String(styles.display || "").trim()
  if (display.includes("flex") || display.includes("grid")) {
    return false
  }

  return !hasRenderableBoxStyles(styles)
}

function shouldIgnoreNode(node, isRoot) {
  if (!node) {
    return true
  }

  if (node.type === "text") {
    return !String(node.text || "").trim()
  }

  const styles = node.styles || {}
  const display = String(styles.display || "").trim()
  const visibility = String(styles.visibility || "").trim()
  const opacity = styles.opacity === undefined ? 1 : Number(styles.opacity)
  const inputType = String((node.attributes && node.attributes.type) || "").toLowerCase()

  if (!isRoot && (display === "none" || visibility === "hidden" || visibility === "collapse" || opacity === 0 || (node.tag === "input" && inputType === "hidden"))) {
    return true
  }

  if (["defs", "clippath", "clipPath", "mask", "metadata", "desc", "title"].includes(node.tag)) {
    return true
  }

  return false
}

function shouldClipContent(styles) {
  const overflow = String(styles.overflow || "").trim()
  const overflowX = String(styles["overflow-x"] || "").trim()
  const overflowY = String(styles["overflow-y"] || "").trim()
  return overflow === "hidden" || overflow === "clip" || overflowX === "hidden" || overflowX === "clip" || overflowY === "hidden" || overflowY === "clip"
}

function getRenderableChildren(node) {
  return (node.children || []).filter(function(child) {
    return child && (child.type === "element" || child.type === "text")
  })
}

function getNodeMetrics(node) {
  return node && node.metrics ? node.metrics : null
}

function isAbsolutelyPositioned(child) {
  const styles = child && child.styles ? child.styles : {}
  const position = String(styles.position || "static").trim()
  return position === "absolute" || position === "fixed"
}

function getLayoutDirection(node) {
  const styles = node.styles || {}
  return String(styles["flex-direction"] || "row").startsWith("column") ? "VERTICAL" : "HORIZONTAL"
}

function childrenAreLinear(children, direction, parentMetrics) {
  if (!children.length) {
    return false
  }

  let previousEnd = null
  let minCross = null
  let maxCross = null

  for (const child of children) {
    const metrics = getNodeMetrics(child)
    if (!metrics) {
      return false
    }

    const mainStart = direction === "HORIZONTAL" ? metrics.x : metrics.y
    const mainEnd = mainStart + (direction === "HORIZONTAL" ? metrics.width : metrics.height)
    const crossStart = direction === "HORIZONTAL" ? metrics.y : metrics.x

    if (previousEnd !== null && mainStart < previousEnd - 12) {
      return false
    }

    previousEnd = mainEnd
    minCross = minCross === null ? crossStart : Math.min(minCross, crossStart)
    maxCross = maxCross === null ? crossStart : Math.max(maxCross, crossStart)
  }

  const crossSize = parentMetrics ? (direction === "HORIZONTAL" ? parentMetrics.height : parentMetrics.width) : 0
  return maxCross - minCross <= Math.max(8, crossSize * 0.08)
}

function canUseAutoLayout(node, options) {
  if (options.mode === "accurate") {
    return false
  }

  const styles = node.styles || {}
  const display = String(styles.display || "")
  if (!display.includes("flex")) {
    return false
  }

  if (String(styles["flex-wrap"] || "nowrap").trim() !== "nowrap") {
    return false
  }

  const children = getRenderableChildren(node)
  if (children.length < 1) {
    return false
  }

  for (const child of children) {
    if (child.type === "element" && isAbsolutelyPositioned(child)) {
      return false
    }
  }

  return childrenAreLinear(children, getLayoutDirection(node), getNodeMetrics(node))
}

function mapPrimaryAxisAlignment(value) {
  switch (String(value || "").trim()) {
    case "center":
      return "CENTER"
    case "flex-end":
    case "end":
      return "MAX"
    case "space-between":
    case "space-around":
    case "space-evenly":
      return "SPACE_BETWEEN"
    default:
      return "MIN"
  }
}

function mapCounterAxisAlignment(value) {
  switch (String(value || "").trim()) {
    case "center":
      return "CENTER"
    case "flex-end":
    case "end":
      return "MAX"
    case "baseline":
      return "BASELINE"
    default:
      return "MIN"
  }
}

function mapTextAlign(value) {
  switch (String(value || "").trim()) {
    case "center":
      return "CENTER"
    case "right":
    case "end":
      return "RIGHT"
    case "justify":
      return "JUSTIFIED"
    default:
      return "LEFT"
  }
}

async function createRemoteImagePaint(url) {
  if (!url) {
    return null
  }

  try {
    const image = await figma.createImageAsync(url)
    return {
      type: "IMAGE",
      imageHash: image.hash,
      scaleMode: "FILL"
    }
  } catch (error) {
    return null
  }
}

async function getAvailableFonts() {
  if (!availableFontsPromise) {
    availableFontsPromise = figma.listAvailableFontsAsync()
  }

  return availableFontsPromise
}

function buildFontIndex(fonts) {
  const families = new Map()

  for (const font of fonts) {
    const key = normalizeFontFamilyKey(font.fontName.family)
    const existing = families.get(key) || []
    existing.push(font.fontName)
    families.set(key, existing)
  }

  return families
}

function normalizeFontFamilyKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function expandFontFamilyAliases(family) {
  const normalized = String(family || "").trim().replace(/^['"]|['"]$/g, "")
  if (!normalized) {
    return []
  }

  const aliases = new Set([normalized])
  const withoutVariableSuffix = normalized.replace(/\s*(vf|variable)\s*$/i, "").trim()
  if (withoutVariableSuffix && withoutVariableSuffix !== normalized) {
    aliases.add(withoutVariableSuffix)
  }

  if (/^geistvf$/i.test(normalized) || /^geist vf$/i.test(normalized)) {
    aliases.add("Geist")
  }

  return Array.from(aliases)
}

function splitFontFamilies(value) {
  return String(value || "")
    .split(",")
    .map(function(part) {
      return part.trim().replace(/^['"]|['"]$/g, "")
    })
    .filter(Boolean)
}

function estimateFontWeight(styleName) {
  const normalized = String(styleName || "").toLowerCase()

  if (normalized.includes("thin") || normalized.includes("hairline")) {
    return 100
  }

  if (normalized.includes("extra light") || normalized.includes("extralight") || normalized.includes("ultra light") || normalized.includes("ultralight")) {
    return 200
  }

  if (normalized.includes("light")) {
    return 300
  }

  if (normalized.includes("medium")) {
    return 500
  }

  if (normalized.includes("semi bold") || normalized.includes("semibold") || normalized.includes("demi bold") || normalized.includes("demibold")) {
    return 600
  }

  if (normalized.includes("extra bold") || normalized.includes("extrabold") || normalized.includes("ultra bold") || normalized.includes("ultrabold")) {
    return 800
  }

  if (normalized.includes("black") || normalized.includes("heavy")) {
    return 900
  }

  if (normalized.includes("bold")) {
    return 700
  }

  return 400
}

function pickClosestFont(candidates, styles) {
  if (!candidates || !candidates.length) {
    return null
  }

  const desiredWeight = parseNumber(styles["font-weight"], 400)
  const wantsItalic = /italic|oblique/i.test(String(styles["font-style"] || ""))
  let bestMatch = candidates[0]
  let bestScore = Number.POSITIVE_INFINITY

  for (const font of candidates) {
    const styleName = String(font.style || "")
    const isItalic = /italic|oblique/i.test(styleName)
    const score =
      Math.abs(estimateFontWeight(styleName) - desiredWeight) +
      (isItalic === wantsItalic ? 0 : 250)

    if (score < bestScore) {
      bestScore = score
      bestMatch = font
    }
  }

  return bestMatch
}

async function resolveFontName(styles) {
  const fonts = await getAvailableFonts()
  const fontIndex = buildFontIndex(fonts)
  const families = splitFontFamilies(styles["font-family"])

  for (const family of families) {
    for (const alias of expandFontFamilyAliases(family)) {
      const candidates = fontIndex.get(normalizeFontFamilyKey(alias))
      if (candidates && candidates.length) {
        return pickClosestFont(candidates, styles) || candidates[0]
      }
    }
  }

  const fallbacks = ["Inter", "Roboto", "Arial", "SF Pro Text"]
  for (const family of fallbacks) {
    const candidates = fontIndex.get(normalizeFontFamilyKey(family))
    if (candidates && candidates.length) {
      return pickClosestFont(candidates, styles) || candidates[0]
    }
  }

  return (fonts[0] && fonts[0].fontName) || { family: "Inter", style: "Regular" }
}

function resizeNode(node, metrics) {
  const width = Math.max(1, Math.round((metrics && metrics.width) || 1))
  const height = Math.max(1, Math.round((metrics && metrics.height) || 1))

  if ("resize" in node) {
    node.resize(width, height)
  }
}

function buildSvgAttributes(node, isRoot) {
  const attributes = {}
  const source = node.attributes || {}

  for (const key in source) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      continue
    }

    if (source[key] === undefined || source[key] === null || source[key] === "") {
      continue
    }

    attributes[key] = source[key]
  }

  if (isRoot) {
    attributes.xmlns = attributes.xmlns || "http://www.w3.org/2000/svg"
    if (!attributes.width && node.metrics && node.metrics.width) {
      attributes.width = String(Math.round(node.metrics.width))
    }
    if (!attributes.height && node.metrics && node.metrics.height) {
      attributes.height = String(Math.round(node.metrics.height))
    }

    const styleParts = []
    if (node.styles && node.styles.color) {
      styleParts.push("color:" + node.styles.color)
    }
    if (styleParts.length) {
      attributes.style = attributes.style ? attributes.style + ";" + styleParts.join(";") : styleParts.join(";")
    }
  }

  return Object.keys(attributes)
    .map(function(key) {
      return key + "=\"" + escapeXml(attributes[key]) + "\""
    })
    .join(" ")
}

function serializeSvgNode(node, isRoot) {
  if (!node) {
    return ""
  }

  if (node.type === "text") {
    return escapeXml(node.text || "")
  }

  const tagName = node.tag || "g"
  const attributes = buildSvgAttributes(node, !!isRoot)
  const children = (node.children || [])
    .map(function(child) {
      return serializeSvgNode(child, false)
    })
    .join("")

  if (!children) {
    return "<" + tagName + (attributes ? " " + attributes : "") + " />"
  }

  return "<" + tagName + (attributes ? " " + attributes : "") + ">" + children + "</" + tagName + ">"
}

function buildSvgMarkup(node) {
  const tagName = node.tag || "svg"
  const attributes = buildSvgAttributes(node, true)

  if (typeof node.svgInnerMarkup === "string") {
    return "<" + tagName + (attributes ? " " + attributes : "") + ">" + node.svgInnerMarkup + "</" + tagName + ">"
  }

  return serializeSvgNode(node, true)
}

function applyPaddingToFrame(frame, styles) {
  const padding = parseBoxValues(styles || {}, "padding")
  frame.paddingTop = Math.max(0, padding.top)
  frame.paddingRight = Math.max(0, padding.right)
  frame.paddingBottom = Math.max(0, padding.bottom)
  frame.paddingLeft = Math.max(0, padding.left)
}

async function createSvgNode(node) {
  const svgMarkup = buildSvgMarkup(node)
  const imported = figma.createNodeFromSvg(svgMarkup)
  imported.name = node.label || "SVG"
  resizeNode(imported, node.metrics)

  if ("opacity" in imported) {
    const styles = node.styles || {}
    imported.opacity = clamp(Number(styles.opacity || 1), 0, 1)
  }

  return imported
}

async function applyVisualStyles(node, captureNode, options, explicitImageUrl) {
  const styles = captureNode.styles || {}
  const result = {
    appliedImageFill: false
  }

  resizeNode(node, captureNode.metrics)

  if ("opacity" in node) {
    node.opacity = clamp(Number(styles.opacity || 1), 0, 1)
  }

  if ("cornerRadius" in node) {
    node.cornerRadius = parseBorderRadius(styles["border-radius"])
  }

  if ("fills" in node) {
    const fills = []
    const backgroundFill = toSolidPaint(styles["background-color"])
    if (backgroundFill) {
      fills.push(backgroundFill)
    }

    const imageUrl = explicitImageUrl || extractFirstUrl(styles["background-image"])
    if (options.importImages && imageUrl) {
      const imagePaint = await createRemoteImagePaint(imageUrl)
      if (imagePaint) {
        fills.push(imagePaint)
        result.appliedImageFill = true
      }
    }

    node.fills = fills
  }

  if ("strokes" in node && "strokeWeight" in node) {
    const borderWidth = parsePx(styles["border-top-width"], 0)
    const borderStyle = String(styles["border-top-style"] || "none")
    const strokePaint = toSolidPaint(styles["border-top-color"])

    if (borderWidth > 0 && borderStyle !== "none" && strokePaint) {
      node.strokes = [strokePaint]
      node.strokeWeight = borderWidth
    } else {
      node.strokes = []
    }
  }

  if ("effects" in node) {
    const shadow = parseBoxShadow(styles["box-shadow"])
    node.effects = shadow ? [shadow] : []
  }

  if ("clipsContent" in node) {
    node.clipsContent = shouldClipContent(styles)
  }

  return result
}

function applyAutoLayout(frame, captureNode, options) {
  const styles = captureNode.styles || {}
  if (!canUseAutoLayout(captureNode, options)) {
    return false
  }

  frame.layoutMode = getLayoutDirection(captureNode)
  frame.primaryAxisSizingMode = "FIXED"
  frame.counterAxisSizingMode = "FIXED"
  frame.primaryAxisAlignItems = mapPrimaryAxisAlignment(styles["justify-content"])
  frame.counterAxisAlignItems = mapCounterAxisAlignment(styles["align-items"])

  const gap = frame.layoutMode === "VERTICAL"
    ? parsePx(styles.gap || styles["row-gap"], 8)
    : parsePx(styles.gap || styles["column-gap"], 8)
  frame.itemSpacing = Math.max(0, gap)

  applyPaddingToFrame(frame, styles)
  resizeNode(frame, captureNode.metrics)
  return true
}

function setAbsolutePlacement(sceneNode, childMetrics, parentMetrics) {
  if (!childMetrics) {
    return
  }

  const parentX = parentMetrics ? parentMetrics.x : 0
  const parentY = parentMetrics ? parentMetrics.y : 0
  sceneNode.x = Math.max(0, Math.round(childMetrics.x - parentX))
  sceneNode.y = Math.max(0, Math.round(childMetrics.y - parentY))
}

function setAutoLayoutChildSizing(childNode, child, parentNode, parentMetrics, layoutMode) {
  if (!childNode || !child || !child.metrics) {
    return
  }

  const parentStyles = parentNode.styles || {}
  const padding = parseBoxValues(parentStyles, "padding")
  const innerWidth = Math.max(1, (parentMetrics ? parentMetrics.width : child.metrics.width) - padding.left - padding.right)
  const innerHeight = Math.max(1, (parentMetrics ? parentMetrics.height : child.metrics.height) - padding.top - padding.bottom)

  if ("layoutSizingHorizontal" in childNode && "layoutSizingVertical" in childNode) {
    const textLikeNode = child.type === "text" || childNode.type === "TEXT"
    if (layoutMode === "VERTICAL") {
      childNode.layoutSizingHorizontal = child.metrics.width >= innerWidth - 4 ? "FILL" : "FIXED"
      childNode.layoutSizingVertical = textLikeNode ? "HUG" : "FIXED"
    } else {
      childNode.layoutSizingHorizontal = textLikeNode ? "HUG" : "FIXED"
      childNode.layoutSizingVertical = textLikeNode ? "HUG" : (child.metrics.height >= innerHeight - 4 ? "FILL" : "FIXED")
    }
  }

  if ("layoutAlign" in childNode) {
    childNode.layoutAlign = layoutMode === "VERTICAL" && child.metrics.width >= innerWidth - 4 ? "STRETCH" : "INHERIT"
  }
}

async function createTextNode(textNode, inheritedStyles, options) {
  const textValue = textNode && textNode.text ? textNode.text : ""
  const text = figma.createText()
  const styles = mergeStyles({}, inheritedStyles || {})
  const fontName = await resolveFontName(styles)
  const metrics = textNode && textNode.metrics ? textNode.metrics : null
  const whiteSpace = String(styles["white-space"] || "normal").trim()
  const fontSize = Math.max(1, parsePx(styles["font-size"], 14))
  const lineHeightValue = parsePx(styles["line-height"], fontSize * 1.2)
  const singleLineMetrics = !!(metrics && metrics.height > 0 && metrics.height <= lineHeightValue * 1.5)

  await figma.loadFontAsync(fontName)
  text.fontName = fontName
  text.characters = textValue
  text.fontSize = fontSize
  text.name = textValue.length > 48 ? textValue.slice(0, 45) + "..." : textValue
  text.textAlignHorizontal = mapTextAlign(styles["text-align"])
  text.textAlignVertical = "TOP"

  const lineHeight = parseLineHeight(styles["line-height"])
  if (lineHeight) {
    text.lineHeight = lineHeight
  }

  const letterSpacing = parseLetterSpacing(styles["letter-spacing"])
  if (letterSpacing) {
    text.letterSpacing = letterSpacing
  }

  const fill = toSolidPaint(styles.color || "#111827")
  if (fill) {
    text.fills = [fill]
  }

  if (metrics && metrics.width > 0) {
    text.resize(Math.max(1, Math.round(metrics.width)), Math.max(1, Math.round(metrics.height || 1)))
    text.textAutoResize = whiteSpace === "nowrap" || singleLineMetrics ? "WIDTH_AND_HEIGHT" : "HEIGHT"
  } else {
    text.textAutoResize = options.mode === "accurate" ? "HEIGHT" : "WIDTH_AND_HEIGHT"
  }

  return text
}

async function createImagePlaceholder(node, options) {
  const frame = figma.createFrame()
  frame.name = node.label || "Image"
  frame.layoutMode = "VERTICAL"
  frame.primaryAxisSizingMode = "FIXED"
  frame.counterAxisSizingMode = "FIXED"
  frame.primaryAxisAlignItems = "CENTER"
  frame.counterAxisAlignItems = "CENTER"
  frame.paddingTop = 12
  frame.paddingBottom = 12
  frame.paddingLeft = 12
  frame.paddingRight = 12
  frame.itemSpacing = 6
  frame.clipsContent = true
  resizeNode(frame, node.metrics)
  frame.fills = [{ type: "SOLID", color: { r: 0.93, g: 0.95, b: 0.98 } }]
  frame.strokes = [{ type: "SOLID", color: { r: 0.75, g: 0.8, b: 0.86 } }]
  frame.strokeWeight = 1
  frame.cornerRadius = parseBorderRadius(node.styles && node.styles["border-radius"]) || 10

  const label = await createTextNode({
    type: "text",
    text: (node.attributes && node.attributes.alt) || "Image placeholder",
    metrics: null
  }, {
    "font-family": "Inter",
    "font-size": "12px",
    "font-weight": "600",
    color: "#475569",
    "text-align": "center"
  }, options)
  frame.appendChild(label)

  const source = extractFirstUrl((node.attributes && node.attributes.src) || (node.attributes && node.attributes.srcset) || "")
  return frame
}

async function createImageNode(node, options) {
  const rect = figma.createRectangle()
  rect.name = node.label || "Image"
  const imageUrl = extractFirstUrl((node.attributes && node.attributes.src) || (node.attributes && node.attributes.srcset) || "")
  const styleResult = await applyVisualStyles(rect, node, options, imageUrl)

  if (!imageUrl || styleResult.appliedImageFill) {
    return rect
  }

  return createImagePlaceholder(node, options)
}

async function createInputControlNode(node, options) {
  const attributes = node.attributes || {}
  const inputType = String(attributes.type || "text").toLowerCase()
  if (inputType === "hidden") {
    return null
  }

  const frame = figma.createFrame()
  frame.name = node.label || "Input"
  await applyVisualStyles(frame, node, options, "")
  frame.layoutMode = "HORIZONTAL"
  frame.primaryAxisSizingMode = "FIXED"
  frame.counterAxisSizingMode = "FIXED"
  frame.counterAxisAlignItems = "CENTER"
  frame.primaryAxisAlignItems = ["submit", "button", "reset"].includes(inputType) ? "CENTER" : "MIN"
  frame.itemSpacing = 0
  applyPaddingToFrame(frame, node.styles || {})
  frame.clipsContent = true

  const textValue = ["submit", "button", "reset"].includes(inputType)
    ? String(attributes.value || attributes["aria-label"] || attributes.name || "Button")
    : String(attributes.value || attributes.placeholder || attributes["aria-label"] || attributes.name || "")

  if (textValue) {
    const label = await createTextNode({
      type: "text",
      text: textValue,
      metrics: null
    }, node.styles || {}, options)

    if (!attributes.value && attributes.placeholder && "opacity" in label) {
      label.opacity = 0.68
    }

    frame.appendChild(label)
  }

  return frame
}

async function buildNode(node, inheritedStyles, options, isRoot) {
  if (!node || shouldIgnoreNode(node, !!isRoot)) {
    return null
  }

  if (node.type === "text") {
    return createTextNode(node, inheritedStyles || {}, options)
  }

  const mergedStyles = mergeStyles(inheritedStyles, node.styles || {})

  if (node.tag === "svg") {
    return createSvgNode(node)
  }

  if (node.tag === "img") {
    return createImageNode(node, options)
  }

  if (node.tag === "input") {
    return createInputControlNode(node, options)
  }

  if (isPlainTextContainer(node)) {
    return createTextNode({
      type: "text",
      text: node.children[0].text,
      metrics: node.metrics || node.children[0].metrics || null
    }, mergedStyles, options)
  }

  const frame = figma.createFrame()
  frame.name = node.label || node.tag || "Layer"
  await applyVisualStyles(frame, node, options, "")

  const usesAutoLayout = applyAutoLayout(frame, node, options)
  const layoutMode = usesAutoLayout ? getLayoutDirection(node) : null
  const parentMetrics = node.metrics || { x: 0, y: 0 }
  const padding = parseBoxValues(node.styles || {}, "padding")
  let fallbackCursorY = padding.top

  for (const child of node.children || []) {
    const childNode = await buildNode(child, mergedStyles, options, false)
    if (!childNode) {
      continue
    }

    frame.appendChild(childNode)

    if (usesAutoLayout) {
      if (child.type === "element" && isAbsolutelyPositioned(child) && "layoutPositioning" in childNode) {
        childNode.layoutPositioning = "ABSOLUTE"
        setAbsolutePlacement(childNode, child.metrics, parentMetrics)
      } else {
        setAutoLayoutChildSizing(childNode, child, node, parentMetrics, layoutMode)
      }
      continue
    }

    if (child.metrics) {
      setAbsolutePlacement(childNode, child.metrics, parentMetrics)
      fallbackCursorY = Math.max(fallbackCursorY, childNode.y + ("height" in childNode ? childNode.height : 0) + 8)
      continue
    }

    childNode.x = padding.left
    childNode.y = fallbackCursorY
    fallbackCursorY += ("height" in childNode ? childNode.height : Math.max(16, parsePx(node.styles && node.styles["font-size"], 14))) + 6
  }

  return frame
}

async function createNotesFrame(lines, width) {
  if (!lines || !lines.length) {
    return null
  }

  const frame = figma.createFrame()
  frame.name = "Replicode import notes"
  frame.layoutMode = "VERTICAL"
  frame.primaryAxisSizingMode = "AUTO"
  frame.counterAxisSizingMode = "FIXED"
  frame.resize(Math.max(280, width), 1)
  frame.paddingTop = 12
  frame.paddingRight = 12
  frame.paddingBottom = 12
  frame.paddingLeft = 12
  frame.itemSpacing = 8
  frame.cornerRadius = 12
  frame.fills = [{ type: "SOLID", color: { r: 1, g: 0.98, b: 0.86 } }]
  frame.strokes = [{ type: "SOLID", color: { r: 0.95, g: 0.79, b: 0.42 } }]

  for (const line of lines) {
    const text = await createTextNode({
      type: "text",
      text: line,
      metrics: null
    }, {
      "font-family": "Inter",
      "font-size": "12px",
      color: "#7c2d12"
    }, {
      mode: "editable"
    })
    frame.appendChild(text)
  }

  return frame
}

async function importCapturePayload(rawPayload, importOptions) {
  const options = normalizeImportOptions(importOptions)
  let payload = rawPayload

  if (typeof payload === "string") {
    const trimmedPayload = payload.trim()

    if (!trimmedPayload) {
      throw new Error("Paste a Replicode Figma payload first.")
    }

    if (trimmedPayload.startsWith("<!-- component.html -->") || trimmedPayload.includes("/* styles.css */")) {
      throw new Error('You pasted the HTML/CSS export. In the Chrome extension use "Copy for Figma" or switch the output to "Figma Import JSON".')
    }

    try {
      payload = JSON.parse(trimmedPayload)
    } catch (error) {
      throw new Error('The pasted content is not valid JSON. Use "Copy for Figma" or the "Figma Import JSON" output from the Chrome extension.')
    }
  }

  if (payload && !payload.schema && payload.tree) {
    const metadata = payload.metadata || {}
    const rootRect = metadata.rootRect || payload.tree.metrics || {}
    const rootLabel = metadata.rootLabel || metadata.rootTag || payload.tree.label || "Captured UI"

    payload = {
      schema: "replicode-figma-import",
      version: 1,
      generatedAt: new Date().toISOString(),
      source: {
        name: "Replicode Chrome extension",
        format: "json-capture"
      },
      component: {
        name: rootLabel,
        label: rootLabel,
        rootTag: metadata.rootTag || payload.tree.tag || null,
        pageTitle: metadata.pageTitle || null,
        pageUrl: metadata.url || null
      },
      figma: {
        suggestedFrameName: rootLabel,
        width: Math.max(1, Math.round(rootRect.width || 320)),
        height: Math.max(1, Math.round(rootRect.height || 200))
      },
      capture: payload,
      stats: {
        capturedNodes: metadata.nodeCount || 0
      },
      notes: ["Imported from raw Replicode JSON capture."]
    }
  }

  if (!payload || payload.schema !== "replicode-figma-import" || !payload.capture || !payload.capture.tree) {
    throw new Error("The pasted content is not a valid Replicode Figma payload.")
  }

  const root = await buildNode(payload.capture.tree, payload.capture.tree.styles || {}, options, true)
  if (!root) {
    throw new Error("The payload did not contain an importable tree.")
  }

  root.name = (payload.figma && payload.figma.suggestedFrameName) || (payload.component && payload.component.label) || root.name
  if ("fills" in root && Array.isArray(root.fills) && root.fills.length === 0) {
    const pageBackground = toSolidPaint(payload.capture && payload.capture.metadata && payload.capture.metadata.pageBackground)
    root.fills = [pageBackground || { type: "SOLID", color: { r: 1, g: 1, b: 1 } }]
  }
  figma.currentPage.appendChild(root)

  const center = figma.viewport.center
  root.x = Math.round(center.x - root.width / 2)
  root.y = Math.round(center.y - root.height / 2)

  const noteLines = Array.isArray(payload.notes) ? payload.notes.slice() : []
  if (noteLines.length) {
    const notesFrame = await createNotesFrame(noteLines.slice(0, 8), root.width)
    if (notesFrame) {
      figma.currentPage.appendChild(notesFrame)
      notesFrame.x = root.x
      notesFrame.y = root.y + root.height + 24
    }
  }

  figma.currentPage.selection = [root]
  figma.viewport.scrollAndZoomIntoView([root])

  return {
    rootName: root.name,
    width: Math.round(root.width),
    height: Math.round(root.height),
    mode: options.mode
  }
}

figma.ui.onmessage = async function(message) {
  if (!message || message.type !== "IMPORT_CAPTURE") {
    return
  }

  try {
    const result = await importCapturePayload(message.payload, message.options || {})
    figma.notify("Imported " + result.rootName + " using " + result.mode + " mode.")
    figma.ui.postMessage({
      type: "IMPORT_RESULT",
      ok: true,
      detail: result.rootName + " (" + result.width + " x " + result.height + ", " + result.mode + ")"
    })
  } catch (error) {
    const detail = (error && error.message) || String(error)
    figma.notify(detail, { error: true })
    figma.ui.postMessage({
      type: "IMPORT_RESULT",
      ok: false,
      detail: detail
    })
  }
}

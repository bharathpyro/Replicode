figma.showUI(__html__, {
  width: 420,
  height: 480,
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

// Split CSS function args at commas while respecting nested parens like
// rgba() or color() inside a gradient stop list.
function splitTopLevelCommas(value) {
  const parts = []
  let depth = 0
  let current = ""
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]
    if (ch === "(") depth += 1
    else if (ch === ")") depth -= 1
    if (ch === "," && depth === 0) {
      parts.push(current.trim())
      current = ""
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

function parseAngleToCssDeg(token) {
  const match = String(token || "").trim().match(/^(-?\d*\.?\d+)(deg|grad|rad|turn)?$/i)
  if (!match) return null
  const num = parseFloat(match[1])
  const unit = (match[2] || "deg").toLowerCase()
  if (unit === "rad") return (num * 180) / Math.PI
  if (unit === "grad") return num * 0.9
  if (unit === "turn") return num * 360
  return num
}

function directionKeywordToCssDeg(token) {
  const lower = String(token || "").trim().toLowerCase()
  if (!lower.startsWith("to ")) return null
  const dir = lower.slice(3).trim()
  switch (dir) {
    case "top": return 0
    case "right": return 90
    case "bottom": return 180
    case "left": return 270
    case "top right":
    case "right top": return 45
    case "bottom right":
    case "right bottom": return 135
    case "bottom left":
    case "left bottom": return 225
    case "top left":
    case "left top": return 315
    default: return null
  }
}

// Map a CSS gradient angle (0=up, 90=right, 180=down, 270=left) onto
// Figma's gradientTransform. Figma's default linear gradient runs from
// (0,0) to (1,0) in node-local UV space, scaled by the node's bounding
// box. We rotate that around (0.5, 0.5) by (angle - 90°) so 180deg in
// CSS yields a top-to-bottom gradient in Figma.
function gradientTransformFromCssAngle(cssDeg) {
  const angle = ((cssDeg - 90) * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  // Affine [[a, b, e], [c, d, f]] applied to (x, y) gives a*x+b*y+e,
  // c*x+d*y+f. We want the unit X axis to map to the gradient
  // direction, centered at (0.5, 0.5).
  const a = cos
  const b = -sin
  const c = sin
  const d = cos
  const e = 0.5 - 0.5 * a - 0.5 * b
  const f = 0.5 - 0.5 * c - 0.5 * d
  return [[a, b, e], [c, d, f]]
}

function buildGradientStops(stopTokens) {
  const colors = []
  for (const token of stopTokens) {
    const trimmed = String(token || "").trim()
    if (!trimmed) continue
    const parenEnd = trimmed.lastIndexOf(")")
    let colorPart = trimmed
    let positionPart = ""
    if (parenEnd >= 0 && parenEnd < trimmed.length - 1) {
      colorPart = trimmed.slice(0, parenEnd + 1)
      positionPart = trimmed.slice(parenEnd + 1).trim()
    } else {
      const lastSpace = trimmed.lastIndexOf(" ")
      if (lastSpace > 0 && /^-?\d/.test(trimmed.slice(lastSpace + 1))) {
        colorPart = trimmed.slice(0, lastSpace)
        positionPart = trimmed.slice(lastSpace + 1).trim()
      }
    }
    const parsed = parseColor(colorPart)
    if (!parsed) continue
    let position = null
    if (positionPart) {
      const m = positionPart.match(/^(-?\d*\.?\d+)(%|px)?$/)
      if (m) {
        const num = parseFloat(m[1])
        position = m[2] === "px" ? clamp(num / 1000, 0, 1) : clamp(num / 100, 0, 1)
      }
    }
    colors.push({ color: parsed, position })
  }

  if (colors.length < 2) return null

  // Distribute positions evenly when missing.
  for (let i = 0; i < colors.length; i += 1) {
    if (colors[i].position == null) {
      if (i === 0) colors[i].position = 0
      else if (i === colors.length - 1) colors[i].position = 1
      else colors[i].position = i / (colors.length - 1)
    }
  }

  return colors.map(({ color, position }) => ({
    color: { r: color.r / 255, g: color.g / 255, b: color.b / 255, a: color.a },
    position
  }))
}

function parseLinearGradientPaint(value) {
  const inner = String(value || "").trim()
  const match = inner.match(/^linear-gradient\((.*)\)\s*$/i)
  if (!match) return null
  const args = splitTopLevelCommas(match[1])
  if (!args.length) return null

  let cssDeg = 180 // CSS default: top → bottom
  let stopStart = 0
  const angle = parseAngleToCssDeg(args[0])
  const direction = directionKeywordToCssDeg(args[0])
  if (angle != null) {
    cssDeg = angle
    stopStart = 1
  } else if (direction != null) {
    cssDeg = direction
    stopStart = 1
  }

  const stops = buildGradientStops(args.slice(stopStart))
  if (!stops) return null

  return {
    type: "GRADIENT_LINEAR",
    gradientStops: stops,
    gradientTransform: gradientTransformFromCssAngle(cssDeg)
  }
}

function parseRadialGradientPaint(value) {
  const inner = String(value || "").trim()
  const match = inner.match(/^radial-gradient\((.*)\)\s*$/i)
  if (!match) return null
  const args = splitTopLevelCommas(match[1])
  if (!args.length) return null

  // Skip the optional shape/size/position descriptor (anything that
  // doesn't parse as a color). We don't reproduce shape exactly — we
  // just emit a centered radial gradient.
  let stopStart = 0
  if (args.length > 0 && !parseColor(args[0])) {
    stopStart = 1
  }

  const stops = buildGradientStops(args.slice(stopStart))
  if (!stops) return null

  return {
    type: "GRADIENT_RADIAL",
    gradientStops: stops,
    gradientTransform: [[1, 0, 0], [0, 1, 0]]
  }
}

// CSS: conic-gradient([from <angle>] [at <position>], <stops>)
// Figma: GRADIENT_ANGULAR sweeps colors around a center point; the
// transform's translation is the center, and rotation sets the start
// angle. We map "from <a>deg at <x>% <y>%" to a sensible approximation
// — full angular sweep, centered at the captured position, rotated to
// match the CSS start angle.
function parseConicGradientPaint(value) {
  const inner = String(value || "").trim()
  const match = inner.match(/^conic-gradient\((.*)\)\s*$/i)
  if (!match) return null
  const args = splitTopLevelCommas(match[1])
  if (!args.length) return null

  let stopStart = 0
  let startDeg = 0 // CSS conic default: 0 = up
  let centerX = 0.5
  let centerY = 0.5

  // Match optional "from <angle>" and/or "at <position>" prefix. CSS
  // grammar allows them in either order on the first arg.
  const head = args[0].trim().toLowerCase()
  if (/^(from\s|at\s)/.test(head)) {
    stopStart = 1
    const fromMatch = head.match(/from\s+([\-\d.]+)(deg|grad|rad|turn)?/)
    if (fromMatch) {
      const angle = parseAngleToCssDeg(fromMatch[1] + (fromMatch[2] || "deg"))
      if (angle != null) startDeg = angle
    }
    const atMatch = head.match(/at\s+([\-\d.]+%?)\s+([\-\d.]+%?)/)
    if (atMatch) {
      const cx = parseFloat(atMatch[1])
      const cy = parseFloat(atMatch[2])
      if (!Number.isNaN(cx)) centerX = clamp(atMatch[1].includes("%") ? cx / 100 : cx, 0, 1)
      if (!Number.isNaN(cy)) centerY = clamp(atMatch[2].includes("%") ? cy / 100 : cy, 0, 1)
    }
  }

  const stops = buildGradientStops(args.slice(stopStart))
  if (!stops) return null

  // Rotate the standard angular axis by startDeg around the center.
  const rad = (startDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const a = cos
  const b = -sin
  const c = sin
  const d = cos
  const e = centerX - centerX * a - centerY * b
  const f = centerY - centerX * c - centerY * d

  return {
    type: "GRADIENT_ANGULAR",
    gradientStops: stops,
    gradientTransform: [[a, b, e], [c, d, f]]
  }
}

// Convert a CSS background-image value into a Figma gradient paint when
// possible. Returns null for url() values or unsupported gradient types.
function parseGradientPaint(value) {
  const text = String(value || "").trim()
  if (!text) return null
  if (text.startsWith("linear-gradient(")) return parseLinearGradientPaint(text)
  if (text.startsWith("radial-gradient(")) return parseRadialGradientPaint(text)
  if (text.startsWith("conic-gradient(")) return parseConicGradientPaint(text)
  return null
}

// CSS pattern: gradient-styled text via background-clip: text +
// transparent text color (commonly with -webkit-text-fill-color:
// transparent). The visible text color IS the gradient. Detect this
// and return the gradient paint to use as the TEXT fill.
function resolveTextFillPaint(rangeStyles) {
  const styles = rangeStyles || {}
  const clip = String(styles["background-clip"] || styles["-webkit-background-clip"] || "").toLowerCase()
  const colorValue = String(styles.color || "").toLowerCase().trim()
  const webkitFillValue = String(styles["-webkit-text-fill-color"] || "").toLowerCase().trim()
  const isClipText = clip === "text"
  const transparentColor =
    colorValue === "transparent" ||
    colorValue === "rgba(0, 0, 0, 0)" ||
    colorValue.startsWith("rgba(0,0,0,0)")
  const transparentWebkitFill =
    webkitFillValue === "transparent" ||
    webkitFillValue === "rgba(0, 0, 0, 0)" ||
    webkitFillValue.startsWith("rgba(0,0,0,0)")

  // Either the explicit -webkit-text-fill-color is transparent, or the
  // standard color is transparent and there's a clip:text + gradient bg.
  if ((isClipText && (transparentColor || transparentWebkitFill)) || transparentWebkitFill) {
    const gradient = parseGradientPaint(styles["background-image"] || "")
    if (gradient) return gradient
  }

  return toSolidPaint(styles.color || "")
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

  // display: contents has no box of its own; if its children are also
  // empty decorative elements (e.g. Vercel's grid-guide divs that draw
  // background grid lines via absolute-position borders), skip them so
  // they don't add hundreds of empty frames to the import.
  if (!isRoot && display === "contents") {
    const kids = node.children || []
    if (!kids.length) return true
  }

  // aria-hidden, no children, zero size, no visible decoration. These
  // are pure decorative scaffolding (overlays, grid guides, separators
  // drawn with borders only that we already captured on the parent).
  if (!isRoot && node.type === "element") {
    const ariaHidden = node.attributes && (node.attributes["aria-hidden"] === "true" || node.attributes["aria-hidden"] === true)
    const kids = node.children || []
    const m = node.metrics || {}
    const hasZeroSize = !m.width && !m.height
    if (ariaHidden && !kids.length && hasZeroSize) {
      return true
    }
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

// Inspect children's geometry to guess whether they form a clean vertical or
// horizontal stack. Used when the container isn't display:flex but its
// children are visually stacked (e.g. block-level <h1>+<p>+<button>).
function inferLayoutDirection(node) {
  const children = getRenderableChildren(node)
  if (children.length < 2) {
    return null
  }

  const parentMetrics = getNodeMetrics(node)
  const verticalLinear = childrenAreLinear(children, "VERTICAL", parentMetrics)
  const horizontalLinear = childrenAreLinear(children, "HORIZONTAL", parentMetrics)

  if (verticalLinear && !horizontalLinear) return "VERTICAL"
  if (horizontalLinear && !verticalLinear) return "HORIZONTAL"
  if (verticalLinear && horizontalLinear) {
    // Both pass — pick the axis with greater child spread.
    const spans = children.map(getNodeMetrics).filter(Boolean)
    if (!spans.length) return null
    const ySpread = Math.max.apply(null, spans.map((m) => m.y + m.height)) - Math.min.apply(null, spans.map((m) => m.y))
    const xSpread = Math.max.apply(null, spans.map((m) => m.x + m.width)) - Math.min.apply(null, spans.map((m) => m.x))
    return ySpread > xSpread ? "VERTICAL" : "HORIZONTAL"
  }
  return null
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
  const children = getRenderableChildren(node)
  if (children.length < 1) {
    return false
  }

  // Skip if any child is absolutely positioned — those need to escape layout.
  for (const child of children) {
    if (child.type === "element" && isAbsolutelyPositioned(child)) {
      return false
    }
  }

  const display = String(styles.display || "")
  const isFlex = display.includes("flex")
  const wrap = String(styles["flex-wrap"] || "nowrap").trim()

  if (isFlex && wrap === "nowrap") {
    return childrenAreLinear(children, getLayoutDirection(node), getNodeMetrics(node))
  }

  // For non-flex containers (block divs, paragraphs with inline runs, etc.),
  // accept auto-layout when children visibly form a linear stack — this is
  // what the original layout engine produced anyway, just expressed via
  // block/inline flow rather than flex.
  return inferLayoutDirection(node) !== null
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

// Resolve "currentColor" inside an SVG markup string to an actual color
// value. figma.createNodeFromSvg doesn't run the CSS cascade, so the
// inherited <color> never resolves and stroked icons render invisibly.
function resolveCurrentColorInSvg(markup, fallbackColor) {
  if (!markup) return markup
  const cssVarFallback = String(fallbackColor || "").trim() || "#ffffff"
  // Replace currentColor (case-insensitive) and any unresolved
  // var(--name) references with the supplied fallback. Most page-level
  // CSS variables won't be available inside the plugin sandbox.
  let result = markup.replace(/currentColor/gi, cssVarFallback)
  result = result.replace(/var\(\s*--[^,)]+(?:,\s*([^)]+))?\)/g, function(_, fb) {
    return (fb || cssVarFallback).trim()
  })
  return result
}

function buildSvgMarkup(node) {
  const tagName = node.tag || "svg"
  const attributes = buildSvgAttributes(node, true)
  const inheritedColor = (node.styles && node.styles.color) || ""

  if (typeof node.svgInnerMarkup === "string") {
    const resolvedInner = resolveCurrentColorInSvg(node.svgInnerMarkup, inheritedColor)
    return "<" + tagName + (attributes ? " " + attributes : "") + ">" + resolvedInner + "</" + tagName + ">"
  }

  return resolveCurrentColorInSvg(serializeSvgNode(node, true), inheritedColor)
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

    const backgroundImage = styles["background-image"] || ""
    const imageUrl = explicitImageUrl || extractFirstUrl(backgroundImage)
    if (options.importImages && imageUrl) {
      const imagePaint = await createRemoteImagePaint(imageUrl)
      if (imagePaint) {
        fills.push(imagePaint)
        result.appliedImageFill = true
      }
    } else {
      // Try CSS gradient (linear-gradient / radial-gradient). Figma
      // renders these as native gradient paints on top of the solid bg.
      const gradientPaint = parseGradientPaint(backgroundImage)
      if (gradientPaint) {
        fills.push(gradientPaint)
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

// Look at where children sit in the parent's bounding box on the cross
// axis and infer Figma's counterAxisAlignItems. Used when the source
// isn't display:flex (where align-items would tell us directly).
function inferCounterAlignment(captureNode, direction) {
  const parentMetrics = getNodeMetrics(captureNode)
  if (!parentMetrics) return "MIN"
  const children = getRenderableChildren(captureNode)
  if (!children.length) return "MIN"

  let centered = 0
  let leading = 0
  let trailing = 0

  for (const child of children) {
    const m = getNodeMetrics(child)
    if (!m) continue
    if (direction === "VERTICAL") {
      const left = m.x - parentMetrics.x
      const right = parentMetrics.x + parentMetrics.width - (m.x + m.width)
      const slack = parentMetrics.width - m.width
      if (slack <= 4) continue
      if (Math.abs(left - right) <= Math.max(4, slack * 0.1)) centered += 1
      else if (left < right) leading += 1
      else trailing += 1
    } else {
      const top = m.y - parentMetrics.y
      const bottom = parentMetrics.y + parentMetrics.height - (m.y + m.height)
      const slack = parentMetrics.height - m.height
      if (slack <= 4) continue
      if (Math.abs(top - bottom) <= Math.max(4, slack * 0.1)) centered += 1
      else if (top < bottom) leading += 1
      else trailing += 1
    }
  }

  if (centered >= leading && centered >= trailing && centered > 0) return "CENTER"
  if (trailing > leading) return "MAX"
  return "MIN"
}

function applyAutoLayout(frame, captureNode, options) {
  const styles = captureNode.styles || {}
  if (!canUseAutoLayout(captureNode, options)) {
    return false
  }

  const display = String(styles.display || "")
  const isFlex = display.includes("flex")
  // When the source isn't flex, geometry is the only signal we have for
  // direction — fall back to the inferred axis.
  const direction = isFlex ? getLayoutDirection(captureNode) : (inferLayoutDirection(captureNode) || "VERTICAL")

  frame.layoutMode = direction
  frame.primaryAxisSizingMode = "FIXED"
  frame.counterAxisSizingMode = "FIXED"
  frame.primaryAxisAlignItems = mapPrimaryAxisAlignment(styles["justify-content"])

  if (isFlex && styles["align-items"]) {
    frame.counterAxisAlignItems = mapCounterAxisAlignment(styles["align-items"])
  } else {
    // For non-flex containers (or flex containers without align-items),
    // infer from child geometry. This catches block-level content that's
    // centered via `text-align: center` or `margin: auto`.
    const inferred = inferCounterAlignment(captureNode, direction)
    // Also check text-align: center as an explicit signal for centering.
    const textAlign = String(styles["text-align"] || "").trim()
    if (!isFlex && (textAlign === "center" || textAlign === "-webkit-center")) {
      frame.counterAxisAlignItems = "CENTER"
    } else {
      frame.counterAxisAlignItems = inferred
    }
  }

  const gap = direction === "VERTICAL"
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

  // Use parent metrics as the origin; allow negative offsets — clamping to 0
  // collapses every offset child onto the same point and hides the real bug.
  const parentX = parentMetrics ? parentMetrics.x : 0
  const parentY = parentMetrics ? parentMetrics.y : 0
  sceneNode.x = Math.round(childMetrics.x - parentX)
  sceneNode.y = Math.round(childMetrics.y - parentY)
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
  const ranges = Array.isArray(textNode && textNode.ranges) ? textNode.ranges : null
  const text = figma.createText()
  const styles = mergeStyles({}, inheritedStyles || {})
  const metrics = textNode && textNode.metrics ? textNode.metrics : null
  const whiteSpace = String(styles["white-space"] || "normal").trim()
  const fontSize = Math.max(1, parsePx(styles["font-size"], 14))
  const lineHeightValue = parsePx(styles["line-height"], fontSize * 1.2)
  const singleLineMetrics = !!(metrics && metrics.height > 0 && metrics.height <= lineHeightValue * 1.5)

  // Resolve the container font first so an empty / missing range still renders.
  const fallbackFontName = await resolveFontName(styles)
  await figma.loadFontAsync(fallbackFontName)
  text.fontName = fallbackFontName
  text.fontSize = fontSize
  text.characters = textValue
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

  const fill = resolveTextFillPaint(styles) || toSolidPaint("#111827")
  if (fill) {
    text.fills = [fill]
  }

  if (ranges && ranges.length) {
    await applyTextRanges(text, ranges, styles)
  }

  if (metrics && metrics.width > 0) {
    text.resize(Math.max(1, Math.round(metrics.width)), Math.max(1, Math.round(metrics.height || 1)))
    text.textAutoResize = whiteSpace === "nowrap" || singleLineMetrics ? "WIDTH_AND_HEIGHT" : "HEIGHT"
  } else {
    text.textAutoResize = options.mode === "accurate" ? "HEIGHT" : "WIDTH_AND_HEIGHT"
  }

  return text
}

// Apply per-character-range styles on a TEXT node. Each range carries its
// own merged styles snapshot from the source <span>/<a>/<strong>/etc.
async function applyTextRanges(text, ranges, fallbackStyles) {
  const characterCount = text.characters.length
  if (!characterCount) return

  // Pre-load every distinct font we'll need so setRangeFontName never fails.
  const seenFonts = new Map()
  const resolvedRanges = []

  for (const range of ranges) {
    if (!range || range.start == null || range.end == null) continue
    const start = Math.max(0, Math.min(characterCount, range.start))
    const end = Math.max(start, Math.min(characterCount, range.end))
    if (end <= start) continue
    const merged = mergeStyles(fallbackStyles || {}, range.styles || {})
    const fontName = await resolveFontName(merged)
    seenFonts.set(fontName.family + "|" + fontName.style, fontName)
    resolvedRanges.push({ start, end, styles: merged, fontName })
  }

  await Promise.all(Array.from(seenFonts.values()).map((fn) => figma.loadFontAsync(fn)))

  for (const range of resolvedRanges) {
    try {
      text.setRangeFontName(range.start, range.end, range.fontName)
      const rangeFontSize = Math.max(1, parsePx(range.styles["font-size"], text.fontSize))
      text.setRangeFontSize(range.start, range.end, rangeFontSize)
      const rangeFill = resolveTextFillPaint(range.styles)
      if (rangeFill) {
        text.setRangeFills(range.start, range.end, [rangeFill])
      }
      const rangeLineHeight = parseLineHeight(range.styles["line-height"])
      if (rangeLineHeight) {
        text.setRangeLineHeight(range.start, range.end, rangeLineHeight)
      }
      const rangeLetterSpacing = parseLetterSpacing(range.styles["letter-spacing"])
      if (rangeLetterSpacing) {
        text.setRangeLetterSpacing(range.start, range.end, rangeLetterSpacing)
      }
      const decoration = String(range.styles["text-decoration"] || range.styles["text-decoration-line"] || "").toLowerCase()
      if (decoration.includes("underline")) {
        text.setRangeTextDecoration(range.start, range.end, "UNDERLINE")
      } else if (decoration.includes("line-through")) {
        text.setRangeTextDecoration(range.start, range.end, "STRIKETHROUGH")
      }
      const transform = String(range.styles["text-transform"] || "").toLowerCase()
      if (transform === "uppercase" || transform === "lowercase" || transform === "capitalize") {
        text.setRangeTextCase(range.start, range.end, transform === "uppercase" ? "UPPER" : transform === "lowercase" ? "LOWER" : "TITLE")
      }
    } catch (error) {
      // A single broken range shouldn't kill the whole text node.
    }
  }
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
      ranges: node.children[0].ranges,
      metrics: node.metrics || node.children[0].metrics || null
    }, mergedStyles, options)
  }

  const frame = figma.createFrame()
  frame.name = node.label || node.tag || "Layer"
  await applyVisualStyles(frame, node, options, "")

  const usesAutoLayout = applyAutoLayout(frame, node, options)
  // Use whatever layoutMode was actually applied (frame.layoutMode reflects
  // the inferred direction when the source isn't display:flex).
  const layoutMode = usesAutoLayout ? frame.layoutMode : null
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

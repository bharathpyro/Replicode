;(() => {
  function normalizeTokenList(value) {
    const tokens = String(value || "")
      .replace(/[#.]/g, " ")
      .match(/[a-zA-Z0-9]+/g)

    return tokens?.length ? tokens : []
  }

  function toCamelCase(value) {
    const tokens = normalizeTokenList(value)
    if (!tokens.length) {
      return "capturedComponent"
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

  function clone(value) {
    return JSON.parse(JSON.stringify(value))
  }

  function countCapturedNodes(node) {
    if (!node) {
      return 0
    }

    if (node.type === "text") {
      return 1
    }

    return 1 + (node.children || []).reduce((count, child) => count + countCapturedNodes(child), 0)
  }

  function buildNotes(capture) {
    const notes = []
    const metadata = capture?.metadata || {}
    const recordedStates = capture?.interactions?.recordedStates?.length || 0

    if (metadata.rootLabel) {
      notes.push(`Captured root: ${metadata.rootLabel}`)
    }

    if (metadata.url) {
      notes.push(`Source page: ${metadata.url}`)
    }

    if (recordedStates) {
      notes.push(`Recorded interaction states: ${recordedStates}`)
    }

    if (capture?.warnings?.length) {
      notes.push(...capture.warnings)
    }

    if (!notes.length) {
      notes.push("Imported from Replicode capture payload.")
    }

    return notes
  }

  function buildPayload(capture) {
    if (!capture?.tree) {
      return null
    }

    const metadata = capture.metadata || {}
    const rootRect = metadata.rootRect || capture.tree.metrics || {}
    const rootLabel = metadata.rootLabel || metadata.rootTag || capture.tree.label || "Captured UI"

    return {
      schema: "replicode-figma-import",
      version: 1,
      generatedAt: new Date().toISOString(),
      source: {
        name: "Replicode Chrome extension",
        format: "figma-import-json"
      },
      component: {
        name: toPascalCase(rootLabel),
        label: rootLabel,
        rootTag: metadata.rootTag || capture.tree.tag || null,
        pageTitle: metadata.pageTitle || null,
        pageUrl: metadata.url || null
      },
      figma: {
        suggestedFrameName: rootLabel,
        width: Math.max(1, Math.round(rootRect.width || 320)),
        height: Math.max(1, Math.round(rootRect.height || 200))
      },
      capture: clone({
        metadata,
        tree: capture.tree,
        assets: capture.assets || {},
        animations: capture.animations || {},
        interactions: capture.interactions || {},
        warnings: capture.warnings || []
      }),
      stats: {
        capturedNodes: metadata.nodeCount || countCapturedNodes(capture.tree)
      },
      notes: buildNotes(capture)
    }
  }

  function generateImportJson(capture) {
    const payload = buildPayload(capture)
    return payload ? JSON.stringify(payload, null, 2) : ""
  }

  // ───────────────────────────────────────────────────────────────────
  // Paste-ready SVG generator
  //
  // Walks the captured tree and emits a self-contained SVG document
  // that Figma converts to native editable layers when pasted (Frame +
  // Rectangle + Text + Vector layers — no plugin install required).
  // ───────────────────────────────────────────────────────────────────

  function escapeXml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
  }

  function parsePxNumber(value, fallback) {
    if (value == null) return fallback
    const match = String(value).trim().match(/(-?\d+(?:\.\d+)?)/)
    if (!match) return fallback
    const parsed = Number(match[1])
    return Number.isFinite(parsed) ? parsed : fallback
  }

  function parseSidedBox(styles, prefix) {
    const top = parsePxNumber(styles[prefix + "-top"], 0)
    const right = parsePxNumber(styles[prefix + "-right"], top)
    const bottom = parsePxNumber(styles[prefix + "-bottom"], top)
    const left = parsePxNumber(styles[prefix + "-left"], right)
    return { top, right, bottom, left }
  }

  function isTransparent(color) {
    if (!color) return true
    const text = String(color).trim().toLowerCase()
    if (!text || text === "transparent" || text === "none") return true
    if (text === "rgba(0, 0, 0, 0)" || text === "rgba(0,0,0,0)") return true
    return false
  }

  // Track <defs> entries (gradient stops, filters) generated while
  // walking the tree so we can emit them once at the top of the SVG.
  function makeDefRegistry() {
    const entries = []
    let counter = 0
    return {
      add(markup) {
        counter += 1
        const id = "rc-def-" + counter
        entries.push({ id, markup })
        return id
      },
      register(id, markup) {
        entries.push({ id, markup })
      },
      render() {
        return entries.map((e) => e.markup).join("")
      }
    }
  }

  // Parse splitTopLevelCommas in "linear-gradient(135deg, #abc, #def)".
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

  // CSS gradient angle (0=up, 90=right, 180=down, 270=left). SVG
  // linearGradient uses x1/y1/x2/y2 across the bbox; convert.
  function angleToLinearVector(cssDeg) {
    const angle = ((cssDeg - 90) * Math.PI) / 180
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const halfMagnitude = Math.max(Math.abs(cos), Math.abs(sin)) * 0.5 || 0.5
    const x = cos / halfMagnitude * 0.5
    const y = sin / halfMagnitude * 0.5
    return {
      x1: 0.5 - x * 0.5,
      y1: 0.5 - y * 0.5,
      x2: 0.5 + x * 0.5,
      y2: 0.5 + y * 0.5
    }
  }

  function parseCssAngle(token) {
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
      case "top right": case "right top": return 45
      case "bottom right": case "right bottom": return 135
      case "bottom left": case "left bottom": return 225
      case "top left": case "left top": return 315
      default: return null
    }
  }

  function buildGradientStopMarkup(stopTokens) {
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
      let position = null
      if (positionPart) {
        const m = positionPart.match(/^(-?\d*\.?\d+)(%|px)?$/)
        if (m) {
          const num = parseFloat(m[1])
          position = m[2] === "px" ? Math.max(0, Math.min(1, num / 1000)) : Math.max(0, Math.min(1, num / 100))
        }
      }
      colors.push({ color: colorPart, position })
    }
    if (colors.length < 2) return null
    for (let i = 0; i < colors.length; i += 1) {
      if (colors[i].position == null) {
        if (i === 0) colors[i].position = 0
        else if (i === colors.length - 1) colors[i].position = 1
        else colors[i].position = i / (colors.length - 1)
      }
    }
    return colors
      .map((c) => `<stop offset="${(c.position * 100).toFixed(2)}%" stop-color="${escapeXml(c.color)}"/>`)
      .join("")
  }

  function gradientPaintForBackground(value, defs) {
    const text = String(value || "").trim()
    if (!text || text === "none") return null

    if (text.startsWith("linear-gradient(")) {
      const inner = text.match(/^linear-gradient\((.*)\)\s*$/i)
      if (!inner) return null
      const args = splitTopLevelCommas(inner[1])
      if (!args.length) return null
      let cssDeg = 180
      let stopStart = 0
      const angle = parseCssAngle(args[0])
      const direction = directionKeywordToCssDeg(args[0])
      if (angle != null) { cssDeg = angle; stopStart = 1 }
      else if (direction != null) { cssDeg = direction; stopStart = 1 }
      const stops = buildGradientStopMarkup(args.slice(stopStart))
      if (!stops) return null
      const v = angleToLinearVector(cssDeg)
      const id = defs.add(
        `<linearGradient id="__id__" x1="${v.x1}" y1="${v.y1}" x2="${v.x2}" y2="${v.y2}">${stops}</linearGradient>`
      )
      // Patch the placeholder id we just used.
      const last = defs.entries ? null : null
      // Rewrite the last def's markup to use the real id.
      defs._patchLastId(id)
      return `url(#${id})`
    }

    if (text.startsWith("radial-gradient(")) {
      const inner = text.match(/^radial-gradient\((.*)\)\s*$/i)
      if (!inner) return null
      const args = splitTopLevelCommas(inner[1])
      if (!args.length) return null
      let stopStart = 0
      // Skip optional shape/size/position descriptor.
      const looksLikeColor = /(rgb|rgba|hsl|hsla|oklab|oklch|#)/i.test(args[0])
      if (!looksLikeColor) stopStart = 1
      const stops = buildGradientStopMarkup(args.slice(stopStart))
      if (!stops) return null
      const id = defs.add(
        `<radialGradient id="__id__" cx="0.5" cy="0.5" r="0.5">${stops}</radialGradient>`
      )
      defs._patchLastId(id)
      return `url(#${id})`
    }

    // conic-gradient is not natively expressible in plain SVG; skip
    // (the page screenshot still wins for those decorative cases).
    return null
  }

  // Convert a hex / rgb / hsl color string to RGB triplet plus alpha.
  // Used for stroke + fill on shapes.
  function passThroughColor(value) {
    if (!value) return null
    const text = String(value).trim()
    if (!text || text === "transparent") return null
    return text
  }

  // ── Tree walk ──

  function indent(depth) {
    return "  ".repeat(Math.max(0, depth))
  }

  function buildBackgroundFill(node, defs) {
    const styles = node.styles || {}
    const bgImage = styles["background-image"] || styles["background"] || ""
    if (bgImage && bgImage !== "none") {
      const gradientFill = gradientPaintForBackground(bgImage, defs)
      if (gradientFill) return gradientFill
    }
    const bgColor = passThroughColor(styles["background-color"])
    return bgColor || null
  }

  function buildShadowFilter(node, defs) {
    const shadows = String((node.styles || {})["box-shadow"] || "").trim()
    if (!shadows || shadows === "none") return null
    const segments = shadows.split(/,(?![^(]*\))/)
    const filters = []
    for (const seg of segments) {
      const colorMatch = seg.match(/(rgba?\([^)]+\)|hsla?\([^)]+\)|#[0-9a-fA-F]{3,8})/)
      const color = colorMatch ? colorMatch[1] : "rgba(0,0,0,0.2)"
      const numericMatcher = /-?\d+(?:\.\d+)?(?=px)/g
      const nums = []
      let m = numericMatcher.exec(seg)
      while (m) { nums.push(Number(m[0])); m = numericMatcher.exec(seg) }
      const ox = nums[0] || 0
      const oy = nums[1] || 0
      const blur = nums[2] || 0
      filters.push(
        `<feDropShadow dx="${ox}" dy="${oy}" stdDeviation="${blur / 2}" flood-color="${escapeXml(color)}"/>`
      )
    }
    if (!filters.length) return null
    const id = defs.add(`<filter id="__id__" x="-50%" y="-50%" width="200%" height="200%">${filters.join("")}</filter>`)
    defs._patchLastId(id)
    return id
  }

  function buildBorderRect(node, x, y, w, h, defs) {
    const styles = node.styles || {}
    const widths = parseSidedBox(styles, "border")
    const widthsArray = [widths.top, widths.right, widths.bottom, widths.left]
    const allEqual = widthsArray.every((v) => v === widthsArray[0])
    const styleNames = [
      String(styles["border-top-style"] || "none"),
      String(styles["border-right-style"] || "none"),
      String(styles["border-bottom-style"] || "none"),
      String(styles["border-left-style"] || "none")
    ]
    const allVisible = styleNames.every((s) => s !== "none" && s !== "")
    const color = passThroughColor(styles["border-top-color"])
    if (!allEqual || !allVisible || !color || widthsArray[0] <= 0) return ""
    const stroke = ` stroke="${escapeXml(color)}" stroke-width="${widthsArray[0]}"`
    const radius = parsePxNumber(styles["border-radius"], 0)
    const rx = radius ? ` rx="${radius}" ry="${radius}"` : ""
    return `<rect x="${x + widthsArray[0] / 2}" y="${y + widthsArray[0] / 2}" width="${Math.max(0, w - widthsArray[0])}" height="${Math.max(0, h - widthsArray[0])}"${rx} fill="none"${stroke}/>`
  }

  function buildTextElement(node, x, y, parentStyles) {
    const text = String(node.text || "")
    if (!text) return ""

    const ranges = Array.isArray(node.ranges) ? node.ranges : null
    const baseStyles = (ranges && ranges.length && ranges[0].styles) || parentStyles || {}
    const fontSize = parsePxNumber(baseStyles["font-size"], 14)
    const lineHeight = parsePxNumber(baseStyles["line-height"], fontSize * 1.2)
    const family = String(baseStyles["font-family"] || "Inter").split(",")[0].replace(/['"]/g, "").trim() || "Inter"
    const weight = String(baseStyles["font-weight"] || "400").trim()
    const fillColor = passThroughColor(baseStyles.color) || "#000"
    const letterSpacing = parsePxNumber(baseStyles["letter-spacing"], 0)
    const textAnchor =
      String(baseStyles["text-align"] || "left").trim() === "center" ? "middle"
      : String(baseStyles["text-align"] || "left").trim() === "right" ? "end"
      : "start"

    // Anchor at baseline: y = top + ascent ≈ top + fontSize * 0.8.
    // Use the captured node.metrics height to position more accurately
    // when available.
    const baselineY = y + Math.min(fontSize, lineHeight) * 0.8

    const baseAttrs =
      ` font-family="${escapeXml(family)}"` +
      ` font-size="${fontSize}"` +
      ` font-weight="${escapeXml(weight)}"` +
      ` fill="${escapeXml(fillColor)}"` +
      (letterSpacing ? ` letter-spacing="${letterSpacing}"` : "") +
      ` text-anchor="${textAnchor}"`

    const anchorX = textAnchor === "middle" ? x + (node.metrics ? node.metrics.width / 2 : 0)
      : textAnchor === "end" ? x + (node.metrics ? node.metrics.width : 0)
      : x

    if (!ranges || !ranges.length) {
      return `<text x="${anchorX}" y="${baselineY}"${baseAttrs}>${escapeXml(text)}</text>`
    }

    const tspans = []
    for (const range of ranges) {
      if (!range || range.start == null || range.end == null) continue
      const slice = text.slice(Math.max(0, range.start), Math.max(0, range.end))
      if (!slice) continue
      const rs = range.styles || {}
      const rangeFill = passThroughColor(rs.color)
      const rangeWeight = rs["font-weight"] && String(rs["font-weight"]).trim()
      const rangeFamily = rs["font-family"] && String(rs["font-family"]).split(",")[0].replace(/['"]/g, "").trim()
      const rangeSize = rs["font-size"] && parsePxNumber(rs["font-size"], null)
      let attrs = ""
      if (rangeFill && rangeFill !== fillColor) attrs += ` fill="${escapeXml(rangeFill)}"`
      if (rangeWeight && rangeWeight !== weight) attrs += ` font-weight="${escapeXml(rangeWeight)}"`
      if (rangeFamily && rangeFamily !== family) attrs += ` font-family="${escapeXml(rangeFamily)}"`
      if (rangeSize && rangeSize !== fontSize) attrs += ` font-size="${rangeSize}"`
      tspans.push(`<tspan${attrs}>${escapeXml(slice)}</tspan>`)
    }
    return `<text x="${anchorX}" y="${baselineY}"${baseAttrs}>${tspans.join("")}</text>`
  }

  function buildImageElement(node, x, y) {
    const href = (node.attributes && (node.attributes.src || node.attributes.href)) || ""
    if (!href) return ""
    const w = node.metrics ? node.metrics.width : 0
    const h = node.metrics ? node.metrics.height : 0
    return `<image x="${x}" y="${y}" width="${w}" height="${h}" href="${escapeXml(href)}" preserveAspectRatio="xMidYMid slice"/>`
  }

  function buildSvgInline(node, x, y) {
    if (!node.svgInnerMarkup) return ""
    const w = node.metrics ? node.metrics.width : 24
    const h = node.metrics ? node.metrics.height : 24
    const viewBox = (node.attributes && node.attributes.viewBox) || `0 0 ${w} ${h}`
    return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${escapeXml(viewBox)}" overflow="visible">${node.svgInnerMarkup}</svg>`
  }

  // Walk a node and append its SVG markup to `out`. Coordinates are
  // already absolute in the page; we keep them absolute in the SVG too
  // because Figma's SVG-paste handles a flat coordinate system with
  // every layer positioned in the document's space — converting to
  // hierarchical translates would just add complexity.
  function renderNode(node, out, defs, inheritedStyles) {
    if (!node) return
    const m = node.metrics || { x: 0, y: 0, width: 0, height: 0 }
    const styles = node.styles || {}

    // Skip nodes with zero size and no content.
    if (node.type === "element" && !m.width && !m.height && (!node.children || !node.children.length)) {
      return
    }

    if (node.type === "text") {
      out.push(buildTextElement(node, m.x, m.y, inheritedStyles))
      return
    }

    if (node.tag === "svg") {
      out.push(buildSvgInline(node, m.x, m.y))
      return
    }

    if (node.tag === "img") {
      out.push(buildImageElement(node, m.x, m.y))
      // Children of <img> shouldn't exist, but bail anyway.
      return
    }

    // Decoration rect (background fill + rounded corners + opacity).
    const fill = buildBackgroundFill(node, defs)
    const radius = parsePxNumber(styles["border-radius"], 0)
    const opacity = parsePxNumber(styles.opacity, 1)
    const filterId = buildShadowFilter(node, defs)

    if (fill || radius || filterId) {
      let attrs = `x="${m.x}" y="${m.y}" width="${m.width}" height="${m.height}"`
      if (radius) attrs += ` rx="${radius}" ry="${radius}"`
      attrs += ` fill="${fill ? escapeXml(fill) : "none"}"`
      if (opacity < 1) attrs += ` opacity="${opacity}"`
      if (filterId) attrs += ` filter="url(#${filterId})"`
      out.push(`<rect ${attrs}/>`)
    }

    // Border (uniform-only for v1; mixed sides fall through with no stroke).
    const borderMarkup = buildBorderRect(node, m.x, m.y, m.width, m.height, defs)
    if (borderMarkup) out.push(borderMarkup)

    if (Array.isArray(node.children)) {
      const mergedStyles = Object.assign({}, inheritedStyles || {}, styles)
      for (const child of node.children) {
        renderNode(child, out, defs, mergedStyles)
      }
    }
  }

  // Substitute every var(--name[, fallback]) in `value` with a concrete
  // value from the captured CSS variable map. SVG inner markup (e.g.
  // <path fill="var(--geist-background)">) doesn't go through CSS
  // computed-style resolution, so the var() literal would otherwise
  // leak into the SVG and render incorrectly when pasted into Figma.
  function resolveCssVarsInString(value, varMap) {
    if (!value) return value
    let text = String(value)
    if (text.indexOf("var(") === -1) return text
    let depth = 0
    while (text.indexOf("var(") !== -1 && depth < 6) {
      text = text.replace(/var\(\s*(--[^,)]+?)\s*(?:,\s*([^)]+))?\)/g, function(_, name, fb) {
        if (varMap && Object.prototype.hasOwnProperty.call(varMap, String(name).trim())) {
          const v = String(varMap[String(name).trim()] || "").trim()
          if (v) return v
        }
        const fallback = (fb || "").trim()
        return fallback || ""
      })
      depth += 1
    }
    return text
  }

  function buildPasteableSvg(capture) {
    if (!capture || !capture.tree) return ""
    const tree = capture.tree
    const rootRect = tree.metrics || { x: 0, y: 0, width: 0, height: 0 }
    const w = Math.max(1, Math.round(rootRect.width || 1))
    const h = Math.max(1, Math.round(rootRect.height || 1))

    const varMap = (capture.metadata && capture.metadata.cssVariables) || {}

    // Pre-resolve var() references in the cloned tree so the renderer
    // sees concrete colors. We clone first to avoid mutating the
    // original capture object.
    const treeClone = JSON.parse(JSON.stringify(tree))
    function preResolveTree(node) {
      if (!node || typeof node !== "object") return
      if (node.styles) {
        for (const key in node.styles) {
          if (!Object.prototype.hasOwnProperty.call(node.styles, key)) continue
          const v = node.styles[key]
          if (typeof v === "string" && v.indexOf("var(") !== -1) {
            node.styles[key] = resolveCssVarsInString(v, varMap)
          }
        }
      }
      if (typeof node.svgInnerMarkup === "string" && node.svgInnerMarkup.indexOf("var(") !== -1) {
        node.svgInnerMarkup = resolveCssVarsInString(node.svgInnerMarkup, varMap)
      }
      if (Array.isArray(node.ranges)) {
        for (const r of node.ranges) {
          if (r && r.styles) {
            for (const k in r.styles) {
              if (!Object.prototype.hasOwnProperty.call(r.styles, k)) continue
              const v = r.styles[k]
              if (typeof v === "string" && v.indexOf("var(") !== -1) {
                r.styles[k] = resolveCssVarsInString(v, varMap)
              }
            }
          }
        }
      }
      if (Array.isArray(node.children)) {
        for (const c of node.children) preResolveTree(c)
      }
    }
    preResolveTree(treeClone)

    // Defs registry: patches the placeholder __id__ inside markup with
    // a generated id when the entry is added.
    const entries = []
    const defs = {
      add(markup) {
        const id = "rc-def-" + (entries.length + 1)
        entries.push({ id, markup: markup.replace("__id__", id) })
        return id
      },
      _patchLastId() { /* no-op: ids are patched at insert time */ },
      render() {
        return entries.map(function(e) { return e.markup }).join("")
      }
    }

    const out = []
    // Translate root so the SVG starts at (0,0) regardless of where the
    // captured component lived in the source page.
    out.push(`<g transform="translate(${-Math.round(rootRect.x)} ${-Math.round(rootRect.y)})">`)
    renderNode(treeClone, out, defs, treeClone.styles || {})
    out.push(`</g>`)

    const defsMarkup = defs.render()
    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
      defsMarkup ? `<defs>${defsMarkup}</defs>` : "",
      out.join(""),
      `</svg>`
    ].join("\n")
  }

  window.ReplicodeFigmaExport = {
    buildPayload,
    generateImportJson,
    buildPasteableSvg
  }
})()

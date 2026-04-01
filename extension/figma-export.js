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

  window.ReplicodeFigmaExport = {
    buildPayload,
    generateImportJson
  }
})()

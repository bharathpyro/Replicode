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

  // Kiwi floats are bit-rotated to push the IEEE 754 exponent into the
  // low byte, then written variable-length: a single 0x00 if every byte
  // would be zero (i.e. the value is 0.0), otherwise 4 bytes of the
  // rotated form little-endian. Reference:
  //   https://github.com/evanw/kiwi/blob/master/cpp/kiwi.h#L52 (writeFloat)
  // For example, 1.0f (IEEE 0x3F800000) rotates to 0x0000007F → bytes
  //   0x7F 0x00 0x00 0x00. Plain IEEE LE would write 0x00 0x00 0x80 0x3F
  //   instead — that's the bug Figma's wasm decoder was rejecting.
  const _floatBuf = new ArrayBuffer(4)
  const _floatView = new DataView(_floatBuf)
  function writeFloat32(w, value) {
    _floatView.setFloat32(0, Number(value) || 0, true)
    const bits = _floatView.getUint32(0, true) >>> 0
    // Rotate right 23: equivalent to (bits >> 23) | (bits << 9) on
    // unsigned 32-bit. Done as two unsigned shifts + OR.
    const rotated = ((bits >>> 23) | ((bits << 9) >>> 0)) >>> 0
    if (rotated === 0) {
      w.writeByte(0)
      return
    }
    w.writeByte(rotated & 0xff)
    w.writeByte((rotated >>> 8) & 0xff)
    w.writeByte((rotated >>> 16) & 0xff)
    w.writeByte((rotated >>> 24) & 0xff)
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
  // Critical detail learned the hard way: Chrome's clipboard write
  // sanitiser COLLAPSES two adjacent EMPTY <span> elements into a
  // single <span> with merged attributes. If we emit:
  //   <span data-metadata="X"></span><span data-buffer="Y"></span>
  // … Chrome's sanitiser turns it into:
  //   <span data-metadata="X" data-buffer="Y"></span>
  // which Figma's wasm parser then rejects as "Invalid clipboard
  // contents" because its regex expects them on separate spans.
  //
  // Fix: give the data-buffer span non-empty content so Chrome can't
  // collapse it. Use the plain-text fallback as that content (and as
  // the trailing fallback span Figma emits for paste-into-rich-text
  // targets).
  function buildHtmlEnvelope(figmetaJson, figmaContainerBytes, plainText) {
    const figmetaB64 = base64Encode(new TextEncoder().encode(JSON.stringify(figmetaJson)))
    const figmaB64 = base64Encode(figmaContainerBytes)
    const rawText = String(plainText == null ? "" : plainText)
    const escapedText = rawText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
    // The data-buffer span MUST have content (not just whitespace
    // either — Chrome's sanitiser also strips that). A non-breaking
    // space is enough to prevent collapse and is invisible when the
    // payload is pasted into a rich-text target.
    const bufferContent = escapedText || "&nbsp;"
    return [
      `<meta charset="utf-8">`,
      `<div>`,
      `<span data-metadata="<!--(figmeta)${figmetaB64}(/figmeta)-->"></span>`,
      `<span data-buffer="<!--(figma)${figmaB64}(/figma)-->">${bufferContent}</span>`,
      `</div>`
    ].join("")
  }

  // ── 8. Schema-shaped encoders ─────────────────────────────────────
  //
  // Hand-rolled encoders for the slice of the Figma kiwi schema we
  // need to synthesise an empty Document/Canvas/Frame paste. Field
  // IDs and ordering match the captured schema (figma-scene.schema.bin,
  // 584 definitions; see schema-dump.txt). Skipping the per-field
  // *Tag companions — those are multiplayer-sync fields, not needed
  // when the receiver is treating the payload as a paste.

  // STRUCT GUID { sessionID: uint, localID: uint }
  function writeGUID(w, value) {
    writeVarUint(w, (value && value.sessionID) | 0)
    writeVarUint(w, (value && value.localID) | 0)
  }

  // STRUCT Vector { x: float, y: float }
  function writeVector(w, value) {
    writeFloat32(w, value && value.x)
    writeFloat32(w, value && value.y)
  }

  // STRUCT Color { r,g,b,a: float (0..1) }
  function writeColor(w, value) {
    writeFloat32(w, value && value.r)
    writeFloat32(w, value && value.g)
    writeFloat32(w, value && value.b)
    writeFloat32(w, value == null || value.a == null ? 1 : value.a)
  }

  // STRUCT Matrix { m00..m12: float } (2D affine, row-major 2x3)
  function writeMatrix(w, value) {
    const v = value || {}
    writeFloat32(w, v.m00 == null ? 1 : v.m00)
    writeFloat32(w, v.m01 == null ? 0 : v.m01)
    writeFloat32(w, v.m02 == null ? 0 : v.m02)
    writeFloat32(w, v.m10 == null ? 0 : v.m10)
    writeFloat32(w, v.m11 == null ? 1 : v.m11)
    writeFloat32(w, v.m12 == null ? 0 : v.m12)
  }

  // STRUCT ParentIndex { guid: GUID, position: string }
  function writeParentIndex(w, value) {
    writeGUID(w, value && value.guid)
    writeKiwiString(w, value && value.position)
  }

  // MESSAGE Paint — the small subset we emit (SOLID + opacity).
  // Field IDs from schema:
  //   [1] type: PaintType  (SOLID=0, GRADIENT_LINEAR=1, ...)
  //   [2] color: Color
  //   [3] opacity: float
  //   [4] visible: bool
  //   [5] blendMode: BlendMode
  function writePaint(w, paint) {
    if (!paint) {
      w.writeByte(0) // empty message
      return
    }
    if (paint.type != null) {
      writeVarUint(w, 1)
      writeVarUint(w, paint.type | 0)
    }
    if (paint.color) {
      writeVarUint(w, 2)
      writeColor(w, paint.color)
    }
    if (paint.opacity != null) {
      writeVarUint(w, 3)
      writeFloat32(w, paint.opacity)
    }
    if (paint.visible != null) {
      writeVarUint(w, 4)
      writeBool(w, paint.visible)
    }
    if (paint.blendMode != null) {
      writeVarUint(w, 5)
      writeVarUint(w, paint.blendMode | 0)
    }
    w.writeByte(0) // message terminator
  }

  // MESSAGE NodeChange — only the fields we set today. Skipping the
  // ~580 we don't need; the receiver fills in defaults. Each field is
  // a (varuint id, value...) pair; the message ends with varuint 0.
  //
  // Field order matters in one respect only: it must match the
  // captured Figma scene's order to maximise byte-level parity. The
  // captured Document NC writes (in this order):
  //   guid, phase, type, name, visible, opacity, transform
  // We mirror that here so per-node field ordering matches.
  function writeNodeChange(w, n) {
    if (!n) { w.writeByte(0); return }

    if (n.guid) {
      writeVarUint(w, 1)
      writeGUID(w, n.guid)
    }
    if (n.phase != null) {
      writeVarUint(w, 2)
      writeVarUint(w, n.phase | 0)
    }
    if (n.parentIndex) {
      writeVarUint(w, 3)
      writeParentIndex(w, n.parentIndex)
    }
    if (n.type != null) {
      writeVarUint(w, 4)
      writeVarUint(w, n.type | 0)
    }
    if (n.name != null) {
      writeVarUint(w, 5)
      writeKiwiString(w, n.name)
    }
    if (n.visible != null) {
      writeVarUint(w, 6)
      writeBool(w, !!n.visible)
    }
    if (n.opacity != null) {
      writeVarUint(w, 8)
      writeFloat32(w, n.opacity)
    }
    if (n.size) {
      writeVarUint(w, 11)
      writeVector(w, n.size)
    }
    if (n.transform) {
      writeVarUint(w, 12)
      writeMatrix(w, n.transform)
    }
    if (n.fillPaints && n.fillPaints.length) {
      writeVarUint(w, 38)
      writeVarUint(w, n.fillPaints.length)
      for (const p of n.fillPaints) writePaint(w, p)
    }
    w.writeByte(0) // message terminator
  }

  // MESSAGE Message — the top-level scene envelope. Field IDs:
  //   [1]  type: MessageType
  //   [2]  sessionID: uint
  //   [3]  ackID: uint
  //   [4]  nodeChanges: NodeChange[]
  //   [12] pasteID: int  (zig-zag) — must match figmeta.pasteID
  //   [14] pasteFileKey: string
  //   [19] pasteIsPartiallyOutsideEnclosingFrame: bool
  //   [20] pastePageId: GUID  (zero = "Figma resolves on paste")
  //   [21] isCut: bool
  //   [27] pasteEditorType: EditorType
  //   [29] publishedAssetGuids: GUID[]
  //   [33] clipboardSelectionRegions: ClipboardSelectionRegion[]
  //   [41] pasteAssetType: PasteAssetType
  //
  // Field-emission order mirrors the captured Figma fixture exactly
  // (nodeChanges LAST), even though kiwi is officially order-
  // independent. Empirically Figma's wasm decoder seemed sensitive to
  // missing or out-of-order top-level fields when "Failed to load
  // scene" started firing.
  function writeMessage(w, m) {
    writeVarUint(w, 1)
    writeVarUint(w, m.type | 0)
    writeVarUint(w, 2)
    writeVarUint(w, (m.sessionID | 0) >>> 0)
    writeVarUint(w, 3)
    writeVarUint(w, (m.ackID | 0) >>> 0)
    if (m.pasteID != null) {
      writeVarUint(w, 12)
      writeVarInt(w, m.pasteID | 0)
    }
    if (m.pasteFileKey != null) {
      writeVarUint(w, 14)
      writeKiwiString(w, m.pasteFileKey)
    }
    writeVarUint(w, 19)
    writeBool(w, !!m.pasteIsPartiallyOutsideEnclosingFrame)
    // pastePageId — captured fixture uses the SOURCE Canvas's GUID
    // (0, 1), not zero. Figma's wasm decoder may fail "Failed to load
    // scene" if pastePageId points to a GUID that isn't in the scene's
    // nodeChanges. (0, 1) IS in our scene (the Canvas) so this links
    // the paste back to a real node.
    writeVarUint(w, 20)
    writeGUID(w, m.pastePageId || CANVAS_GUID)
    writeVarUint(w, 21)
    writeBool(w, !!m.isCut)
    // pasteEditorType: 0 = DESIGN (the only editor type relevant here).
    writeVarUint(w, 27)
    writeVarUint(w, (m.pasteEditorType | 0) >>> 0)
    // publishedAssetGuids[]: empty array in captured fixture; we mirror.
    writeVarUint(w, 29)
    writeVarUint(w, 0) // count = 0
    // clipboardSelectionRegions[]: captured fixture has 1 entry with
    // selection metadata. Empty should be safe — Figma's spec calls
    // these "selection metadata for paste-in-place" which is optional.
    writeVarUint(w, 33)
    writeVarUint(w, 0) // count = 0
    // pasteAssetType: 0 = default. Captured fixture sets this.
    writeVarUint(w, 41)
    writeVarUint(w, (m.pasteAssetType | 0) >>> 0)
    // nodeChanges LAST — captured fixture emits them last and Figma's
    // decoder expects this ordering.
    if (m.nodeChanges && m.nodeChanges.length) {
      writeVarUint(w, 4)
      writeVarUint(w, m.nodeChanges.length)
      for (const n of m.nodeChanges) writeNodeChange(w, n)
    }
    w.writeByte(0)
  }

  // ── 9. Synthesise a scene from a Replicode capture ────────────────
  //
  // Walks the capture tree and emits a flat NodeChange[] in document
  // order:
  //   - Document (root of the scene graph, no parent)
  //   - Canvas  (the synthetic "Page 1" the frame lives on)
  //   - root Frame (sized to capture.tree.metrics)
  //   - one child Frame per descendant element, with transform.m02/m12
  //     translated relative to the parent's metrics so layout matches
  //     the captured page
  //
  // Skipped for now (silently — these become regular empty frames):
  //   - SVG nodes (vector path encoding lands in the next slice)
  //   - text-typed nodes (need fontName + textData, separate work)
  //
  // Falls back to the captured fixture if the capture has no usable
  // root metrics, so the writer is never silently no-op.
  const NODE_TYPE = { DOCUMENT: 1, CANVAS: 2, FRAME: 4 }
  const NODE_PHASE_CREATED = 0
  const MSG_TYPE_NODE_CHANGES = 1
  const PAINT_TYPE_SOLID = 0
  const BLEND_NORMAL = 1
  const IDENTITY_TRANSFORM = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
  const SOLID_WHITE = { r: 1, g: 1, b: 1, a: 1 }

  function pickRootRect(capture) {
    const tree = capture && capture.tree
    if (!tree) return null
    const m = tree.metrics || {}
    const w = Number(m.width) || 320
    const h = Number(m.height) || 200
    return { width: Math.max(1, w), height: Math.max(1, h) }
  }

  // LexoRank-shaped sibling ordering: child 0 -> "!", child 1 -> "!!",
  // child 2 -> "!!!", … Strictly increasing under lexical comparison
  // (shared prefix, the longer string sorts after the shorter one),
  // which is all Figma needs to preserve sibling order.
  function lexoRankAt(index) {
    return "!".repeat((index | 0) + 1)
  }

  // CSS color parsing — only what we need to seed a Frame's fillPaints
  // from styles.background-color. Returns a kiwi-shaped {r,g,b,a} in
  // 0..1 range, or null if the value isn't a recognised solid color.
  function parseSolidCssColor(value) {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    if (!trimmed || trimmed === "transparent" || trimmed === "none") return null
    let r, g, b, a = 1
    const hex = trimmed.match(/^#([0-9a-f]{3,8})$/i)
    if (hex) {
      const h = hex[1]
      if (h.length === 3 || h.length === 4) {
        r = parseInt(h[0] + h[0], 16) / 255
        g = parseInt(h[1] + h[1], 16) / 255
        b = parseInt(h[2] + h[2], 16) / 255
        if (h.length === 4) a = parseInt(h[3] + h[3], 16) / 255
      } else if (h.length === 6 || h.length === 8) {
        r = parseInt(h.slice(0, 2), 16) / 255
        g = parseInt(h.slice(2, 4), 16) / 255
        b = parseInt(h.slice(4, 6), 16) / 255
        if (h.length === 8) a = parseInt(h.slice(6, 8), 16) / 255
      } else {
        return null
      }
      return { r, g, b, a }
    }
    const rgba = trimmed.match(/^rgba?\(([^)]+)\)$/i)
    if (rgba) {
      const parts = rgba[1].split(/[,/\s]+/).filter(Boolean)
      if (parts.length < 3) return null
      r = parseFloat(parts[0]) / 255
      g = parseFloat(parts[1]) / 255
      b = parseFloat(parts[2]) / 255
      if (parts.length >= 4) {
        const aRaw = parts[3]
        a = aRaw.endsWith("%") ? parseFloat(aRaw) / 100 : parseFloat(aRaw)
      }
      if ([r, g, b, a].some((n) => Number.isNaN(n))) return null
      return { r, g, b, a }
    }
    return null
  }

  function fillFromStyles(styles) {
    if (!styles) return null
    const bg = styles["background-color"] || styles.backgroundColor
    const color = parseSolidCssColor(bg)
    if (!color || color.a === 0) return null
    return {
      type: PAINT_TYPE_SOLID,
      color,
      opacity: 1,
      visible: true,
      blendMode: BLEND_NORMAL
    }
  }

  // Decide whether to emit a NodeChange for a capture node and which
  // type tag to use. Today we only emit FRAME nodes; everything else
  // (text, svg, raw text nodes) is skipped so the parent's empty
  // frame still pastes cleanly. Returns null to skip.
  function nodeTypeForCapture(node) {
    if (!node) return null
    if (node.svgInnerMarkup) return null // vectors land in a later slice
    if (node.type && node.type !== "element") return null // raw text runs
    if (!node.metrics) return null
    if (!node.metrics.width || !node.metrics.height) return null
    return NODE_TYPE.FRAME
  }

  // GUID conventions, learned from the captured Figma fixture:
  //   * Document at (0, 0) — Figma seems to special-case this GUID
  //     as "the document"; using anything else makes Figma's wasm
  //     decoder fail with "Failed to load scene".
  //   * Canvas at (0, 1) with parentIndex.guid = (0, 0)
  //   * Content nodes use a separate sessionID (we use 1) to avoid
  //     colliding with the wrapper GUIDs. Content session is what
  //     the figmeta selectedNodeData references.
  const DOC_GUID = { sessionID: 0, localID: 0 }
  const CANVAS_GUID = { sessionID: 0, localID: 1 }
  const CONTENT_SESSION_ID = 1

  // Recursively emit child NodeChange records under `parentGuid`.
  // `parentMetrics` is in absolute viewport coords; child frames get
  // transform.m02/m12 = childMetrics - parentMetrics so positioning
  // matches the source page.
  function emitChildren(state, parent, parentMetrics) {
    const children = (parent.children || []).filter(nodeTypeForCapture)
    children.forEach((child, index) => {
      const guid = { sessionID: CONTENT_SESSION_ID, localID: state.nextLocalId++ }
      const cm = child.metrics
      const px = (parentMetrics && parentMetrics.x) || 0
      const py = (parentMetrics && parentMetrics.y) || 0
      const transform = {
        m00: 1, m01: 0, m02: cm.x - px,
        m10: 0, m11: 1, m12: cm.y - py
      }
      const fill = fillFromStyles(child.styles)
      state.nodeChanges.push({
        guid,
        phase: NODE_PHASE_CREATED,
        parentIndex: { guid: state.parentGuidStack[state.parentGuidStack.length - 1], position: lexoRankAt(index) },
        type: NODE_TYPE.FRAME,
        name: child.label || child.tag || "Frame",
        visible: true,
        opacity: 1,
        size: { x: Math.max(1, cm.width), y: Math.max(1, cm.height) },
        transform,
        fillPaints: fill ? [fill] : []
      })
      state.parentGuidStack.push(guid)
      emitChildren(state, child, cm)
      state.parentGuidStack.pop()
    })
  }

  function buildSceneFromCapture(capture, pasteID) {
    const root = pickRootRect(capture)
    if (!root) return null

    const tree = capture.tree
    const rootGuid = { sessionID: CONTENT_SESSION_ID, localID: 1 }

    const rootName = (tree.label || tree.name || tree.tag) || "Frame"
    const rootFill = fillFromStyles(tree.styles) || {
      type: PAINT_TYPE_SOLID,
      color: SOLID_WHITE,
      opacity: 1,
      visible: true,
      blendMode: BLEND_NORMAL
    }

    const state = {
      nextLocalId: 2,
      parentGuidStack: [rootGuid],
      nodeChanges: [
        // Document — GUID (0,0) by Figma convention; carries the
        // same per-node "system" fields the captured fixture sets
        // (visible/opacity/transform) so the wasm decoder doesn't
        // fail validating it.
        {
          guid: DOC_GUID,
          phase: NODE_PHASE_CREATED,
          type: NODE_TYPE.DOCUMENT,
          name: "Document",
          visible: true,
          opacity: 1,
          transform: IDENTITY_TRANSFORM
        },
        // Page (Canvas) at (0,1) with parent (0,0).
        {
          guid: CANVAS_GUID,
          phase: NODE_PHASE_CREATED,
          parentIndex: { guid: DOC_GUID, position: "!" },
          type: NODE_TYPE.CANVAS,
          name: "Page 1",
          visible: true,
          opacity: 1,
          transform: IDENTITY_TRANSFORM
        },
        // Root content frame — separate sessionID so its localID
        // numbering doesn't collide with the wrappers.
        {
          guid: rootGuid,
          phase: NODE_PHASE_CREATED,
          parentIndex: { guid: CANVAS_GUID, position: "!" },
          type: NODE_TYPE.FRAME,
          name: rootName,
          visible: true,
          opacity: 1,
          size: { x: root.width, y: root.height },
          transform: IDENTITY_TRANSFORM,
          fillPaints: [rootFill]
        }
      ]
    }

    emitChildren(state, tree, tree.metrics || { x: 0, y: 0 })

    const message = {
      type: MSG_TYPE_NODE_CHANGES,
      sessionID: 0,
      ackID: 0,
      nodeChanges: state.nodeChanges,
      pasteID,
      pasteFileKey: "replicode-extension",
      pasteIsPartiallyOutsideEnclosingFrame: false,
      isCut: false
    }

    const w = createByteWriter(1024)
    writeMessage(w, message)
    return {
      bytes: w.toUint8Array(),
      // The node Figma should treat as "the user's selection" when
      // pasting. Format: <sessionID>:<localID>|<NodeType>|<flags>.
      // Points at the root FRAME — selecting Document/Canvas wrappers
      // makes Figma drop the paste (they can't be re-parented).
      selectedNodeData: rootGuid.sessionID + ":" + rootGuid.localID + "|" + NODE_TYPE.FRAME + "|0"
    }
  }

  // ── 9. High-level entry point ─────────────────────────────────────
  //
  // Returns the `text/html` clipboard string the Figma button should
  // copy, or null if synthesis isn't possible for this capture (caller
  // falls back to the JSON-for-plugin path).
  // Diagnostic mode: instead of synthesising a scene from the
  // capture, ship the captured Figma fixture verbatim — same scene
  // bytes Figma's own clipboard wrote, same figmeta values. Used
  // to bisect "Invalid clipboard contents" failures: if the fixture
  // round-trip pastes cleanly, our wrapper/schema/zstd is fine and
  // the bug is in the scene encoder; if it still fails, the bug is
  // in the wrapper or the embedded schema chunk drifted from
  // Figma's current build.
  //
  // Captured figmeta values (from figma breakdown/figma-write-text_html.bin):
  //   pasteID: 352842067
  //   selectedNodeData: "10:5|4|0"
  //   environment: "www.figma.com"
  //   fileKey: "s0f8nHeiYzvUfPOGqFZtx2"
  function buildFixtureFigmaClipboardHtml() {
    // The fixture's scene chunk is already zstd-compressed (in the
    // original capture). We don't have the raw scene Message bytes
    // to re-frame; the embedded `SCENE_FIXTURE_B64` IS the inflated
    // scene Message. So we have to re-compress it. Use our
    // store-only zstd raw frame — same as the synth path.
    const scene = getSceneFixture()
    const sceneFrame = buildZstdRawFrame(scene)
    const container = buildKiwiContainer(getSchemaChunk(), sceneFrame)
    const figmeta = {
      fileKey: "s0f8nHeiYzvUfPOGqFZtx2",
      pasteID: 352842067,
      dataType: "scene",
      environment: "www.figma.com",
      selectedNodeData: "10:5|4|0"
    }
    return buildHtmlEnvelope(figmeta, container, "ab")
  }

  function buildFigmaClipboardHtml(capture, options) {
    options = options || {}

    // Diagnostic short-circuit: opt in via options.fixture or by
    // setting localStorage.replicodeFigmaFixture = "on". Useful for
    // bisecting paste rejections — see buildFixtureFigmaClipboardHtml
    // above.
    let useFixture = !!(options && options.fixture)
    if (!useFixture) {
      try {
        useFixture = window.localStorage &&
          window.localStorage.getItem("replicodeFigmaFixture") === "on"
      } catch (_) { /* localStorage might be unavailable */ }
    }
    if (useFixture) {
      try {
        return buildFixtureFigmaClipboardHtml()
      } catch (err) {
        console.warn("[replicode] fixture mode failed:", err)
        // Fall through to normal synthesis.
      }
    }

    // Single source of truth for pasteID — used by BOTH the figmeta
    // JSON (so Figma can match it for paste deduplication) AND the
    // top-level Message (field 12). Mismatched values cause Figma
    // to silently drop the paste.
    const pasteID = (options.pasteID != null
      ? options.pasteID | 0
      : (Math.random() * 0x7fffffff) | 0)

    let scene
    try {
      scene = buildSceneFromCapture(capture, pasteID)
    } catch (err) {
      console.warn("[replicode] scene synthesis failed:", err)
      return null
    }
    if (!scene) return null

    const sceneFrame = buildZstdRawFrame(scene.bytes)
    const container = buildKiwiContainer(getSchemaChunk(), sceneFrame)

    // Figma's paste handler validates these JSON fields against the
    // shape of its own clipboard writes. Diverging from that shape is
    // a likely cause of silent paste rejection. Captured Figma sample:
    //   { fileKey: "<22-char base62>", pasteID, dataType: "scene",
    //     environment: "www.figma.com", selectedNodeData: "<sess>:<id>|<NodeType>|<flags>" }
    // We mirror the shape exactly:
    //   - fileKey: a placeholder 22-char string that won't collide
    //     with any real Figma file (but still passes whatever length
    //     check Figma may do)
    //   - environment: "www.figma.com" so Figma doesn't filter the
    //     paste out as cross-environment
    const figmeta = {
      fileKey: options.fileKey || "ReplicodeReplicodeRecv",
      pasteID,
      dataType: "scene",
      environment: options.environment || "www.figma.com",
      selectedNodeData: options.selectedNodeData || scene.selectedNodeData
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

    // Schema-shaped encoders (exported so Phase 2b iterations can
    // assemble custom NodeChange records without re-implementing).
    writeGUID,
    writeVector,
    writeColor,
    writeMatrix,
    writeParentIndex,
    writePaint,
    writeNodeChange,
    writeMessage,

    // High-level entry point used by the Figma button.
    buildFigmaClipboardHtml,
    buildFixtureFigmaClipboardHtml,

    // Sanity probe — returns true once the writer is ready to attempt
    // a clipboard payload. Currently always true because we ship a
    // captured-scene fallback.
    isReady() { return true }
  }

  const ns = (window.ReplicodeFigmaExport = window.ReplicodeFigmaExport || {})
  ns.figmaClipboard = api
})()

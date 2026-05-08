/* global chrome, window */
;(() => {
  // ────────────────────────────────────────────────────────────────────
  // Replicode → Figma clipboard writer
  //
  // Synthesises a binary payload that Figma's web app accepts as a
  // cross-document paste — the same flow that runs when you copy a
  // Frame from one Figma file and paste it into another. The Figma
  // payload is encoded with `kiwi` (https://github.com/evanw/kiwi),
  // a schema-driven binary format Evan Wallace open-sourced.
  //
  // This module ships the universal kiwi encoding primitives plus a
  // node-tree builder that maps a Replicode capture onto Figma's
  // schema. The schema-specific bits (field IDs, magic bytes) are
  // tracked in `figma-clipboard-spec.md` and patched in here as we
  // reverse-engineer them from real Figma clipboard captures.
  //
  // The writer is intentionally tolerant: any feature it can't
  // synthesise yet returns null, and the caller (Figma button in the
  // floating bar) falls back to the JSON-for-plugin path so users
  // never get a broken paste.
  // ────────────────────────────────────────────────────────────────────

  // ── 1. Byte buffer used by all encoders ────────────────────────────
  function createByteWriter(initialCapacity) {
    const cap = Math.max(64, initialCapacity || 256)
    let buffer = new Uint8Array(cap)
    let length = 0

    function ensure(extra) {
      if (length + extra <= buffer.length) return
      let nextCap = buffer.length * 2
      while (nextCap < length + extra) nextCap *= 2
      const next = new Uint8Array(nextCap)
      next.set(buffer.subarray(0, length))
      buffer = next
    }

    return {
      writeByte(b) {
        ensure(1)
        buffer[length++] = b & 0xff
      },
      writeBytes(bytes) {
        ensure(bytes.length)
        buffer.set(bytes, length)
        length += bytes.length
      },
      writeAscii(s) {
        const text = String(s == null ? "" : s)
        ensure(text.length)
        for (let i = 0; i < text.length; i += 1) {
          buffer[length++] = text.charCodeAt(i) & 0xff
        }
      },
      // Snapshot of the bytes written so far. Returns a fresh
      // Uint8Array; the caller owns it.
      toUint8Array() {
        return buffer.slice(0, length)
      },
      get length() { return length }
    }
  }

  // ── 2. Kiwi primitives ─────────────────────────────────────────────
  //
  // Reference: https://github.com/evanw/kiwi#binary-format
  //
  // Varints follow LEB128 (7 data bits per byte, MSB = continuation).
  // Signed integers use zig-zag encoding before varint emission so
  // small negative numbers stay short.

  function writeVarUint(writer, value) {
    let v = value >>> 0
    while (v >= 0x80) {
      writer.writeByte((v & 0x7f) | 0x80)
      v >>>= 7
    }
    writer.writeByte(v & 0x7f)
  }

  function writeVarInt(writer, value) {
    // Zig-zag: positives become 2n, negatives become 2|n|-1, so all
    // small magnitudes encode in a single byte.
    const n = (value | 0)
    const zigzag = (n << 1) ^ (n >> 31)
    writeVarUint(writer, zigzag >>> 0)
  }

  function writeBool(writer, value) {
    writer.writeByte(value ? 0x01 : 0x00)
  }

  function writeFloat32(writer, value) {
    const ab = new ArrayBuffer(4)
    new DataView(ab).setFloat32(0, Number(value) || 0, true)
    writer.writeBytes(new Uint8Array(ab))
  }

  function writeFloat64(writer, value) {
    const ab = new ArrayBuffer(8)
    new DataView(ab).setFloat64(0, Number(value) || 0, true)
    writer.writeBytes(new Uint8Array(ab))
  }

  function writeString(writer, value) {
    // UTF-8 encode then length-prefixed varuint of byte count.
    const bytes = new TextEncoder().encode(String(value == null ? "" : value))
    writeVarUint(writer, bytes.length)
    writer.writeBytes(bytes)
  }

  function writeArray(writer, items, encodeItem) {
    writeVarUint(writer, items.length)
    for (const item of items) encodeItem(writer, item)
  }

  // Kiwi messages: each present field is preceded by its numeric ID;
  // the message is terminated by a varuint 0. Use the helper:
  //
  //   writeMessage(writer, (msg) => {
  //     msg.field(1, (w) => writeString(w, "Hello"))
  //     msg.field(2, (w) => writeBool(w, true))
  //   })
  //
  // The callback decides which fields are present.
  function writeMessage(writer, body) {
    const ctx = {
      field(id, encode) {
        writeVarUint(writer, id)
        encode(writer)
      }
    }
    body(ctx)
    writeVarUint(writer, 0) // terminator
  }

  // Structs: fields are concatenated in declared order with no IDs.
  // Caller is responsible for emitting them in the right order.
  function writeStruct(writer, fields) {
    for (const field of fields) field(writer)
  }

  // Enums: kiwi enums are emitted as their declared numeric value via
  // varuint. We keep an in-process registry so callers can pass
  // strings (e.g. "HORIZONTAL") and have them resolved.
  const enumRegistry = Object.create(null)
  function defineEnum(name, mapping) {
    enumRegistry[name] = mapping
  }
  function writeEnum(writer, name, value) {
    const mapping = enumRegistry[name]
    if (!mapping) {
      throw new Error("Unknown kiwi enum: " + name)
    }
    if (typeof value === "number") {
      writeVarUint(writer, value)
      return
    }
    const numeric = mapping[String(value)]
    if (numeric === undefined) {
      throw new Error("Unknown value for kiwi enum " + name + ": " + value)
    }
    writeVarUint(writer, numeric)
  }

  // ── 3. Field ID registry ───────────────────────────────────────────
  //
  // Figma's schema assigns numeric IDs to every message field. They're
  // not public, so we expose `setFieldId(messageName, fieldName, id)`
  // and let the Phase 1 reconnaissance fill them in. Until they are
  // filled, `buildFigmaClipboardPayload` returns null and the caller
  // falls back to JSON.

  const fieldIds = Object.create(null)
  function fieldKey(messageName, fieldName) {
    return messageName + "::" + fieldName
  }
  function setFieldId(messageName, fieldName, id) {
    fieldIds[fieldKey(messageName, fieldName)] = id
  }
  function getFieldId(messageName, fieldName) {
    const id = fieldIds[fieldKey(messageName, fieldName)]
    return typeof id === "number" ? id : null
  }
  function hasAllFieldIds(messageName, fieldNames) {
    for (const name of fieldNames) {
      if (getFieldId(messageName, name) == null) return false
    }
    return true
  }

  // ── 4. Magic header ────────────────────────────────────────────────
  //
  // Figma's clipboard payload starts with a magic byte string. The
  // exact bytes are tracked in figma-clipboard-spec.md and inserted
  // here once we capture a real payload. Until then we expose a
  // setter so the spec can be updated without re-shipping the writer.

  let magicBytes = null

  function setMagicBytes(bytes) {
    if (bytes && (bytes instanceof Uint8Array || Array.isArray(bytes))) {
      magicBytes = new Uint8Array(bytes)
    }
  }

  // ── 5. Schema definitions (placeholder) ────────────────────────────
  //
  // These mirror the subset documented in figma-clipboard-spec.md.
  // The encoders here are written assuming kiwi message semantics; the
  // numeric field IDs come from `getFieldId(...)`. If any required
  // field ID is missing, the encoder returns false and the writer
  // refuses to produce a payload (so the caller falls back to JSON).

  // Common enums — guesses based on the public Figma plugin API.
  // Real numeric values come from reconnaissance.
  defineEnum("LayoutMode", { NONE: 0, HORIZONTAL: 1, VERTICAL: 2 })
  defineEnum("LayoutWrap", { NO_WRAP: 0, WRAP: 1 })
  defineEnum("AxisSizingMode", { FIXED: 0, AUTO: 1 })
  defineEnum("AxisAlignItems", { MIN: 0, CENTER: 1, MAX: 2, SPACE_BETWEEN: 3, BASELINE: 4 })
  defineEnum("BlendMode", {
    PASS_THROUGH: 0, NORMAL: 1, DARKEN: 2, MULTIPLY: 3, COLOR_BURN: 4,
    LIGHTEN: 5, SCREEN: 6, COLOR_DODGE: 7, OVERLAY: 8, SOFT_LIGHT: 9,
    HARD_LIGHT: 10, DIFFERENCE: 11, EXCLUSION: 12, HUE: 13, SATURATION: 14,
    COLOR: 15, LUMINOSITY: 16
  })
  defineEnum("PaintType", {
    SOLID: 0, GRADIENT_LINEAR: 1, GRADIENT_RADIAL: 2, GRADIENT_ANGULAR: 3,
    GRADIENT_DIAMOND: 4, IMAGE: 5
  })
  defineEnum("EffectType", {
    DROP_SHADOW: 0, INNER_SHADOW: 1, LAYER_BLUR: 2, BACKGROUND_BLUR: 3
  })
  defineEnum("NodeType", {
    FRAME: 0, RECTANGLE: 1, TEXT: 2, VECTOR: 3, GROUP: 4
  })

  // ── 6. Payload builder ─────────────────────────────────────────────
  //
  // The actual mapping from a Replicode `capture` object to a kiwi-
  // encoded byte stream is filled in during Phase 3 of the plan. The
  // entry point is here so the rest of the extension can wire against
  // a stable API; until the schema is reverse-engineered, this returns
  // null and lets the caller fall back to the JSON-for-plugin path.

  function buildFigmaClipboardPayload(_capture, _options) {
    if (!magicBytes) return null
    // TODO(phase-3): walk capture.tree, emit kiwi-encoded scene graph.
    //   - Map element nodes → FrameNode / RectangleNode based on visual
    //     content.
    //   - Map text nodes → TextNode with characters + textRanges from
    //     capture's range styles.
    //   - Map svgInnerMarkup → VectorNode (paths converted via existing
    //     SVG parser; this can leverage figma-export.js helpers).
    //   - Reuse layout decisions from figma-plugin/code.js
    //     (applyAutoLayout, applyTextRanges).
    return null
  }

  // ── 7. Public API ──────────────────────────────────────────────────

  const api = {
    // Encoder primitives — exported for testing / reuse.
    createByteWriter,
    writeVarUint,
    writeVarInt,
    writeBool,
    writeFloat32,
    writeFloat64,
    writeString,
    writeArray,
    writeMessage,
    writeStruct,
    writeEnum,
    defineEnum,

    // Schema runtime — used by the payload builder.
    setFieldId,
    getFieldId,
    hasAllFieldIds,
    setMagicBytes,

    // High-level entry point. Returns Uint8Array on success, null when
    // the writer hasn't been taught enough of Figma's schema yet.
    buildFigmaClipboardPayload,

    // Sanity: returns true once the writer has the magic bytes plus
    // every field ID it needs to emit a Frame containing a Rectangle
    // and a Text node. The Figma button in the floating bar uses this
    // to decide whether to attempt the binary path or jump straight
    // to JSON fallback.
    isReady() {
      if (!magicBytes) return false
      return hasAllFieldIds("FrameNode", ["children", "layoutMode", "size"]) &&
        hasAllFieldIds("RectangleNode", ["fills", "size"]) &&
        hasAllFieldIds("TextNode", ["characters", "fontName", "fontSize", "fills"])
    }
  }

  // Attach to the same export namespace figma-export.js uses, so
  // content-script can pick up either flavour from one place.
  const ns = (window.ReplicodeFigmaExport = window.ReplicodeFigmaExport || {})
  ns.figmaClipboard = api
})()

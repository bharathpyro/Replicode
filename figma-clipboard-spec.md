# Figma clipboard format — working spec

This document is the contract our writer (`extension/figma-clipboard-writer.js`) implements against. It captures what we believe Figma's web app puts on the clipboard when you copy a frame, and the subset of the schema we'll synthesise from outside Figma.

> ⚠️ **Status: incomplete.** Sections marked **[NEEDS CAPTURE]** require dumps of `navigator.clipboard.read()` output from a real Figma copy session before we can fill them in. The writer module ships with kiwi primitives that work regardless of schema; the schema-specific pieces are filled in as we reverse-engineer.

## Background

Figma uses a custom clipboard format for cross-document copy/paste so that auto-layout, text ranges, gradient paints, components, and other rich metadata survive a `⌘C` / `⌘V` between two Figma files. SVG and image fallbacks are included for non-Figma apps, but the Figma-to-Figma path uses a proprietary binary payload.

Two known facts about the encoding:

1. The binary payload is encoded with **kiwi** — Evan Wallace's open-source schema-driven serialization format. Source: https://github.com/evanw/kiwi.
2. Figma's `.fig` save format (separate from the clipboard payload but related) has been partially reverse-engineered by the community. The clipboard payload appears to use a similar but trimmed schema.

## Clipboard MIME types we expect to see

When you copy from Figma's web app, `navigator.clipboard.read()` returns multiple `ClipboardItem` types. The ones relevant to us:

| MIME type | Purpose | Our use |
|---|---|---|
| `application/x-figma-clipboard` | The proprietary binary payload Figma uses to round-trip rich nodes between documents. Editable on paste. | **This is the one we synthesise.** |
| `text/html` | A fallback for paste into rich-text apps (Notion, Slack, etc.). Contains a `<meta>` header that Figma uses to detect "this came from a Figma copy" and trigger paste-as-image. | Optional second item on our `ClipboardItem`. |
| `image/png` | A rasterised preview, used as fallback in apps that only accept images. | Optional; `chrome.tabs.captureVisibleTab` produces this. |
| `text/plain` | The selection's text content concatenated. | Optional. |

> **[NEEDS CAPTURE]** Confirm the exact MIME type string. Figma may use `application/vnd.figma`, `application/x-figma`, or `application/x-figma-clipboard` depending on Chrome version and platform. Capture: open Figma in Chrome → copy a Frame → in devtools `await (await navigator.clipboard.read())[0].types`.

## Binary payload layout (high level)

```
┌────────────────┬──────────────────────────────────────────────────┐
│ Magic / header │ Identifies the format and schema version.        │
│   ~4–16 bytes  │ Likely starts with the ASCII bytes "fig-kiwi"    │
│                │ or a numeric version tag.                        │
├────────────────┼──────────────────────────────────────────────────┤
│ Schema chunk   │ A kiwi-encoded message that describes the scene  │
│   (variable)   │ graph: nodes, fills, effects, text, layout, etc. │
└────────────────┴──────────────────────────────────────────────────┘
```

> **[NEEDS CAPTURE]** Capture the first 32 bytes of the payload from a real Figma copy and document the exact magic / version layout.

## Kiwi encoding primitives we'll need

These are universal across schema versions and don't require Figma-specific knowledge. The writer module implements all of them.

| Primitive | Bytes | Notes |
|---|---|---|
| `bool` | 1 | `0x00` / `0x01`. |
| `byte` | 1 | Unsigned 8-bit. |
| `int / uint` | varint | LEB128-style: 7 bits per byte, MSB = continuation flag. Signed values use zig-zag encoding (`(n << 1) ^ (n >> 31)`). |
| `float` | 4 | IEEE 754 little-endian. |
| `string` | varint length + bytes | UTF-8, length-prefixed. |
| `enum` | varint | The numeric value of the enum case. |
| `struct` | concatenated fields | Fields written in schema-declared order. |
| `message` | field-id varint + value, repeated, terminated by 0 | Each field is preceded by its ID; ID `0` ends the message. |
| `array<T>` | varint length + N×T | Length-prefixed. |
| `discriminated union` | tag varint + body | Schema-defined tag identifies which variant follows. |

## Node schema subset (target for Phase 3)

Field IDs and exact layouts marked **[NEEDS CAPTURE]** until we decode a real payload. Names mirror the Figma plugin API where possible.

### `Node` (base type, discriminated)

```
Node {
  type: NodeType (enum)
  guid?: GUID
  name?: string
  visible?: bool
  opacity?: float
  blendMode?: BlendMode
  effects?: Effect[]
  ... type-specific fields below ...
}
```

Concrete `NodeType` values we plan to emit:

- `FRAME` — container with auto-layout.
- `RECTANGLE` — colored / gradient box.
- `TEXT` — text node with character-range styling.
- `VECTOR` — path-based shapes; Figma converts inline SVG paths into this on paste.
- `GROUP` — non-laying-out container (used when auto-layout doesn't apply).

### `FRAME`-specific

```
FrameNode {
  ... Node base ...
  children: Node[]
  layoutMode: "NONE" | "HORIZONTAL" | "VERTICAL"
  layoutWrap?: "NO_WRAP" | "WRAP"
  primaryAxisSizingMode: "FIXED" | "AUTO"
  counterAxisSizingMode: "FIXED" | "AUTO"
  primaryAxisAlignItems: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN"
  counterAxisAlignItems: "MIN" | "CENTER" | "MAX" | "BASELINE"
  itemSpacing: float
  paddingTop / paddingRight / paddingBottom / paddingLeft: float
  cornerRadius?: float
  fills: Paint[]
  strokes?: Paint[]
  strokeWeight?: float
  clipsContent?: bool
  size: { x: float, y: float }
  position: { x: float, y: float }      // absolute, in document space
}
```

### `TEXT`-specific

```
TextNode {
  ... Node base ...
  characters: string
  fontName: { family: string, style: string }
  fontSize: float
  textAlignHorizontal: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED"
  textAlignVertical: "TOP" | "CENTER" | "BOTTOM"
  textAutoResize: "NONE" | "WIDTH_AND_HEIGHT" | "HEIGHT" | "TRUNCATE"
  fills: Paint[]
  lineHeight?: { value: float, unit: "PIXELS" | "PERCENT" | "AUTO" }
  letterSpacing?: { value: float, unit: "PIXELS" | "PERCENT" }
  textRanges: TextRange[]    // character-range overrides
}

TextRange {
  start: int
  end: int
  fills?: Paint[]
  fontName?: FontName
  fontSize?: float
  fontWeight?: int
  textDecoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH"
  textCase?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE"
  letterSpacing?: ...
  lineHeight?: ...
}
```

### `Paint` (discriminated union)

```
SolidPaint  { type: "SOLID", color: { r, g, b }, opacity?: float }
GradientPaint { type: "GRADIENT_LINEAR" | "GRADIENT_RADIAL" | "GRADIENT_ANGULAR" | "GRADIENT_DIAMOND",
                gradientTransform: 2x3 matrix, gradientStops: { color, position }[] }
ImagePaint  { type: "IMAGE", scaleMode: "FILL" | "FIT" | "TILE" | "STRETCH",
              imageHash: string }   // requires uploaded image; lossy without that
```

### `Effect` (discriminated union)

```
DropShadow / InnerShadow { type, color, offset: {x,y}, radius, spread, blendMode }
LayerBlur / BackgroundBlur { type, radius }
```

## Field IDs

> **[NEEDS CAPTURE]** Each message field has a numeric ID assigned by Figma's schema. Capture and document them here. Until we have them, the writer module exposes `setFieldId(messageName, fieldName, id)` so they can be filled in incrementally without rewriting the encoder.

## Open questions

1. **Magic bytes** — what does the payload start with? Suspected `fig-kiwi` ASCII or similar.
2. **Schema version** — does Figma encode a version number? If so, we should match the most-recent stable version.
3. **GUIDs** — Figma assigns GUIDs to every node. Are they required on paste or generated by the receiver? If required, what format (UUIDv4 string? 16 raw bytes?).
4. **Image fills** — `imageHash` references an uploaded asset. For paste from outside Figma, do we need to base64-embed the image bytes in the payload, or does Figma fetch from a URL?
5. **Component references** — out of scope for v1, but worth understanding the schema entry so we can stub it.

## How to fill in the **[NEEDS CAPTURE]** sections

`navigator.clipboard.read()` requires the document to be focused, but
opening DevTools steals focus. Work around that by arming a one-shot
click listener that fires the read after you click back into the page.

1. Open Chrome, navigate to a `figma.com` design file.
2. Build the smallest reproducible test scene: one Frame with auto-layout
   (HORIZONTAL, padding ~16px, gap ~8px), containing one Rectangle (any
   solid fill) and one Text node where at least two characters use
   different colors.
3. Select the Frame, copy with `⌘C`.
4. Open DevTools (`⌥⌘I`), switch to Console.
5. Paste this snippet:

   ```js
   ;(async () => {
     await new Promise((resolve, reject) => {
       const handler = async () => {
         try {
           const items = await navigator.clipboard.read()
           const out = {}
           for (const item of items) {
             for (const t of item.types) {
               const buf = new Uint8Array(await (await item.getType(t)).arrayBuffer())
               out[t] = buf
               console.log(
                 t,
                 buf.length + " bytes",
                 "first 64:", Array.from(buf.slice(0, 64))
                   .map((b) => b.toString(16).padStart(2, "0")).join(" ")
               )
             }
           }
           window.__figmaPayload = out
           const figmaKeys = Object.keys(out).filter((k) => /figma|x-figma|vnd\.figma/i.test(k))
           if (figmaKeys.length === 0) figmaKeys.push(Object.keys(out)[0])
           for (const key of figmaKeys) {
             const a = document.createElement("a")
             a.href = URL.createObjectURL(new Blob([out[key]]))
             a.download = "figma-clipboard-" + key.replace(/[^\w]/g, "_") + ".bin"
             a.click()
             console.log("✓ downloaded", a.download)
           }
           resolve(out)
         } catch (e) { console.error(e); reject(e) }
       }
       document.addEventListener("click", handler, { once: true, capture: true })
       console.log("Listener armed → click anywhere on the Figma page (not DevTools).")
     })
   })()
   ```

6. Click anywhere on the Figma page. Console prints every clipboard MIME
   type with byte counts + first-64-bytes hex; the Figma-flavoured
   binaries auto-download.
7. Share the binaries. From them we can identify the magic header,
   message envelope, and start filling in field IDs.

## Tools we'll use

- **kiwi** — https://github.com/evanw/kiwi — the encoding format Figma uses. Has both a schema language (`.kiwi` files) and runtime libraries in JS, C++, Skew, etc.
- **protoc-gen-kiwi** equivalents — community tooling that round-trips between protobuf and kiwi.
- **Hex viewer** — for byte-level inspection during reconnaissance.

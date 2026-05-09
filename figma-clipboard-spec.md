# Figma clipboard format — spec

This document is the contract our writer (`extension/figma-clipboard-writer.js`) implements against. Phase 1 reconnaissance is done — every section below is grounded in real bytes captured from `figma.com` via the Replicode interceptor (`extension/figma-page-interceptor.js`) and decoded by `tools/decode-figma-clipboard.py`. The captured fixtures live in `figma breakdown/`.

## How Figma writes its clipboard

When the user copies a frame in Figma's web app, `navigator.clipboard.write` is called with three MIME types:

| MIME type | What it is | What we use it for |
|---|---|---|
| `text/plain` | The selection's text content concatenated as UTF-8 | Optional, ignored |
| `text/html` | A small HTML wrapper that **smuggles two base64-encoded blocks** in HTML comments — see below | **This is what we synthesise.** |
| `image/png` | A rasterised preview for non-Figma apps | Optional fallback |

Critically, Chrome's `navigator.clipboard.read()` only exposes those three standard MIME types to JavaScript (other than the page that wrote them). Figma does NOT use a custom MIME type like `application/x-figma-clipboard`. Instead, the binary scene graph is base64-encoded inside `text/html` so it survives any clipboard sanitization.

### The `text/html` envelope

Verbatim shape of the captured payload (with the base64 contents abbreviated):

```html
<meta charset="utf-8">
<div>
  <span data-metadata="<!--(figmeta)…base64…(/figmeta)-->"></span>
  <span data-buffer="<!--(figma)…base64…(/figma)-->"></span>
</div>
<span>
  <span style="font-size: 12px; white-space: pre-wrap;">a</span>
  <span style="font-size: 12px; white-space: pre-wrap;">b</span>
</span>
```

There are exactly two HTML-comment blocks we care about:

1. **`<!--(figmeta)…(/figmeta)-->`** — base64-decoded yields a tiny JSON metadata object:

   ```json
   {
     "fileKey": "s0f8nHeiYzvUfPOGqFZtx2",
     "pasteID": 352842067,
     "dataType": "scene",
     "environment": "www.figma.com",
     "selectedNodeData": "10:5|4|0"
   }
   ```

   The `pasteID` matches the `pasteID` field inside the binary scene's top-level `Message` (field id 12). Figma uses this to deduplicate paste actions. The `selectedNodeData` is `"<sessionID>:<localID>|<count>|<flags>"`.

2. **`<!--(figma)…(/figma)-->`** — base64-decoded yields the **kiwi binary container** described next. This is the editable scene graph.

The trailing `<span>` block is for paste-into-rich-text fallback (Notion, email, etc.).

### Kiwi binary container layout

After base64-decoding the `(figma)` block:

```
offset  size  field
──────  ────  ──────────────────────────────────────────────────────────
0       8     "fig-kiwi"   (ASCII magic)
8       1     0x6a ('j')   (clipboard-format flag)
9       3     00 00 00     (reserved)
12      4     uint32 LE    (length of compressed SCHEMA chunk)
16      N     bytes        (raw deflate of the kiwi schema)
16+N    4     uint32 LE    (length of compressed SCENE chunk)
20+N    M     bytes        (zstd of the scene Message)
```

Two different compression algorithms — schema is **raw deflate** (no zlib header), scene is **zstd** (magic `28 b5 2f fd`). Both confirmed across the captured sample.

### Kiwi schema chunk

The schema is a [kiwi](https://github.com/evanw/kiwi)-encoded list of definitions. Captured sample has **584 definitions**: 50 enums, ~440 messages, ~94 structs. Format per definition:

```
string(name)              null-terminated UTF-8
byte(kind)                0=ENUM, 1=STRUCT, 2=MESSAGE, 3=SMALL_ENUM
varuint(fieldCount)
fields[fieldCount]:
  string(name)            null-terminated UTF-8
  varint(type)            zig-zag signed; <0 = builtin, >=0 = def index
  byte(isArray)           bit 0 set if array
  varuint(value)          enum value OR message field id
```

**Builtins** (negative type values):

| code | type |
|---|---|
| -1 | bool |
| -2 | byte |
| -3 | int (varint) |
| -4 | uint (varuint) |
| -5 | float (4 bytes LE IEEE 754) |
| -6 | string (null-terminated UTF-8) |
| -7 | int64 (8 bytes LE) |
| -8 | uint64 (8 bytes LE) |

**Strings** in kiwi are null-terminated, NOT length-prefixed. Easy to get wrong.

**Messages** are encoded as repeated `(varuint field_id, value)` pairs, terminated by `varuint 0`. Field id 0 is reserved as the terminator.

**Structs** are concatenated fields with no IDs; the schema declares the order.

### Scene chunk: top-level `Message`

The scene is a kiwi `Message` (def id 428 in the schema). 45 fields in total. The ones we'll synthesise for paste:

| field id | name | type | what we set it to |
|---|---|---|---|
| 1 | `type` | MessageType (enum 0) | `1` = `NODE_CHANGES` |
| 2 | `sessionID` | uint | `0` |
| 3 | `ackID` | uint | `0` |
| 4 | `nodeChanges` | NodeChange[] | the actual scene graph (Document → Page → Frame → …) |
| 12 | `pasteID` | int | a unique 32-bit signed int (must match the figmeta JSON) |
| 14 | `pasteFileKey` | string | a placeholder file key (e.g. our extension's name) |
| 19 | `pasteIsPartiallyOutsideEnclosingFrame` | bool | `false` |
| 20 | `pastePageId` | GUID | the destination page's GUID (or zero — Figma resolves it on paste) |
| 21 | `isCut` | bool | `false` (we're "copying", not "cutting") |

Field `4 nodeChanges` is the scene graph itself. Each `NodeChange` (def id 229, **587 fields**) describes one node's full state. Captured paste contained the chain Document → Canvas → Frame → Text(`"ab"`).

### Scene-graph hierarchy

The captured paste delivers nodes in **document order with parent references**, not as a nested tree. Each node:

- Has its own `GUID` (field 1)
- Has a `parentIndex` (field 3) — a `ParentIndex` struct that points to its parent's GUID + position
- Has a `phase` (field 2) of `CREATED` (enum value 0)
- Has a `type` (field 4) — one of the 65 `NodeType` values (FRAME, RECTANGLE, TEXT, …)
- Has a `name` (field 5)
- Then type-specific fields (size, transform, fills, strokes, effects, text data, layout settings, …)

For paste, we need to emit a synthetic Document + Page wrapping the actual content, even if our captured Replicode component is just a single frame, because Figma needs the full ancestor chain.

## How we'll write a payload (writer plan)

1. Build the scene graph as a list of `NodeChange` records:
   - One synthetic `DOCUMENT` node (parent of nothing, GUID `00000000:00000000`).
   - One synthetic `CANVAS` node (parent = document, name "Page 1").
   - The actual Replicode-captured tree, with each frame/rect/text emitted as a `NodeChange` chained off the parent.
2. Wrap in a `Message` with `type=NODE_CHANGES`, `pasteID`, `pasteFileKey="replicode-extension"`, etc.
3. Encode the message with kiwi-message rules (varuint field ids + values, terminated by 0).
4. zstd-compress the scene bytes.
5. Concat: scene length (uint32 LE) + zstd bytes.
6. Read the cached schema chunk (raw-deflate-compressed, captured once and embedded as a binary blob in the writer).
7. Concat: schema length (uint32 LE) + schema bytes.
8. Prepend the 12-byte header: `"fig-kiwi" + 'j' + 0x00 0x00 0x00`.
9. Base64-encode and embed in `<!--(figma)…(/figma)-->`.
10. Build the figmeta JSON, base64-encode, embed in `<!--(figmeta)…(/figmeta)-->`.
11. Wrap both blocks in the same `<meta charset="utf-8"><div>…</div>` HTML envelope Figma uses.
12. `navigator.clipboard.write` a single `ClipboardItem` with `text/html` set to that string. Done.

The schema chunk is a fixed 30731-byte raw-deflate blob shipped as part of our writer — we never re-emit it from scratch. Periodically we re-capture from Figma to detect schema bumps.

## Key definitions to reuse from the schema

For the writer's first milestone (Frame + Rectangle + Text paste), only a small slice of `NodeChange`'s 587 fields matters. Captured field IDs (extracted by `tools/decode-figma-clipboard.py`):

```
NodeChange (def 229)
  [1]   guid: GUID
  [2]   phase: NodePhase           (CREATED = 0, REMOVED = 1)
  [3]   parentIndex: ParentIndex
  [4]   type: NodeType             (DOCUMENT, CANVAS, FRAME, RECTANGLE, TEXT, …)
  [5]   name: string
  [6]   transform: Matrix
  [8]   size: Vector
  [12]  fillPaints: Paint[]        (canonical name varies by Figma version)
  …587 total fields…

GUID (struct 50)
  [1] sessionID: uint
  [2] localID: uint

ParentIndex (struct 57)
  [1] guid: GUID
  [2] position: string             (LexoRank ordering string, e.g. "!")

Vector (struct 52)
  [1] x: float
  [2] y: float

Color (struct 51)
  [1] r: float (0..1)
  [2] g: float (0..1)
  [3] b: float (0..1)
  [4] a: float (0..1)

Paint (message 82)
  [1]  type: PaintType  (SOLID=0, GRADIENT_LINEAR=1, GRADIENT_RADIAL=2, …)
  [2]  color: Color     (when SOLID)
  [3]  visible: bool
  [4]  opacity: float
  [5]  blendMode: BlendMode
  …
```

The full per-message field list is in the captured `tools/figma-scene.schema.dump.txt` (writer reads this by name → builds an in-memory map → emits binary).

## How to capture another sample

Permanent infrastructure is in place — no ad-hoc scripts needed:

1. Open `chrome://extensions`, ensure Replicode is loaded with the latest manifest.
2. Open a Figma file in Chrome, open DevTools (`⌥⌘I`), in console:
   ```js
   localStorage.replicodeFigmaIntercept = "on"
   ```
3. Hard-reload (`⌘⇧R`). Console shows `[replicode] Figma clipboard interceptor armed.`.
4. Build the test scene (smallest reproducible: Frame with auto-layout containing Rectangle + Text with mixed colors).
5. Select the Frame, ⌘C.
6. The interceptor logs every MIME type Figma writes and auto-downloads:
   - `figma-write-text_html.bin` — the wrapper (decode with `tools/decode-figma-clipboard.py`)
   - `figma-write-text_plain.bin` — concatenated text
   - PNG fallback intentionally **not** downloaded
7. Run `./tools/decode-figma-clipboard.py figma-write-text_html.bin --out-dir <dir>` to extract the scene + schema.

Disable when done: `delete localStorage.replicodeFigmaIntercept`.

## Captured fixtures

`figma breakdown/` contains the first end-to-end capture:

| File | Origin | Size |
|---|---|---|
| `figma-clipboard-image_png.bin` | png fallback (the source frame's bitmap) | 102KB |
| `figma-write-text_html.bin` | the **complete `text/html` payload** Figma wrote | 43KB |
| `figma-write-text_plain.bin` | the concatenated text "ab" | 2 bytes |
| `figma-scene.kiwi.bin` | base64-decoded `(figma)` block (raw kiwi container) | 32KB |
| `figma-scene.schema.bin` | inflated schema chunk | 65KB |
| `figma-scene.scene.bin` | inflated scene chunk | 1.9KB |
| `schema-dump.txt` | human-readable dump of all 584 definitions + the 60 most relevant ones | ~2500 lines |

These fixtures power the writer's regression tests — generate a payload, decompress it the same way, structurally compare against the captured reference.

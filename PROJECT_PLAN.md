# UI Extractor Chrome Extension

## Objective

Build a Chrome extension that lets a user:

1. Enter inspect mode on any website or web app.
2. Hover and select a UI region or component.
3. Capture the DOM structure, visual styles, assets, and animations that make that region look and behave the way it does.
4. Generate paste-ready code that can be dropped into an editor and used as a starting point for replication.

The product is not a general-purpose "view source" tool. It is a focused "capture rendered UI and turn it into reusable code" tool.

## Reality Check

This is feasible, but only if the first versions optimize for:

- visual replication over semantic correctness
- exported components over perfect framework reconstruction
- HTML + CSS first, React second, Tailwind later
- "close enough and editable" over "identical to the original codebase"

The browser can tell you how something renders. It cannot tell you the author's original source structure, component boundaries, token system, or animation intent with perfect accuracy.

## Product Principles

- Fast to enter and exit inspect mode
- Safe by default: read-only, no DOM mutation to the target page
- Visual-first: prioritize what the user sees on screen
- Progressive extraction: basic structure first, interactions second
- Export code that is scoped, isolated, and portable
- Always show the user what was captured, what was inferred, and what could not be captured

## Recommended User Experience

### Primary flow

1. User clicks the extension icon or uses a shortcut.
2. Extension enters "Capture Mode".
3. The page gets a lightweight overlay and hovered elements are highlighted.
4. User clicks an element.
5. A side panel opens with a component preview and extraction options.
6. User chooses scope and output format.
7. Extension analyzes the selection.
8. Extension shows a review screen with:
   - preview
   - captured DOM tree
   - detected styles
   - detected animations
   - unresolved issues
9. User clicks `Copy` or `Export`.

### Mode structure

#### Mode 1: Select

- Hover highlight follows the cursor.
- Tooltip shows tag, size, and likely component root.
- `Esc` exits capture mode.
- `Alt` temporarily switches from child node to nearest useful container.

#### Mode 2: Review

Side panel sections:

- `Preview`
- `Structure`
- `Styles`
- `Animations`
- `Assets`
- `Output`

Key controls:

- Scope:
  - selected element only
  - selected element + descendants
  - nearest component root
  - custom depth
- States:
  - default
  - hover
  - focus
  - active
- Output:
  - HTML + CSS
  - React component + CSS module
  - React component + inline styles
  - JSON capture bundle
- Assets:
  - keep source URLs
  - inline small assets
- Animations:
  - include transitions
  - include keyframes
  - record live interactions

#### Mode 3: Export

Show three tabs:

- `Code`
- `Manifest`
- `Warnings`

The `Manifest` is important. It should list:

- fonts used
- image URLs used
- missing external assets
- inaccessible stylesheets
- unsupported behaviors

This prevents the tool from pretending it captured everything when it did not.

## Best UX Shape for Version 1

The cleanest v1 is:

- select one region
- export HTML + CSS
- capture default state and hover state
- capture transitions and readable keyframes when accessible
- show warnings for blocked or inferred values

Do not start with:

- full app extraction
- Tailwind generation
- framework-specific source reconstruction
- automatic conversion to production-grade React

Those are later layers.

## Core User Stories

### User story 1

As a designer/developer, I want to select a visually interesting UI block and copy code that reproduces its structure and appearance.

### User story 2

As a frontend engineer, I want hover and transition behavior captured so the exported result is not static.

### User story 3

As a user, I want to know what was captured exactly and what still needs manual cleanup.

### User story 4

As a developer, I want the exported code to be scoped so it does not clash with the site I paste it into.

## Functional Scope

### Must have

- element hover and selection
- visual overlay
- side panel review UI
- DOM subtree capture
- computed style extraction
- default-style filtering
- pseudo-element capture
- basic animation and transition capture
- copy/export code
- warning/report system

### Should have

- component root suggestion
- hover/focus/active capture
- asset manifest
- font manifest
- React output
- CSS module output

### Could have

- interaction recording
- Tailwind conversion
- AI cleanup pass
- Figma export
- multi-component batch capture

### Explicit non-goals for v1

- reconstructing original framework components
- reverse-engineering business logic
- extracting closed shadow DOM
- extracting cross-origin iframe content
- perfectly rebuilding inaccessible external stylesheets

## Technical Architecture

### Recommended stack

- Extension framework: Plasmo or a clean MV3 Vite setup
- UI: React + TypeScript
- Styling: CSS Modules or scoped CSS in the extension UI
- State: Zustand or simple local state
- Build target: Chrome Manifest V3

### Extension modules

#### 1. Content script

Responsibilities:

- inject overlay UI
- track hovered element
- lock selection
- walk DOM subtree
- read layout boxes
- read computed styles
- read pseudo-elements
- collect image and SVG references

#### 2. Page bridge script

Use an injected page-context script only when needed for:

- richer access to page-owned objects
- animation event observation
- inspecting open shadow roots or runtime state without content-script isolation issues

This should stay minimal.

#### 3. Background service worker

Responsibilities:

- receive raw capture payloads
- normalize and deduplicate styles
- assemble export bundles
- manage clipboard/export flows
- persist user preferences

#### 4. Side panel

Responsibilities:

- selection review
- scope selection
- output format selection
- warnings and manifest display
- code preview and copy/export actions

#### 5. Code generator

Responsibilities:

- build clean markup
- build scoped CSS
- generate animation blocks
- package assets manifest
- optionally generate React wrappers

## Data Pipeline

### Step 1: Select a root

On click, store:

- target element
- bounding rect
- DOM path
- suggested component root candidates

### Step 2: Capture structure

Build a normalized tree for the selected subtree:

- tag
- text nodes
- attributes worth keeping
- children
- box metrics
- pseudo-elements

Strip or rewrite:

- event handlers
- framework internals
- unstable IDs
- analytics and tracking attributes

### Step 3: Capture styles

For each node, collect:

- computed style
- before/after computed style
- inline style
- matched classes
- visibility and layout info

Then filter to intentional styles using:

- browser defaults for that tag
- inherited-value suppression
- omission of properties with no visual impact

### Step 4: Capture animations

For each node, collect:

- `transition-property`
- `transition-duration`
- `transition-timing-function`
- `transition-delay`
- `animation-name`
- `animation-duration`
- `animation-timing-function`
- `animation-iteration-count`
- `animation-delay`
- `transform`
- `opacity`
- `filter`

Then attempt to resolve:

- matching `@keyframes` from readable stylesheets
- hover state deltas
- focus and active state deltas

### Step 5: Capture assets

Collect:

- image URLs
- background-image URLs
- inline SVG markup
- font-family usage

Generate a manifest of external dependencies.

### Step 6: Generate output

Produce one export bundle:

- `component.html` or `Component.tsx`
- `styles.css` or `Component.module.css`
- `manifest.json`
- `warnings.md`

For copy-to-clipboard, also produce a single combined text payload.

## Animation Strategy

Animations are the hardest part after style extraction.

### What is actually capturable

- transitions declared on elements
- current computed transform/opacity/filter values
- keyframes from readable same-origin stylesheets
- hover/focus/active state differences

### What is only partially capturable

- JavaScript-driven animations
- GSAP or Framer Motion internals
- Web Animations API timelines without explicit serialization
- scroll-linked animations

### Recommended v1 approach

Support three animation modes:

1. `Static only`
2. `Capture CSS animations`
3. `Capture CSS + state deltas`

For `Capture CSS + state deltas`, the tool should:

- read base styles
- simulate hover where possible
- compare computed styles before and after
- generate CSS for `:hover`, `:focus`, or `:active` when meaningful

Later, add `Record interaction` mode:

- user starts recording
- hovers/clicks target
- extension listens to animation events and sampled computed values
- export approximated motion timeline

## Output Format Strategy

### Recommended export priority

#### Format 1: HTML + CSS

Best for v1 because:

- portable
- easy to validate
- editor-agnostic
- easiest to make visually faithful

#### Format 2: React + CSS Module

Best v2 format because:

- good for real projects
- scoped CSS keeps output safer
- JSX wrapper is easy once HTML exists

#### Format 3: JSON capture bundle

Useful internal format for:

- debugging
- AI cleanup
- future export formats

#### Format 4: Tailwind

Do not treat this as a primary early format. It is a lossy conversion layer, not the source of truth.

## Required Browser Permissions

Likely manifest permissions:

- `activeTab`
- `scripting`
- `storage`
- `sidePanel`

Optional:

- `clipboardWrite`
- `downloads`

Host permissions should stay minimal. Prefer using `activeTab` rather than broad site access for trust and install conversion.

## Main Engineering Challenges

### 1. Extracting meaningful styles instead of raw computed noise

This is the core product problem.

Needed solution:

- build a style filtering engine
- compare against default tag styles
- suppress inherited or unchanged properties
- keep layout, typography, paint, and animation properties with visible effect

### 2. Component boundary detection

A clicked node is often too small. A useful export is usually a card, modal, nav item, or section.

Needed solution:

- offer root suggestions based on:
  - repeated siblings
  - layout containers
  - size thresholds
  - semantic elements

### 3. Stylesheet access limitations

Cross-origin CSS rules may be unreadable through CSSOM.

Needed solution:

- fall back to computed values
- warn when original `@keyframes` are inaccessible
- generate skeleton placeholders where needed

### 4. Asset portability

The selected UI may depend on remote fonts and images.

Needed solution:

- manifest them explicitly
- inline only small safe assets
- never silently drop dependencies

### 5. JS-driven behavior

Not all motion comes from CSS.

Needed solution:

- clearly label JS-driven or unresolved behavior
- support recorded state diffs later

## Heuristics You Will Need

### Keep these properties aggressively

- layout: `display`, `position`, `top/right/bottom/left`, `z-index`, `flex-*`, `grid-*`, `gap`, `align-*`, `justify-*`, `width`, `height`, `min/max-*`, `margin`, `padding`
- paint: `background*`, `border*`, `box-shadow`, `opacity`, `filter`
- shape: `border-radius`, `outline`
- typography: `font*`, `line-height`, `letter-spacing`, `text-*`, `color`, `white-space`
- transform/motion: `transform*`, `transition*`, `animation*`, `will-change`

### Drop aggressively unless needed

- browser defaults with no visual effect
- inherited properties that do not change at the node
- irrelevant accessibility or editing properties
- internal framework attributes

### Attribute cleanup rules

Strip patterns like:

- `data-react*`
- `data-testid`
- `_ngcontent-*`
- `ng-*`
- `data-v-*`
- generated class hashes when exporting scoped CSS classes

## Suggested Internal Data Model

```ts
type CaptureNode = {
  id: string
  tag: string
  role?: string
  text?: string
  attributes: Record<string, string>
  rect: { x: number; y: number; width: number; height: number }
  styles: Record<string, string>
  pseudo: {
    before?: Record<string, string>
    after?: Record<string, string>
  }
  states?: {
    hover?: Record<string, string>
    focus?: Record<string, string>
    active?: Record<string, string>
  }
  assets?: {
    images: string[]
    backgrounds: string[]
    fonts: string[]
  }
  children: CaptureNode[]
}

type CaptureBundle = {
  url: string
  capturedAt: string
  root: CaptureNode
  animations: {
    keyframes: Array<{ name: string; cssText: string; source: "readable" | "inferred" }>
    transitions: Array<{ nodeId: string; props: Record<string, string> }>
  }
  warnings: string[]
}
```

## UX Details That Matter

### Show confidence, not just data

For each export, show:

- captured exactly
- inferred from computed styles
- unavailable due to browser restrictions

### Let the user refine the scope

The first click should not force the final export root. The side panel should let the user move up to parent containers quickly.

### Let the user compare states

If hover state changes exist, show a before/after preview and make that visible in the UI.

### Make the copy result trustworthy

The copy action should include:

- code
- inline comments for unresolved parts
- dependency manifest if needed

## Implementation Roadmap

### Phase 0: Product spike

Goal:

- validate that selection, computed style extraction, and code generation can work on a range of pages

Deliverables:

- minimal content script
- hover overlay
- click selection
- JSON dump of selected subtree

### Phase 1: Extraction core

Goal:

- produce a normalized capture bundle

Deliverables:

- DOM walker
- style collector
- pseudo-element collector
- default-style filter
- asset collector

### Phase 2: Animation capture

Goal:

- export meaningful motion information

Deliverables:

- transition collector
- readable keyframes collector
- hover state diff capture
- warnings for blocked animation sources

### Phase 3: Review UI

Goal:

- make the extraction understandable and controllable

Deliverables:

- side panel
- scope controls
- format controls
- preview
- warnings panel

### Phase 4: Export pipeline

Goal:

- generate useful code, not raw JSON

Deliverables:

- HTML + CSS generator
- React + CSS Module generator
- manifest generator
- clipboard/export action

### Phase 5: Quality pass

Goal:

- make results reliable enough for repeated use

Deliverables:

- test matrix across websites
- performance tuning
- class naming and scoping improvements
- asset handling improvements

## Suggested Milestones

### Milestone 1

"I can click an element and inspect the normalized capture payload."

### Milestone 2

"I can export a visually close HTML + CSS version of a selected card or section."

### Milestone 3

"Hover and transition behavior are included for common CSS interactions."

### Milestone 4

"I can export React + CSS Module code that is clean enough to edit."

## Project Structure Suggestion

```text
src/
  background/
    index.ts
  content/
    overlay.ts
    selector.ts
    capture-dom.ts
    capture-styles.ts
    capture-assets.ts
    capture-animations.ts
    heuristics.ts
  panel/
    App.tsx
    sections/
  generator/
    html-css.ts
    react-css-module.ts
    manifest.ts
  shared/
    types.ts
    messages.ts
    constants.ts
```

## Testing Strategy

Test against:

- static marketing sites
- dashboards using flex/grid
- component libraries
- sites with CSS transitions
- sites with CSS keyframes
- sites with JS-driven animations
- sites using open shadow DOM

Test dimensions:

- accuracy of layout
- accuracy of colors and typography
- animation presence
- output readability
- export portability
- performance on large DOM trees

## Success Criteria

The v1 is successful if a user can:

1. select a common UI block in under 5 seconds
2. export HTML + CSS in under 10 seconds
3. paste the result into an editor and get a visually similar component
4. understand what needs manual cleanup from the warnings/manifest

## Recommended Build Order

1. hover/select overlay
2. normalized DOM capture
3. style filtering engine
4. HTML + CSS generation
5. side panel review UI
6. transitions and hover-state capture
7. React export
8. interaction recording
9. AI cleanup layer

## Recommended First Deliverable

Do not start by trying to build the full product.

Start by proving this single workflow:

1. open any page
2. click one card or section
3. export HTML + CSS
4. preserve text, spacing, colors, border radius, shadows, images, and hover transition

If that works reliably, the rest is an extension of the same pipeline.

## What You Will Need to Build This

### Engineering

- Chrome extension shell
- DOM and CSS capture pipeline
- style diff/default filter engine
- code generator
- side panel review UI
- manifest/warnings system

### Product decisions

- definition of "component root"
- export formats supported
- asset handling policy
- warning language and confidence model

### Nice-to-have but optional

- AI cleanup service
- framework adapters
- saved capture history
- design token mapping

## Final Recommendation

Build this as a two-layer system:

Layer 1:

- deterministic browser capture engine
- normalized capture bundle

Layer 2:

- export adapters and optional AI cleanup

If you skip the deterministic capture layer and jump straight to AI-generated output, the product will be fragile and hard to trust.

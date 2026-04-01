# MVP Backlog

## Phase 0: Foundation

### Goal

Set up an extension shell and prove element selection works.

### Tasks

- initialize a Chrome extension project with TypeScript
- configure Manifest V3
- add content script injection
- add side panel shell
- add message passing between content script and background
- add a keyboard shortcut to toggle capture mode
- add a lightweight overlay system

### Exit criteria

- user can enter and exit capture mode
- hovered element is highlighted
- clicked element is sent to the side panel

## Phase 1: DOM Capture

### Goal

Capture a normalized subtree for the selected element.

### Tasks

- build DOM walker
- collect text nodes
- collect safe attributes
- strip framework internals and unstable IDs
- add root-scope controls
- add component-root suggestion heuristics

### Exit criteria

- side panel shows a stable tree for the selected subtree

## Phase 2: Style Capture

### Goal

Capture styles that matter visually.

### Tasks

- collect computed styles per node
- collect inline styles
- collect `::before` and `::after`
- build browser-default reference comparison
- drop inherited noise
- keep visually relevant properties

### Exit criteria

- exported style payload is materially smaller than raw computed styles
- visual output remains close to the source

## Phase 3: Animation Capture

### Goal

Capture common motion behavior.

### Tasks

- collect transition properties
- collect animation properties
- scan readable stylesheets for matching `@keyframes`
- capture hover state deltas
- add warnings for inaccessible animation sources

### Exit criteria

- common hover transitions export correctly
- readable CSS keyframes are included in output

## Phase 4: Export

### Goal

Turn capture bundles into useful code.

### Tasks

- generate HTML + CSS output
- generate scoped class names
- generate manifest of assets and fonts
- generate warnings file
- add single-click copy action
- add file export action

### Exit criteria

- copied output pastes cleanly into an editor
- result renders visually close in a local test page

## Phase 5: React Export

### Goal

Support a practical component format for real projects.

### Tasks

- transform HTML tree into JSX
- generate React component wrapper
- generate CSS Module file
- preserve scoped class names

### Exit criteria

- user can paste exported React code into a standard project with minimal edits

## Phase 6: Hardening

### Goal

Make the extension reliable across websites.

### Tasks

- add test matrix across different site types
- benchmark performance on deep DOM trees
- reduce capture latency
- improve asset handling
- improve root detection heuristics
- add telemetry or local debugging mode

### Exit criteria

- extension works reliably across a representative sample of sites

## Required Decisions

These should be fixed early:

- extension framework: Plasmo vs custom Vite MV3
- v1 output formats: HTML + CSS only, or also React
- asset policy: URL references vs inlining thresholds
- naming strategy: human-readable classes vs generated names
- capture scope defaults: nearest container vs clicked node

## Libraries Worth Considering

- `plasmo` for extension scaffolding
- `react` and `typescript` for panel UI
- `zustand` for panel state if needed
- `nanoid` for stable generated IDs
- `postcss` only if you later want CSS normalization or Tailwind export

Keep v1 dependencies low. Most of the hard work is browser-side logic, not package selection.

## Risks To Track

- CSSOM access blocked for cross-origin stylesheets
- iframes and closed shadow DOM not inspectable
- JS-driven animations not reproducible from CSS alone
- copied output may be visually right but structurally messy
- large DOM captures can hurt performance

## Definition of Done For MVP

- user selects a UI block
- extension shows preview and warnings
- extension exports HTML + CSS
- hover state is supported for common cases
- manifest lists required assets and fonts
- pasted output renders close to the source in a standalone page

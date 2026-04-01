# Replicode Figma Importer

This folder contains a local Figma plugin that imports the `Copy for Figma` payload produced by the Replicode Chrome extension.

## What it does

- accepts a pasted `replicode-figma-import` JSON payload
- creates editable Figma frames and text layers
- infers auto-layout for flex-like captures
- creates placeholders for captured images
- adds import notes for warnings and unsupported CSS details

## Load in Figma

1. Open Figma.
2. Go to `Plugins` -> `Development` -> `Import plugin from manifest...`
3. Select this file:

   `/Users/bharadwajapittu/Library/CloudStorage/OneDrive-bharath/Work/Code/Projects/Replicode/Replicode/figma-plugin/manifest.json`

## Use it

1. In the Chrome extension, capture a component.
2. Click `Copy for Figma` in the popup, or choose `Figma Import JSON` in the review panel and copy that output.
3. Run the `Replicode Figma Importer` plugin in Figma.
4. Paste the payload into the plugin UI.
5. Choose an import mode:
   - `Hybrid`: use geometry-first placement and only apply auto-layout where it looks reliable.
   - `Accurate`: favor captured bounds and absolute placement over editability.
   - `Editable`: use more auto-layout when the structure looks flex-like.
6. Click `Import to canvas`.

## Current limits

- remote images are imported as image fills when Figma can fetch the source URL, otherwise they fall back to editable placeholders
- pseudo-elements, complex gradients, and advanced filters are not recreated exactly
- layout is approximate for non-flex and heavily positioned DOM structures
- hover, focus, and active states are preserved as notes in the payload, not separate variants

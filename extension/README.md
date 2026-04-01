# Replicode - Code extractor

This folder is a loadable Chrome extension. There is no build step for the current MVP.

## What it does

- starts a capture mode on any HTTP or HTTPS page
- highlights hovered elements
- lets you click a component to capture its DOM subtree
- extracts filtered computed styles, assets, and animation metadata
- opens a side panel where you can:
  - adjust the capture root level
  - adjust capture depth
  - copy generated `HTML + CSS`
  - copy generated `React + CSS Module`
  - copy generated `Figma Import JSON`
  - copy the capture manifest
  - record hover, focus, and active states from the live page
  - inspect the raw JSON payload
- copies a `Copy for Figma` payload from the popup for use with the local importer plugin in `../figma-plugin`

## Load in Chrome

1. Open `chrome://extensions`.
2. Turn on `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder:

   `/Users/bharadwajapittu/Library/CloudStorage/OneDrive-bharath/Work/Code/Experiments/Code extractor - Codex (Chrome extension)/extension`

## Use it

1. Open a website.
2. Click the extension icon.
3. Click `Start capture`.
4. Hover a component and click it.
5. Review and copy the generated output from the side panel.

## Notes

- The current MVP focuses on `HTML + CSS`, `React + CSS Module`, and raw capture JSON.
- It can also export a Figma import payload for the local plugin in `../figma-plugin`.
- It captures CSS transitions and readable `@keyframes`.
- It can export `React + CSS Module` as a practical starting point for component work.
- It can record live hover, focus, and active state snapshots and include those in generated CSS selectors.
- Some animations cannot be reconstructed if they come from cross-origin stylesheets or JavaScript motion libraries.
- Very large selections are truncated to keep exports usable.

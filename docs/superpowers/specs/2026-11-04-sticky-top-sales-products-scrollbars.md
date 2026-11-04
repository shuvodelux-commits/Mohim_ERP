# Sales + Products: scrollbar above the pinned table heading

**Date:** 2026-11-04
**Visual reference:** User screenshot showing a turquoise horizontal scrollbar immediately above the sticky Sales column headings.

## Goal
When Sales or Products has horizontally overflowing columns, show a thin, clickable/drag-capable native horizontal scrollbar at the **top of the fixed column-heading overlay**, directly below the app topbar. Keep headers readable and keep vertical scrolling on the main page.

## Chosen design
- **Extend the existing pattern**: Sales already has `#smTopScroll` above the ordinary table; Products gets a matching inline scrollbar. In both modules, create a small *fixed* horizontal scrollbar alongside the cloned sticky heading, visible only when that header is pinned **and** columns overflow. Shift the cloned heading down by the scrollbar height.
- Keep the fixed scrollbar, ordinary top scrollbar, table body horizontal scroll, and cloned heading synchronized **in both directions**.
- Size both native scroll thumbs from the table scrollWidth/clientWidth; remeasure after rows load, page switching, resizing, and changes in rendered columns. Do not create hidden scrollbars or interfere with existing pinned Actions.
- At phone/card breakpoint, when the page is hidden, when the original heading is in view, or when columns fit, hide fixed scrollbar. The original native bottom/inline scrolling still works.
- A11y: meaningful `aria-label` and keyboard-focusable scrollbar. Respect print and phone card layout.

## Alternatives considered
1. **Chosen:** small native top scrollbars aligned with the cloned headings; preserve existing Sales code, add Products equivalent. No new library, minimal regression risk.
2. One global scrollbar reused for all tables — complicates page-specific sizing and interferes with existing bottom fixed app scrollbar.
3. Overlay decorative fake slider — rejected because it would not provide reliable native click/drag, keyboard, or touch scrolling.

## Scope
Modify only `sales.html`, `products.html`, `style.html` and corresponding tests. Do not change data, POS, money calculations, typography or Apps Script deployment. Use the PR #40 Products compact table branch as the base so the preview branch continues to contain the user-approved compact Products fixes.

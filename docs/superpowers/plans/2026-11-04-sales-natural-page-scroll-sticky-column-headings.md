# Sales invoice table: page scrolling and conditional sticky headings

## Screenshot acceptance
- Screenshot 1: Normal Sales table heading at annotation 1 scrolls with the page. After the tabs and filters scroll away, pin the heading immediately below the application top bar at annotation 2.
- Screenshot 2: Remove the height-limited vertically scrolling inner table viewport and its permanent bottom cutoff. Use one continuous content scrollbar.
- Keep compact filters, normal row separators, horizontally pinned right-side three-dot Actions and horizontal table scroll.
- Do not pin Sales tabs/filters, nor add a fixed bottom viewport.
- Preserve customer modal and financial logic unchanged.

## Technical rationale
- Horizontal overflow-x:auto creates a sticky containing block. Without a nested vertical viewport native table th positioning cannot stick to the outer content scroller.
- Use a conditional aria-hidden mirror of table header after original header scrolls out. Mirror aligns actual columns, horizontal offset and rightmost Actions; strips duplicate IDs.
- Hide mirror for other routes, phone cards and print. Body row callbacks remain attached only to original table.

## Verification
- Added tests/sales_natural_scroll_pinned_header.test.js.
- Updated browser checks for full content scrolling, conditional pinned header geometry, horizontal alignment, mobile cards and modal route.
- Local Node: 630/630 passed. Local mocked Chromium: 60/60 passed, 28 routes.
- GitHub CI and test Apps Script rollout only; no main merge, no production deployment.

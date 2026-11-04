# Mohim ERP Sales & Products table visual parity

Date: 2026-11-04. Reference: the already-approved Sales table and the user's screenshot of the Products table.

## Goal
**Sales is the visual standard.** Products should match Sales in heading font/weight/color, header spacing and pinned-clone appearance, table text size/weight/line-height, cell padding, three-dot trigger size, and every action menu's iconography, typography, spacing, keyboard behavior, and mobile presentation. Columns, names, stock/unit data, and permitted operations remain module-specific.

## Known implementation
- Both modules use `erp-action-table`, `rowActionTriggerHtml_`, horizontal scrolling, sticky Actions and cloned headers.
- Sales uses shared `openRowActionMenu_` and `rowActionMenuIcon_` for labeled icon actions and keyboard support; Products has an older independent text-only `#prodActionMenu` and differing menu behavior.
- Sales uses **9px 12px heading padding**, **8px 12px cell padding**, **14px body and 12px header**, normal-weight body text, and 1.35 cell line-height. Products overrides to **7px 8px**, **12px tablet text**, bold product name/amounts, and a different cloned-heading padding.
- PR #42 already adds synchronized top horizontal scrollbars in both modules and must remain intact.

## Chosen approach
Use Sales's shared actions menu for Products, forwarding all original Products operations through the existing product handlers, and share narrowly scoped CSS declarations so both modules inherit the same Sales table metrics. No new action menu or duplication. Add trusted `stock` and `lots` icons to the common icon lookup.

## Alternatives considered
- Restyle the old Products popover separately: rejected because keyboard behavior and icons would diverge again.
- Full table renderer rewrite: rejected due sort/filter/scroll/regression risk.
- Common component: use the already-existing shared icon Actions helper and CSS; no heavy refactor.

## Behavioral guarantees
- Product first column only product name, one line and ellipsis for long names on tablet; stock still `80 pcs`, bundles `8 sets`; no extra unit or brand subline.
- Product actions: Edit, Adjust Stock, View Lots (non-bundle only), Activate/Deactivate as appropriate, Delete. Each menu button gets a visible left SVG; Delete is red. Product bundle actions omit stock and lots, unchanged.
- Same menu positioning, focus, arrows, Escape restoring focus, disabled state conventions and mobile bottom-sheet behavior as Sales.
- Heading sorting remains clickable in Products, including its pinned mirror.
- No data/backend/API, finance, pricing, role validation, sync or Apps Script deployment changes.

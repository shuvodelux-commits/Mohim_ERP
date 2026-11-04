# Products table compact stock-and-unit design
Date: 2026-11-04. User-approved screenshot reference and follow-up.

## Intent
Improve readability of Mohim ERP Products inventory without changing purchase, stock, pricing, database, filtering, sorting, or product actions.

## Decisions
- Product name primary; brand only, when present, secondary. Do not repeat the product unit beneath its name.
- Keep Category; put Stock before Purchase and Selling. Do not add an independent Unit column.
- Stock displays quantity and that product's existing unit inline; minimum stock appears in a subdued second line. Low and out-of-stock values are emphasized.
- Selling price displays per-unit suffix `/Pcs`, `/Kg`, etc., based on the existing product Unit. Purchase and Stock Value still use existing formatters.
- Product Status badge differentiates active in-stock, low-stock, out-of-stock, and inactive; Bundles preserve their computed available sets and active/inactive semantics.
- Normalize simple display unit abbreviations (e.g., pc -> Pcs) without modifying stored unit data. Do not invent multi-unit conversions, since this product listing only has a single Unit field.
- Use scoped compact CSS for desktop/tablet; retain existing mobile card table, search, ordering, pinned header sync, actions, and scroll.
- No new dependencies, backend changes, or production deploy.

## Considered approaches
1. Minimal modification to existing Products renderer and scoped styles (**chosen**) — preserves mature behavior and smallest regression surface.
2. Rebuild table as a new component — higher complexity and risk of losing action/sort/scroll behavior.
3. Introduce multi-unit stock conversion — outside the existing data model and this UI-only approval.

## Acceptance
Correct columns/order, secondary text, low-stock/minimum messaging and unit-aware Selling label; no regression to sorting, toolbar, mobile cards, sticky cloned heading or Actions.

# Sticky left row actions — implementation plan (2026-11-04)

## Basis and intent
Reference: `shuvodelux-commits/hisabiq_ui` `src/pages/AuditLedger.tsx` and `docs/ui-refine/audit-ledger/README.md`: 36px three-dot button, viewport-pinned action cell, icon-first menu, destructive divider, keyboard/touch. HisabIQ pins on the **right**; Mohim ERP user explicitly wants **left** so the row action is visible while horizontally scrolling a tablet.

## Approach and tradeoffs
- **Chosen:** Move the action cell into the first column of high-value Sales List, Customer Ledger, Supplier Ledger and Daybook, with a shared `.erp-sticky-action-col` CSS class `position:sticky;left:0`. Native table keeps semantic headings/columns aligned, horizontal and vertical scrolling preserved. Card layout overrides restore invoice/date prominence and position action at the bottom on phones. Popup remains body-level and unclipped.
- Rejected: duplicate fixed action overlay (risks row misalignment, click mismatch, accessibility); sticky right (contradicts explicit left requirement); rebuilding all tables (unnecessary scope/risk).
- Source icon-first ActionMenu behavior is translated into the existing Mohim `openRowActionMenu_` DOM component (fixed-position menu), not copied as React code.

## Contract
1. On tablet/desktop, horizontal scrolling does not move the 36px three-dot Actions trigger or its header out of sight. Each action is still attached to its original row.
2. The trigger has a meaningful accessible name and keyboard activation; no `Actions ▼` text.
3. Menu items have recognisable SVG icons, labels and existing permissions, optional disabled explanation, and divider/destructive red treatment; Escape returns focus to the trigger. No new financial actions or changed RPCs.
4. On phone, existing `.mobile-card-table` cards keep invoice/date as the first prominent content and show the action control inside each card. Printed tables should not use sticky presentation.
5. Use the global menu primitive for all existing action-menu consumers; keep other modules' triggers and callbacks unchanged. Daybook uses View/Delete through the same menu, retaining its delete visibility check.

## TDD and verification
1. Write `tests/sticky_left_actions.test.js`, demonstrate red against old sources.
2. Change CSS, shared action-menu icon renderer and relevant four tables; run focused and full Node regression suite.
3. Add Chromium browser assertions to existing mocked browser gate for tablet horizontal scrolling, sticky first header/row action, menu icons and action dispatch. Run CI; fix only regressions.
4. Open PR for review; do not merge or deploy to production without approval. Test deployment uses verified test Apps Script only if needed.

## Risk controls
- Existing global menu callbacks, permission filters and delete confirmation untouched.
- Never modify backend, Sheets data, transaction posting or feature flags.
- Existing `main` starts at `33b7dc30c2b350291c2d900d887f671bd8a4be14`.

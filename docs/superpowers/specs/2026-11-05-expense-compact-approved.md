# Mohim Expense V1-approved Compact Implementation — 2026-11-05

User approved the standalone HTML prototype `Mohim_Expense_Module_Design_Prototype.html`, with the explicit revision: **make expense summary cards more compact**. Prototype is a design reference, not a production data source.

## Screens and preserved workflows
- Use the ERP's single native underlined sub-navigation, ordered Overview, New Expense, History, Categories, Payees. Payees is a dedicated compact fifth page and uses the existing authorized Payee read/write RPCs; retain the legacy Manage Payees modal for compatibility.
- Overview retains fixed **Today**, **This Month** and independently selected **Period** totals, with small in-card category breakdowns for Today/Month and entry counts.
- Date presets: Today, This Month, Last Month, Custom. Date changes must update Selected Period only; Today/Month never change with selected range.
- Selected Period maintains authoritative `getExpenseLedger(token,{dateFrom,dateTo})` total and reconciliation. Today/Month also use existing authenticated ledger read (month-to-date; Today as a subset).
- Details table shows newest 25 and opens existing Expense History with applied date filter. Preserve category/payee/payment breakdowns; add a compact daily spending visual.
- All summaries exclude cancelled amounts and rows. Never change expense posting, bank/cash ledger writes, permissions, or report server shape.
- New Expense preserves quick category/payee creation, Manage Payees, bank account, backdating reason, confirmation, validation and notes.
- History preserves all filters, export, print, edit/view/delete and running totals; Categories preserves add/edit/activate/deactivate.
- Compact: desktop three summary cards with approximately 10–12px padding, numeric ~22–24px, 2px accents, concise labels; smaller panels/tables, 36px fields, sharp 6px radius, readable Bangla hints. Responsive: tablet collapse to two columns, mobile stack summary cards and show compact rows; no horizontal overflow.
- Use existing ERP blue typography and design tokens. No monospace fonts or sample data in production.
- PR only; no merge or production deploy until user asks.

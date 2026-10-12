# ERP-wide Semantic Balance Card Audit

Repository: `shuvodelux-commits/Mohim_ERP`. This audit reviewed the **34 HTML UI files** from the current GitHub `main` tree before editing.

## Implemented

The shared `ERP_SEMANTIC_CARDS_`, `ERP_SEMANTIC_DETAILS_`, and `ERP_SEMANTIC_INLINE_` maps live in `javascript.html`; theme-aware CSS resides in `style.html`.

- **53 summary/financial cards:** dashboard, business finance, bank ledger, day book, cash reconciliation, expenses, sales/purchase/stock/cash/profit reports
- **4 financial detail panels:** customer due, supplier due, vendor payable, vendor receivable
- **18 compact financial values:** POS, counter, return customer due, and balance sheet positions
- **75 explicitly mapped displays**; zero/unset values remain neutral; changed text updates automatically without changing module calculations.
- Existing Finance Ledger and Customer/Supplier Ledger styles are **retained rather than doubled**. They already implement their own balance/cash-direction treatment.

## Semantic rules

| Economic meaning | Tone | Examples |
| --- | --- | --- |
| Collection / available customer credit / asset availability / profit | Green | Customer credit, collected, borrower receivable, profit |
| Customer Due / Sales Due | Red | Customer outstanding due, unpaid sales |
| Positive payable / expense / cost / cash out | Red | Supplier payable, outstanding loan, expenses, cash out |
| Signed net balance / margin | Green when positive, red when negative | Cash closing, profit, margin, daybook net |
| Operational issue when nonzero | Red | Low stock, out of stock, reconciliation needs review |
| Zero, missing, informational count/valuation | Neutral | Entries, invoices, stock value, opening snapshot |

**Accounting caution:** Sales/purchases are not assumed to be real-time cash movement. An unpaid purchase must never be annotated `Money Out`. `Money In/Out` labels are reserved for actual cash movement totals. Credit/advance values in customer and supplier details use their established business meaning, including the word `Credit` when shown.

## Modules intentionally not tinted

- Administrative pages (login, roles, users, settings, invoice design) have no semantic monetary summary cards.
- Product master, purchase entry, sales management, returns history, draft sales and vendor intake forms contain informational/workflow fields rather than standalone semantic balance cards; table/form structures remain unchanged.
- Bank opening balance, inventory valuation, and generic totals/counts stay neutral because red/green would be ambiguous.
- Customer/Supplier Ledger summary cards, Finance Ledger summary cards, and vendor list balance badges already use approved semantic styles; not overwritten.

## Boundaries / regression safety

- No changes to Google Apps Script backend, sheets, business logic, finance posting, ledger debit/credit direction, stock, invoice/print templates, or role permissions.
- One observer per *existing* mapped display ID; observes only changes to its numeric text, not the whole document.
- Uses only existing `--color-success`, `--color-danger`, and other theme CSS variables.
- Repeated initialization is protected by `data-erp-semantic-bound`.
- Existing cards retain exact IDs and module-specific render functions. Print CSS removes decorative captions and backgrounds.
- Browser visual inspection (light/dark, mobile/tablet, live Apps Script data) remains required; static tests cannot replace it.

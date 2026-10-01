# SherERP Multi-Invoice Sales Return V2 — Final Review

Date: 2026-09-21
GitHub side effects: **None. No push, PR, merge, or remote repository modification was performed.**

## V2 changes requested by user

### Customer-first multi-invoice selection

The Return page now has two separate entry modes:

1. **Find Invoice** — existing fast path for a normal single-invoice return.
2. **Find Customer** — dedicated multi-invoice path:
   - search Customer ID, customer name, or phone;
   - click **View Invoices**;
   - view that exact customer's invoices in a Sales-style list;
   - select one or more invoices;
   - one selected invoice opens the normal single-return cart;
   - two or more selected invoices open the accounting-safe batch return cart.

The customer-first list shows Invoice, Date, Total, Paid, Due, Payment Status and Return Status. Duplicate invoice IDs and fully returned invoices cannot be batch-selected.

### Editable Return Price

Return Price is editable per line in both single and batch return carts.

Accounting controls:

- default price is the source invoice's effective post-discount sale price;
- requested price must be finite and >= 0;
- requested price cannot exceed that invoice's effective post-discount sale price;
- prior-return economic limits still cap the final line total;
- missing price from an older/stale browser defaults to the original effective price;
- cash-refund eligibility uses the edited validated return amount per invoice;
- Store Credit uses the edited validated amount and still settles through child Return ID -> source Invoice ID;
- original Sales invoice rows are never rewritten.

## New permission-gated return RPCs

- `searchCustomersForReturn(token, query)`
- `getCustomerInvoicesForReturn(token, customerId)`

Both require `returns:view`.

## Production files changed by this V2 revision

- `SalesReturn.gs`
- `returns.html`
- `PROJECT.md`

The earlier multi-invoice implementation files `Config.gs`, `StockLots.gs`, and `returnHistory.html` remain unchanged from V1 and are included in the cumulative package.

## Tests changed by V2

- `tests/multi_invoice_sales_return_regressions.test.js`
- `tests/deep_review_regressions.test.js`

## Fresh final verification

The following 19 selected suites all exited 0 after the final V2 changes:

- `node tests/multi_invoice_sales_return_regressions.test.js` — **26/26**
- `node tests/audit_sales_stock.test.js` — **25/25**
- `node tests/deep_review_regressions.test.js` — **34/34**
- `node tests/customer_settlement_business_logic.test.js` — **16/16**
- `node tests/reports_business_logic.test.js` — **11/11**
- `node tests/return_ledger_regressions.test.js` — **8/8**
- `node tests/confirmation_sales_purchase_returns.test.js` — **2/2**
- `node tests/mobile_customer_return_regressions.test.js` — **4/4**
- `node tests/public_rpc_security.test.js` — PASS, **191 published functions audited**
- `node tests/production_gate_static.test.js` — PASS, **44 GS / 32 HTML / 535 server functions**
- `node tests/crud_business_rule_matrix.test.js` — PASS, **43 critical mutation paths**
- `node tests/accounting_state_drift_read_paths.test.js` — PASS
- `node tests/state_drift_accounting_invariants.test.js` — PASS
- `node tests/state_drift_sequence_fuzz.test.js` — PASS
- `node tests/audit_financial_crud.test.js` — **34/34**
- `node tests/finance_multibalance_business_logic.test.js` — PASS
- `node tests/confirmation_vendor_finance_inventory.test.js` — PASS
- `node tests/invoice_integrity_regressions.test.js` — PASS
- `node tests/dashboard_business_logic.test.js` — PASS

The JavaScript blocks in `returns.html` and `returnHistory.html` were also parsed directly with Node's JavaScript parser without syntax errors.

## Deployment note

If V1 has already been installed, the incremental V2 patch is enough.

If V1 has not been installed yet, use the cumulative V2 package. The V1 deployment requirement still applies: run `setupSystem_()` once and `repairSaleItemLotSupplierIds_()` once on a backup/test Sheet before production rollout.
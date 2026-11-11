# Flexible Batch Sales Returns — Approved Design

Date: 2026-11-11. Status: approved in chat; TDD required.

## User-visible intent
- Operator may open 1–20 invoices for one customer, enter return quantities on any subset, and submit one action. Unused/open invoice groups with zero quantities must never veto a valid return or create empty child Return IDs.
- Returning items from just one of several opened invoices must work through the native single-invoice return handler; two or more contributing invoices continue to use the native batch handler.
- A source invoice's Paid/Due status must never block selecting **Cash** or **Store Credit**. On a fully unpaid invoice, a Cash refund posts an actual Cash Book outgoing amount but **does not** automatically change the customer's recorded due; Store Credit continues to reduce current due / create credit under the existing settlement rules.
- Preserve existing UI layout, return price/quantity controls and confirmation flow.

## Preserve safeguards
- Enforce original invoice/product and quantity bounds, prior returned quantity, return price ceiling, stock/FIFO/bundle restoration, same-customer batch identity, duplicate IDs, valid transaction date, permission, cash-session policy, audit trails, and pre-write validation.
- Preserve one Sales Return child record per *contributing* invoice and unique Return ID; batch group ID remains metadata. One contributing invoice uses existing `completeReturn`.
- Newer split-payment invoice return journal/idempotency safeguards must not be silently removed. Multi-invoice split-payment support needs journal-aware design, rather than removing a guard untested.
- No production deployment or merge without separate authorization.

## Implementation choices
- Frontend: derive participating invoices from positive return qty and use those same invoices for total, date validation and submission; if just one, dispatch to existing `completeReturn` with operationId.
- Backend: maintain return provenance for informational reporting, but no longer impose cash-collected as a refund ceiling. Cash refund does not write CUSTOMER_LEDGER or mutate CUSTOMERS due. Store Credit path unchanged.
- Correction/edit path: allow cash method even when collected cash is zero, retaining correction journal and evidence checks.
- Tests: red/green checks for zero groups, 1 and 2 participant flows, full-due Cash and Store Credit, cash balance/due, invalid qty, backdating and edit behavior.

# Clean Customer/Supplier Ledger Design

## Goal
Present customer- and supplier-facing ledgers as clean business statements that show only economically meaningful transactions, while preserving all raw correction/edit/reversal rows in Google Sheets for audit and allowing privileged users to inspect them on screen.

## Accounting Rule
Raw ledger rows remain authoritative audit history and are never deleted or rewritten by this feature. The UI receives one of two read projections:

- **Clean view (default):** collapse internal correction chains into the current economic transaction for each sale/purchase reference; omit net-zero corrected-away transactions.
- **Corrections view (privileged):** show the existing raw active ledger rows exactly as stored.

Printing and statement generation always use clean view regardless of the interactive toggle.

## Visible business transactions
Keep genuine external/economic rows visible, including:
- Sale / Purchase
- Payment
- Opening Balance
- Sales Return Credit / Purchase Return Credit
- Advance Refund / customer credit refund
- Settlement discounts that are embedded in payment rows

## Internal rows hidden in clean view
- Sale Update Credit
- Sale Update Debit
- Purchase Update

Any future internal correction type must be explicitly classified before it is hidden; unknown types remain visible by default.

## Projection semantics
### Customer sales
Group active rows for the same party and invoice reference where Type is `Sale`, `Sale Update Credit`, or `Sale Update Debit`. Sum `Debit - Credit` across the group.

- Net > 0: emit one synthetic `Sale` row with Debit = net.
- Net = 0: emit no business row for that invoice on this party.
- Net < 0: fail closed by keeping the raw rows visible in clean view because a negative sale obligation indicates a data anomaly requiring investigation.

The synthetic row uses the current SALES record's business Date when available; otherwise it uses the most recent correction-chain business date. Its reference is the invoice ID and its source actions route to the existing Sales module.

### Supplier purchases
Group active rows for the same party and purchase reference where Type is `Purchase` or `Purchase Update`. Sum `Debit - Credit` across the group.

- Net > 0: emit one synthetic `Purchase` row with Debit = net.
- Net = 0: emit no business row for that purchase on this supplier.
- Net < 0: fail closed by keeping the raw rows visible in clean view.

The synthetic row uses the current PURCHASES record's business Date when available; otherwise it uses the most recent correction-chain business date. Its source actions route to the existing Purchase module.

### Running balance
After projection, sort clean rows chronologically and recompute running Balance from the clean Debit/Credit values. Clean closing balance must equal the raw ledger closing balance for the same party. If it does not, the server throws an integrity error rather than printing or displaying a misleading statement.

## Dates and pagination
Projection happens before pagination. Cursor pagination is based on the projected clean rows so page boundaries cannot split a correction chain. Synthetic rows receive deterministic stable keys derived from business date, source reference, and the latest raw row index in the chain.

## Privileged correction view
The server exposes raw correction history only to roles named `Administrator`, `Owner`, or `Manager` (case-insensitive). The bootstrap response includes `canViewCorrections` so the UI can hide the control for other roles. The server independently rejects unauthorized raw-view requests.

The on-screen toggle label is `Show corrections`. Default is OFF on every page load and every party change.

## Printing
`getCustomerLedgerStatement` and `getSupplierLedgerStatement` always use clean projection. There is no raw/corrections statement option. This prevents accidental printing of internal accounting corrections to customers or suppliers.

Statement opening balance is calculated from clean projected rows before the requested From Date; period debit/credit/closing are calculated from clean rows within the requested period.

## Files
- `PartyLedger.gs`: projection, privilege gate, clean/raw page mode, clean-only statements.
- `customerLedger.html`: privileged toggle and clean/raw page requests.
- `supplierLedger.html`: same behavior for suppliers.
- `style.html`: compact toggle styling if needed.
- `tests/party_ledger_clean_view.test.js`: executable projection/business invariants.
- `tests/party_ledger_ui.test.js`: UI contract for toggle and clean-only printing.
- `confirmation_spec_matrix.test.js` and `tests/confirmation_spec_matrix.test.js`: update PartyLedger hash only if required by the existing production integrity test.

## Non-goals
- Do not mutate CUSTOMER_LEDGER or SUPPLIER_LEDGER.
- Do not change settlement/accounting writers.
- Do not hide real payments or real returns.
- Do not change Customer Current Due or Supplier Current Due.
- Do not add a new permission-schema column or database migration.

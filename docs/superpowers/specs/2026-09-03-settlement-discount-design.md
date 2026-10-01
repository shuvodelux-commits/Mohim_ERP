# SherERP Settlement Discount Design

**Date:** 2026-09-03
**Status:** Approved
**Runtime:** Google Apps Script
**Database:** Google Sheets

## Goal
Add negotiated settlement discounts to Customer Receivable collection and Supplier Payable payment without misstating Cash/Bank, Day Book, profit, or audit history.

## Customer settlement
Example: customer due 25,000, receive 24,000, discount 1,000. Customer receivable reduces by 25,000, Cash/Bank increases by 24,000, and 1,000 is a Customer Settlement Discount Given that reduces profit.

## Supplier settlement
Example: supplier payable 30,000, pay 28,000, discount received 2,000. Supplier payable reduces by 30,000, Cash/Bank decreases by 28,000, and 2,000 is Supplier Settlement Discount Received that increases profit.

## Ledger model
Keep one source Payment row. Add additive columns to CUSTOMER_LEDGER and SUPPLIER_LEDGER:
- Payment Amount
- Discount Amount
- Discount Reason

For new discounted settlements:
- Credit = Payment Amount + Discount Amount
- Payment Amount = actual Cash/Bank movement
- Discount Amount = negotiated non-cash settlement adjustment
- Balance = prior balance - Credit

Legacy Payment rows with blank Payment Amount remain compatible: actual payment is treated as Credit and Discount Amount as zero.

## Validation
- Actual Payment Amount must remain > 0.
- Discount defaults to 0 and cannot be negative.
- If Discount > 0, current due/payable must be positive.
- If Discount > 0, Payment + Discount cannot exceed the positive current due/payable, so discount cannot create an advance.
- Existing overpayment/advance behavior remains unchanged when Discount = 0.
- Discount Reason is mandatory when Discount > 0.
- Discount > 0 requires module Edit permission plus special Settlement Discount permission. Administrator remains unrestricted under the existing permission model.

## UI
Customer detail payment area adds Discount Given, Discount Reason, Total Settled, Balance After, and Settle Full Balance. Supplier mirrors this with Discount Received. The special fields are disabled for users without Settlement Discount permission. Live calculation uses the current displayed balance.

Payment Edit modals also expose Discount and Discount Reason so audited correction can change both components.

## Accounting/report behavior
- Cash Book and Bank Book use Payment Amount only.
- Day Book uses Payment Amount only and may mention the discount in the description.
- Customer/Supplier ledger Credit and running balance use Payment + Discount.
- Profit report adds Customer Settlement Discount Given as a profit reduction and Supplier Settlement Discount Received as a profit increase.
- Original sales, purchases, FIFO stock lots, COGS, and purchase costs are not rewritten.

## Correction/cancellation
The existing Correction Engine remains authoritative. Customer/Supplier Payment adapters expose paymentAmount, discountAmount, discountReason, and date/method/account/notes. Correction changes party balance by the delta in total settled while Cash/Bank correction effects use the delta in actual payment only. Cancellation restores the full settled amount to receivable/payable but reverses only the actual payment from Cash/Bank. Revision history retains the before/after fields.

## Performance
No new sheet is introduced. Discount reporting reuses the bounded active payment rows already stored in the two party ledgers and the existing short profit cache. No full-ledger rewrite is added.

## Compatibility
All schema changes are additive. Existing rows read as Payment Amount = Credit and Discount Amount = 0. Run setupSystem_() after deployment so live sheets receive the new columns.

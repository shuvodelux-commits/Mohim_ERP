# Net Stock Vendor Shortage Fix Report

Date: 2026-09-09

## Production bug
When positive STOCK_LOTS exceeded Products.Current Stock because unresolved OVERSOLD debt was offset by later positive return lots, vendor-sourced sales used the positive-lot sum as availability. POS correctly used net Current Stock, so a draft line could show a vendor shortage while completeSale/updateSale rejected it with "there is no shortage on this line to source from a vendor."

Example reproduced:
- Products.Current Stock = 1
- Positive lots = +3
- Existing OVERSOLD lot = -2
- Net stock = 1
- Sale qty = 3
- Correct own stock = 1
- Correct vendor shortage = 2

## Fix
Added planSaleVendorConsumption_ in StockLots.gs. It caps shop-owned FIFO consumption at the product's net Current Stock and leaves the remainder as the vendor shortage. The generic planStockConsumption_ is unchanged.

Only vendor-sourced paths use the new planner:
- Sales.gs completeSale vendor shortage planning
- SalesManagement.gs additional stock need when an invoice edit requests vendor sourcing

Negative-stock sales, Vendor↔Negative same-quantity reconciliation, Sales Return, delete/reversal, purchase return, and generic stock-lot planning stay on their existing paths.

## Production files changed from previous audited build
- StockLots.gs
- Sales.gs
- SalesManagement.gs

## Verification
- Focused sourcing/draft/return/vendor suite: 33/33 PASS
- Full Node suite: 176/185 PASS; same 9 pre-existing UI/responsive acceptance failures
- POS/Sale browser probe: 11/11 PASS
- Purchase browser probe: 7/7 PASS
- Customer/Supplier/Expense browser probe: 12/12 PASS
- Returns browser probe: 7/7 PASS
- Bank/Finance browser probe: 7/7 PASS

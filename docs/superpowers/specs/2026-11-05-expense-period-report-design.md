# Expense Period Report: Design

## Intent
Make the selected From–To period the unambiguous center of Expenses → Report, so shop staff can trust the displayed total and investigate its source entries.

## Agreed scope
- Selected date range defaults to first day of current month through today; changing a date refreshes report, while Run Report explicitly refreshes.
- Use existing read-only getExpenseLedger(token, {dateFrom, dateTo}) and its filteredTotal as accounting authority. Keep cancelled expenses out of totals/insights. Do not change expense writes, balances, deletion, or ledger semantics.
- Period-centric KPIs: total, active entry count, daily calendar-day average, largest single expense. Always label the applied range.
- Compact bilingual headings; category and payee breakdowns, payment methods, daily grouped totals, and 25 newest detailed expense entries with View Full History carrying dates into Expense History.
- Category share %, counts and source amounts; a clear empty state, invalid-range errors, errors on read failure, and no stale KPI after inputs change or requests race.
- Follow current Apps Script/Google Sheets architecture, ERP styles, keyboard/touch and escaped user strings.

## Non-goals
No editing transactions here, no new ledger, no database schema change, no print/export redesign, no live Apps Script deploy until PR review.

## Approaches considered
1. Keep client-side getExpenseList totals: smallest diff but maintains duplicate accounting logic and stale report risk.
2. **Use existing server-side getExpenseLedger**: authoritative period total and filtered rows, shared with Expense History, no new API. Chosen.
3. New dedicated report RPC: faster for high volume but duplicates ledger filtering and is unnecessary now.

## Calculation contracts
- Date range inclusive; empty bounds represent all dates or an open-ended bound.
- Server filteredTotal is the published total. Sum of active returned rows must reconcile to within 0.01 or fail closed with a visible message.
- Period Entries counts active expense rows; daily averages divide by inclusive calendar days in the applied span, never expense-active days.
- Largest expense = maximum active amount; category shares = category sum / total, 0 when total is zero.
- Recent details (25) are illustrative subset; totals always use the entire filtered period.
- Latest date request wins, including invalid range and server errors.

# WhatsApp Phase 1 — operator guide and release checklist

Status: **Draft PR / deployed to isolated TEST copy only (version 7, approved short-copy source fa3ebcb)**. No production deployment or merge. Scope: **manual WhatsApp Click-to-Chat only**.

## What this feature does

Mohim ERP prepares an editable Bangla or English WhatsApp draft based on ledger figures recalculated on the server. When an operator selects **Open WhatsApp**, the browser opens a prefilled WhatsApp chat. **The operator must review the destination and press Send in WhatsApp.** Opening the chat is **not** evidence of sending, delivery, a payment, or acknowledgement. The ERP does not automatically send WhatsApp messages.

This feature must not change customer/supplier/finance balances, stock, cash books, invoices, or other business transactions. A cash session is not required to view/share a statement.

## Access

The staff account needs both permissions:

- **WhatsApp Share: Edit**, AND
- View permission for the selected source: **Customers**, **Suppliers**, or **Finance**.

Administrators use the existing administrator permission model. A hidden button is not a security boundary: the server enforces permissions and checks that selected transactions belong to the chosen account.

## How to share

**Customer or Supplier Ledger:** Select a party. Use **WhatsApp Due** for the current balance; use a transaction's **Actions → WhatsApp** for one entry. To share a selection, tick the checkboxes beside transactions (up to **25**, including across pages), then choose **WhatsApp Selected (N)**. **Clear selection** deselects every checked entry, including entries on other ledger pages, without changing transactions. To share a date range, choose **WhatsApp Dates**, set **From** and **To** (inclusive), then select **WhatsApp** in the existing date dialog.

**Finance Person Ledger:** Select the person and exact **Owner**, **Lender**, or **Borrower** account role. Use **WhatsApp Balance**, **WhatsApp Selected (N)**, **WhatsApp Dates**, or **Actions → WhatsApp** for one row. Switching person or role clears the selection. Lender Credits/Debits and Borrower Debits/Credits follow relationship-ledger meaning, **not** the Cash Book's direction.

**Finance Ledger transaction table:** A transaction's **Actions → WhatsApp** is available only for an individually identified Finance Person with a recognized relationship account and matching role; no all-person or mixed-role WhatsApp statement exists.

**Shared preview:** Check the named party and recipient. Choose বাংলা or English, read the message, and edit text if necessary. If you override the stored phone number, you must explicitly confirm the change; it is **not** saved back to Contacts. Click **Open WhatsApp**, then check the chat recipient again and press **Send** manually. **Copy** copies the message but does not open WhatsApp.

## Correctness, length and exceptions

- The **server**, never the browser, derives balances, dates, rows and totals. Do not use a pre-edited screenshot as accounting evidence.
- **Current due** and **selected entries** are different: selected, non-contiguous transactions are **not** a reconciled date-range statement. The message always shows the authoritative **current full-account balance**, not the selected-entry subtotal. A date-range message names the period but still explicitly labels the figure as the **current** balance, not that period's closing balance.
- In a very long date-range statement, the first 12 transactions may be listed while totals still include all transactions. The preview says when rows were omitted.
- At most 25 individually selected rows can be shared; none of their references are included in the selected summary. The direct URL has a conservative **8,000-character encoded URL budget**, not an official WhatsApp limit. If exceeded (e.g. extremely long party/shop names), **Copy** remains available; do not silently truncate or claim that the link is usable.
- If the saved phone is missing/invalid, use **Copy** or enter a correct number and confirm. Only Bangladesh mobile numbers in accepted 01 / +8801 forms are valid.
- Edited, deleted, synthetic/corrected, wrong-party or wrong-role transactions can be rejected during fresh server validation. Refresh the relevant ledger, reselect the rows, and try again. Internal correction entries are not shared as normal business rows.
- If the browser blocks WhatsApp, use **Copy** and paste into the intended WhatsApp chat after checking the recipient. On mobile, behavior depends on installed WhatsApp/browser handling; do not assume auto-opening works on every device.
- An audit error warns that an open attempt may not have been recorded. **It is never a delivery status.**

## Approved concise copy — 2026-11-03

The user approved the short Bangladesh-local wording without debit/credit. Figures still come from the authenticated server, with no accounting mutations. The shop name comes from settings (Bangla name when configured); the party name is shown unprefixed, e.g.:

\`\`\`text
*শের মোহাম্মাদ স্যানিটারি হাউস*

মো: ইত্তাকুর রহমান

*আপনার মোট বাকি: ১৪,৬২০ টাকা*

ধন্যবাদ।
\`\`\`

- **Due/Balance:** the compact four-part format above; only one bold relationship-appropriate current balance.
- **Single:** one short transaction line before the bold full-account balance. Customer sale: \`বিল INV-000106: ১৪,৬২০ টাকা\`; supplier purchase: \`মাল কেনা: ১২,০০০ টাকা\`. Finance lines are role-specific (loan received, repaid, given, borrower repayment, owner capital deposited/withdrawn).
- **Selected:** \`নির্বাচিত লেনদেন: ৩টি\` before the bold full-account balance. Selected transaction amounts and IDs are intentionally omitted.
- **Dates:** \`হিসাব: ১–৩১ অক্টোবর ২০২৬\` before a bold balance explicitly marked \`বর্তমান\`; this is **not** the date-range closing balance. No row details or period totals appear in the outbound message.
- **Sign-aware variants:** customer due vs advance; supplier payable vs advance; lender outstanding vs excess paid; borrower outstanding vs extra paid; owner capital vs excess withdrawal; zero/settled statement.
- **Display:** Bangla digits, Bangladeshi thousand/lakh grouping, \`টাকা\`, optional paisa only when nonzero. English remains selectable with concise role-appropriate text and \`Tk\`. No debit, credit, opening/closing ledger jargon in outbound copy.
- **Security:** Only message rendering changed. Verification against source ledger, role authorization, finance person scoping, row version revalidation, phone override confirmation, manual Send, and attempt-only audit are unchanged.

## Privacy and audit

The separate **WhatsApp Share Log** sheet records *OPEN_ATTEMPTED* with the ERP user's ID, source/party, role, sharing mode, row count, destination's last four digits, whether the recipient was overridden, timestamp, and an idempotent event ID. It intentionally does **not** store the full recipient, message body or financial account credentials.

The log is not evidence that the recipient opened WhatsApp or received the text. A click on **Copy**, **Cancel**, or opening the preview must not produce a WhatsApp opening audit event.

## Release acceptance checklist — must remain incomplete until verified

- [ ] All CI-required Node and browser tests pass; resolve the two pre-existing finance/party ledger *color presentation* test conflicts without changing the underlying ledger arithmetic.
- [ ] Desktop Firefox/Chrome: actual Google Apps Script iframe opens the correct WhatsApp Web/new tab via a direct click; no popup-blocker failure; Copy fallback works.
- [ ] Small laptop and tablet: compact dialog, original ledger Actions menus, selected rows, scrolling, date pickers, and keyboard navigation work.
- [ ] Android Chrome and WhatsApp app: destination, Unicode Bangla text and direct link behavior verified; Copy fallback tested.
- [ ] iPhone Safari and WhatsApp app: destination, direct link and Copy fallback verified.
- [ ] Live **non-production** Apps Script preview: permission-gated Customer, Supplier, Owner, Lender, Borrower, synthetic row freshness, missing/overridden recipient, audit sheet creation, duplicate clicks, no accounting writes.
- [ ] Finance Ledger menu shows WhatsApp only for a uniquely resolved Person ID + role; does not leak all-person data.
- [ ] Production/preview Script IDs and deployment targets reviewed by an operator before any use of clasp.
- [ ] Changes reviewed for source permissions, formula/ledger parity, CSP/iframe behavior, secrets, ID preservation and no financial writes.
- [ ] Explicit approval before merge or **any** deployment. Keep PR in **Draft** until all release conditions are complete.

**Known testing limit:** mocked browser and in-memory Google Apps Script tests cannot verify actual Sheets append behavior, OAuth/session expiry, web-app iframe navigation on devices, or whether WhatsApp opens/sends. Do not mark these checkboxes complete from CI alone.

## Out of scope for Phase 1

Automated messages, delivery receipts and read receipts, WhatsApp Cloud API or unofficial gateways, scheduling/reminders, payment automation, invoice PDFs, and automatic publication of Drive file links. These require later separately approved phases.

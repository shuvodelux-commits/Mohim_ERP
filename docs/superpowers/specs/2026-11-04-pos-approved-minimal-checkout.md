# POS V2 minimal checkout — approved visual replacement

**Date:** 2026-11-04
**Source of truth:** The interactive CSS-based “Mohim ERP — Minimal POS Checkout” design approved directly in the immediately preceding conversation. User explicitly requested exact visual replacement and responsiveness.

## Design requirements
Replicate the approved light, flat white customer/checkout card with 6px input radii, thin gray borders, compact 40px customer inputs, ghost auxiliary actions, and compact single-line payment rows with no nested cards. Keep blue emphasis on Complete Sale and Grand Total only.

Visual details:
- **Customer:** heading 16px semibold; 12px blue Clear Customer link, slim name/phone icon inputs, muted Outstanding Due, simple text links for Father/Address and Sales History. Existing required fields, autocomplete, and expanded fields retained.
- **Discount:** single 36px, 122px-wide right-aligned input, separated from customer controls by thin divider.
- **Payments:** 15px heading with Bangla subtitle below, lightweight blue “+ Add payment” link. Flat row list separated by 1px dividers; on wide panels columns Method 104px / Account fluid / Amount 98px / Fill Due 62px / trash 27px with 8px gap, control height 36px. No tinted row backgrounds or individual row outlines.
- **Responsive:** use container query to wrap individual payment rows into two lines whenever the **actual checkout panel** is narrow (including sidebar desktop, tablet two-column layouts, and mobile). Do not rely only on viewport width. Preserve 36px controls and usable focus styles, no horizontal overflow.
- **Summary:** quiet Paid Now / Due / Cash Change rows; Subtotal separated by thin line; Grand Total 18px blue with line divider; subdued Estimated Profit; white Save Draft + blue Complete Sale, 43px height, ratio about 1:1.85.
- Preserve all existing real values, currency formatting, customer search, split payment reconciliation, bank selector, limit-one-cash, 20-row limit, drafts, POS V2 tabs, and single-payment fallback.
- Don’t copy the demo’s fabricated transaction data or front-end mock logic. Use production POS state and existing backend only.

## Approach
Scope CSS to `body.pos-v2-active #page-pos`; reuse the existing POS markup/IDs and change only payment heading markup and minor action classes as needed. Apply a dedicated minimal-checkout style layer *after* older V2 responsive rules. New scoped style must not affect Classic POS or other modules.

**Release:** Branch from PR #44 tested head `aeae20f`, update that still-unmerged PR (or follow-up branch) and deploy only to existing TEST Apps Script project after browser + Node verification. Production remains @70. Multi-payment flag remains default-off; real postings need isolated synthetic-data clone.

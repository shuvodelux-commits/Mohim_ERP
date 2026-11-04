# POS V2 customer fields always visible and cart stable

User screenshot Nov 4 2026: expanding the optional Father Name / Address block in the right-hand customer panel pushes the left POS cart downward. User approves removing the collapsible behavior.

## Required
- Father Name / Address are optional but always visible, including new sale, customer selection, imported invoice/update and draft restore.
- Remove the + / − toggle; keep all original field IDs and persistence/validation unchanged.
- Compact two-column inline fields in desktop/tablet sidebar and stacked fields on narrow phones; keep existing minimalist styling, labels and accessibility.
- Preserve Sales History action and customer due information.
- Desktop POS grid uses a first row sized only by the search toolbar (max-content) and a second independent row for cart, not a content-sized row that grows with a spanning customer panel.
- Test with 1–2 optional fields filled and with customer due displayed; cart top must stay fixed.
- Keep PR #44 unmerged and production unchanged at @70; TEST only, no real accounting posts.

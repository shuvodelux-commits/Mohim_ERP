# Sales and Products: Sticky Top Horizontal Scrollbars
Date: 2026-11-04
Basis: user screenshot of the teal horizontal scrollbar immediately above the column headings and explicit instruction to apply it to Sales and Products.

## Intent
Provide an always-reachable, **clickable/draggable horizontal scrollbar directly above the table heading**, even after the original heading has scrolled underneath the app's main header. Users of narrow desktop and tablet screens must not need to scroll to the bottom of a long table to reach sideways columns.

## Existing behavior
- Sales has `#smTopScroll`, a top horizontal scrollbar that syncs with `#smTableScroll` but scrolls out of view with the page; Sales clones a pinned heading when the real header disappears.
- Products has `#prodTableScroll` and a pinned heading but lacks a top horizontal scrollbar.
- Both tables have an independent horizontal scrolling wrapper and a right-pinned Actions column.
- The existing bottom floating scrollbar mirrors page content, not the local table; retain it.

## Preferred approach
Keep the Sales top scrollbar and add the corresponding Products scrollbar as a sibling before each table. Use `position: sticky; top: 0` within the module card, not duplicated fixed overlay widgets, so the **same native track** remains visible while the `#content` scroller moves. Reposition the existing mirrored pinned heading just below the sticky track only when the table truly overflows horizontally. Preserve native track/drag/click/keyboard behavior, and style its thin thumb teal.

## Alternatives considered
- Add a separate fixed duplicate bar in each header overlay: rejected, because this introduces competing scroll containers, horizontal sync races, and duplicated accessibility controls.
- Relocate the page-level floating bottom scrollbar to the top: rejected, because it mirrors the page scroll rather than each module's local table.
- Replace the original table/header with a new grid: rejected, because it risks sorting and pinned Actions.

## Requirements
- Top track is visible iff module table has horizontal overflow; hidden for no overflow, mobile-card breakpoint (<=540px), and print.
- Track stays aligned to the top of the scrolling content area, directly **above** the pinned mirrored table header.
- Dragging or scrolling top track moves the table and mirrored header; scrolling the table updates the track. Keep synchronization during resize, data render, module switch.
- Only **one top scrollbar per module** (reuse existing Sales bar); do not introduce phantom horizontal motion for full-width tables.
- Preserve existing table columns, typographic sizing, sort controls, filters, bundle behavior, actions, mobile layout and transaction logic; no Apps Script backend or production deployment changes.
- The user's currently tested Products single-line layout is a prerequisite: branch from `fix/products-tablet-single-line-20261104` and PR onto that branch; do not silently revert it.

## Acceptance
Static regression tests + browser geometry and sync tests pass, including 768px tablet overflow, scroll-up/down transitions, page/tab switching, and no-overflow state. Actual Apps Script preview remains a separate test phase.

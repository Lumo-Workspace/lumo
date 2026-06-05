# Document Comment Right-Gutter + Outline Left-Rail — Design

**Date:** 2026-06-05
**Task:** LUM-226 follow-up (document comments)
**Status:** Approved design, pending implementation plan

## Problem

Two regressions in the document editor introduced while building the LUM-226
comment feature:

1. **"点评论点不开" — clicking comment does nothing.** Selecting text and
   clicking the comment button in the bubble menu correctly fires
   `onRequestComment → setPending`, but the composer (`NewCommentPopover`) is
   rendered as a static inline `<div>` at the very **bottom of the document
   content** (`DocumentEditorPage.tsx`, after `<DescriptionEditor>`, wrapped in
   `mt-2`). On a long document the composer appears far below the viewport, so
   the user sees no reaction. The popover is also misnamed — it is not anchored
   to the selection at all (the code comment admits anchoring was deferred to
   "Plan #6").

2. **"大纲变成单独一列" — outline is an ugly separate column.** The TOC and
   comments share a single tabbed `<aside>` that is the **first** flex child,
   so it occupies a full `w-52` column to the **left** of the centered content.
   Since the comments tab forces `w-52` (no collapse), it reads as an intrusive
   left column and pushes the `max-w-3xl mx-auto` body off-center.

## Goal

Match the Google Docs / Notion mental model:

- **Outline (大纲) stays on the LEFT** as its own collapsible rail (its original
  pre-LUM-226 position).
- **Comments (评论) move to the RIGHT** as their own collapsible gutter.
- Selecting text + clicking comment opens the composer in the **right gutter,
  vertically aligned to the selection**, with a highlight on the selected text.
- Saved comment cards are positioned in the right gutter **aligned to their
  anchors**, with collision push-down so they never overlap (full Google-Docs
  gutter behavior — confirmed in design as the chosen scope).

## Non-Goals

- No changes to the comment data model, API routes, services, or repositories.
  This is purely client-side editor UI. `anchorStart`/`anchorEnd` already exist
  on `ApiDocumentComment`, and the editor already renders `span[data-comment-id]`
  marks (via `CommentMark`) — both are reused as-is.
- No change to comment creation/reply/edit/delete/resolve semantics
  (`useDocumentComments`, `DocumentCommentThread`, `NewCommentPopover` reused).
- No realtime/Pusher changes.

## Architecture

Layered note: all changes live in the **Component** layer
(`app/workspace/[workspaceUrl]/components/...`). No Service/Repository/API/Prisma
changes.

### Layout restructure (fixes problem 2)

In `DocumentEditorPage.tsx`, replace the single tabbed `<aside>` with two
independent rails inside the existing `<div className='flex'>`:

```
[ left aside: 大纲 (TOC) ]  [ flex-1 min-w-0: centered content ]  [ right aside: 评论 gutter ]
```

- **Left rail** renders `<DocumentToc>` only, when `tocItems.length > 0`.
  Restores the pre-LUM-226 collapsible behavior (`w-12` collapsed / `w-52`).
- **Right rail** renders `<CommentGutter>`, when `comments.length > 0` **or** a
  pending composer is open. Collapsible.
- Both rails: `hidden xl:block shrink-0 self-start sticky top-0 max-h-screen
overflow-y-auto`.
- **Delete** the `rightTab` / `activeRightTab` state and the tab-switcher
  buttons. `onCommentClick` no longer needs `setRightTab('comments')` — the
  right gutter is always the comments surface.

### Comment gutter (fixes problem 1)

Three new units, each with one responsibility:

| Unit                        | Responsibility                                                                                                                                                                                                                                                                                                               | Depends on                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `comment-gutter-layout.ts`  | **Pure function.** Given an array of `{ id, anchorY, height }` (+ gap), return `{ id → top }` resolving collisions by sorting on `anchorY` and pushing each item to `max(anchorY, prevBottom + gap)`. No DOM, no React.                                                                                                      | —                                         |
| `useCommentGutterLayout.ts` | **Hook.** Measures each anchor's Y from the editor DOM (`coordsAtPos(from)` for the pending composer; `span[data-comment-id]` offsetTop for saved comments), feeds the pure function, and returns the `{ id → top }` map. Recomputes on editor scroll, content mutation, comments change, and window resize (rAF-throttled). | `comment-gutter-layout`, editor ref       |
| `CommentGutter.tsx`         | **Component.** Owns the right rail. Renders the pending `<NewCommentPopover>` and one `<DocumentCommentThread>` per comment, each absolutely positioned at its computed `top`. Renders the selected-text quote + active highlight.                                                                                           | the hook, reused card/composer components |

Data flow:

```
Component (DocumentEditorPage)
  → CommentGutter (props: editorRef, comments, pending, members, currentActorId, handlers)
    → useCommentGutterLayout(editorRef, comments, pending)   // {id → top}
      → comment-gutter-layout(items)                          // pure math
    → NewCommentPopover (pending)  + DocumentCommentThread[]  // positioned
```

### Interactions (reuse existing)

- **Create:** bubble menu comment button → `onRequestComment(from,to,quoted)` →
  `setPending` → composer renders in gutter at selection Y. Submit →
  `create(...)` → clear pending. Cancel → clear pending.
- **Card → text:** clicking a card calls `scrollToAnchor` (existing) → scrolls
  editor to the `span[data-comment-id]` + flashes highlight + sets active.
- **Text → card:** clicking an anchor span → `onCommentClick(id)` →
  `setActiveCommentId(id)` → gutter highlights that card.

## Error / edge handling

- **No anchor span found** (comment whose mark was deleted / orphaned): fall
  back to stacking it at the bottom of the gutter in document order rather than
  dropping it. (Orphan handling already exists server-side from #309.)
- **Anchor measurement before editor ready:** hook returns an empty map until
  `editorRef.current` exists; gutter renders nothing positioned yet (no crash).
- **Pending composer height:** measured/estimated so the collision pass reserves
  space and following cards push down below it.
- **Collapse state:** when the right gutter is collapsed, positioned rendering
  is skipped (thin rail only).
- **Resolved comments:** the gutter shows only **open** (non-resolved) threads,
  positioned at their anchors — consistent with Google Docs, where resolving a
  comment removes it from the margin. This drops the old sidebar's "show
  resolved" toggle from the editor surface for v1; a "resolved comments" entry
  point can be added later as a separate, non-positioned view.

## Testing (jest / jsdom)

- `comment-gutter-layout.test.ts` — pure collision math: ascending anchors with
  no overlap pass through unchanged; overlapping anchors push down to
  `prevBottom + gap`; out-of-order input is sorted; empty input → empty map.
- `CommentGutter.test.tsx` — renders `NewCommentPopover` when `pending`; renders
  one card per comment; renders nothing when no comments and no pending; mocks
  the Y-measurement (jsdom `offsetTop`/`coordsAtPos` are not real).
- `DocumentEditorPage` layout — TOC on the left, comments gutter on the right,
  **no** tab-switcher buttons, composer **not** at the document bottom.

**jsdom caveat:** jsdom has no layout engine (`offsetTop === 0`,
`getBoundingClientRect → 0`). Therefore the positioning math lives in a pure
function tested directly with synthetic Y inputs; component tests inject/mock
the measurement so they never depend on real layout.

## i18n

No new user-facing strings expected — reuses `document.outline`,
`document.comments`, `editor.comment`, `common.cancel`. If implementation
surfaces a new string, it must be added to **all 16** locale files with real
translations (per the strict locale-parity test).

## Files

**New**

- `app/workspace/[workspaceUrl]/components/document/comments/comment-gutter-layout.ts`
- `app/workspace/[workspaceUrl]/components/document/comments/useCommentGutterLayout.ts`
- `app/workspace/[workspaceUrl]/components/document/comments/CommentGutter.tsx`
- `__tests__/comment-gutter-layout.test.ts`
- `__tests__/CommentGutter.test.tsx`

**Modified**

- `app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx`
  (split rails, drop tab state, move composer into gutter)

**Reused unchanged**

- `DocumentToc`, `DocumentCommentThread`, `NewCommentPopover`, `anchor-dom.ts`,
  `useDocumentComments`.

**Removed from the editor surface**

- `DocumentCommentsSidebar` — its role (list + empty state + show-resolved
  toggle) is replaced by `CommentGutter`. The file may be deleted if no other
  caller imports it; otherwise it is simply no longer rendered by
  `DocumentEditorPage`. Confirm via grep before deleting.

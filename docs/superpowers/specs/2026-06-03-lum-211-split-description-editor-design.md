# LUM-211 — Split DescriptionEditor & extract trackUpload helper

**Status**: Approved (design phase)
**Date**: 2026-06-03
**Source**: Code review #8 + #9 (milestone: 文档编辑器优化)
**Type**: Pure refactor — behavior must stay byte-identical

## Problem

`app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx` (896 lines) mixes
six responsibilities in one component, violating CLAUDE.md SRP:

1. `MentionWithType` node definition (lines 43-104)
2. Image upload (`insertImageWithUpload`, lines 164-230)
3. Upload validation + enqueue + pending-tracking (`enqueueImageUpload`, lines 462-487)
4. TOC sync (the ~100-line effect, lines 495-612)
5. drag/drop wiring (lines 624-658)
6. paste wiring (editor `handlePaste`, lines 409-419)

The review notes the upload pending-tracking `.finally(...)` was duplicated across
paste/drop/file-picker. **Verified current state**: that consolidation already
happened — the three paths now funnel through a single `enqueueImageUpload`
(lines 462-487). The remaining work is the module/hook decomposition and naming
the pending-tracking logic as a reusable `trackUpload` helper.

## Goals

- Extract cohesive units, each with one purpose and a testable boundary.
- Keep `lib/editor/` UI-free (it currently imports no `sonner`/toast).
- Zero behavior change — verified by `tsc --noEmit`, new unit tests, and the
  existing 22 editor tests staying green.
- No new i18n strings (reuse existing keys) → no locale-file changes.

## Decomposition

| New location | Content | Nature |
|---|---|---|
| `lib/editor/nodes/mention-with-type.ts` | `MentionWithType` extension. renderHTML/renderText branch logic extracted to pure `renderMentionHTML` / `renderMentionText` for unit testing. | Pure, no React/UI |
| `lib/editor/insert-image-with-upload.ts` | `insertImageWithUpload`. **On failure calls an injected `onError()` callback instead of `toast`** so the module stays UI-free. | Pure (depends only on tiptap Editor) |
| `app/workspace/[workspaceUrl]/hooks/useImageUploads.ts` | Full upload chain: internal `useIntl` for the 3 image messages, `pendingUploadsRef`/`pendingCommitRef`, the unified `trackUpload(promise)` helper, and `enqueueImageUpload` (validate → trackUpload → insert). | React hook |
| `app/workspace/[workspaceUrl]/hooks/useTocSync.ts` | The ~100-line TOC sync effect (elCache, resolveOffsetTop, scroll listener, rAF throttle, removal of the extension's window listener). | React hook |

`DescriptionEditor.tsx` shrinks to: prop wiring, `useEditor` config, the
extract-applied/-error handlers, and JSX/portals.

## Contracts

### `useImageUploads({ editorRef, documentId })` → `{ enqueueImageUpload, runOrDeferCommit }`

- **Called before `useEditor`.** It depends only on `editorRef` (a stable ref
  created before `useEditor`), not on the editor instance. This lets all three
  upload paths — the editor's `handlePaste`, the drop effect, the file-picker —
  call one **stable** `enqueueImageUpload`, and **removes the component's
  `enqueueImageUploadRef` entirely**.
- `enqueueImageUpload(file, insertPos?)`: validates size + MIME (toast on
  reject, no upload), then `trackUpload(insertImageWithUpload(...))`.
- `trackUpload(promise)`: the single place that increments `pendingUploadsRef`,
  decrements in `.finally`, and runs the deferred commit when the count hits 0.
- `runOrDeferCommit(commit)`: if `pendingUploadsRef.current > 0`, stash `commit`
  in `pendingCommitRef`; else run it immediately. `onBlur` calls only this — it
  never touches the refs (the "hook owns the handshake" choice).
- Returned `enqueueImageUpload` must be **referentially stable** across
  `documentId`/message changes (backed by an internal ref) so the once-built
  `handlePaste` never calls a stale version — same guarantee the current
  `enqueueImageUploadRef` provides, now encapsulated.

### `useTocSync({ editor, tocEnabled, tocScrollRoot, onTocUpdate, emitTocRef, tocScrollRootRef })`

- `emitTocRef` and `tocScrollRootRef` stay owned by the component and are passed
  in. **Reason (hard constraint, not a compromise):** Tiptap configures
  extensions once at `useEditor` creation, so `TableOfContents`'s `scrollParent`
  (`() => tocScrollRootRef.current ?? window`) and `onUpdate`
  (`() => emitTocRef.current()`) must read the latest values through refs that
  exist before `useEditor`.
- The hook encapsulates the heavy effect: assigning `emitTocRef.current = emit`,
  syncing `tocScrollRootRef`/an internal `onTocUpdateRef`, the elCache +
  `resolveOffsetTop`, the rAF-throttled scroll listener, and detaching the
  extension's stale window listener. The pure active-index math stays in
  `computeActiveTocIndex` (`lib/editor/toc-active.ts`, untouched).

## Behavior-preservation & coverage boundary (honest)

- **Strong guarantees**: `tsc --noEmit` (pure refactor, no type change) + new
  module unit tests + existing 22 editor tests stay green.
- **`trackUpload` keeps semantics**: still increment → `.finally` decrement →
  run deferred commit at 0; only moved from inline into a named helper.
- **`useTocSync` coverage is limited**: scroll geometry (`offsetTop`,
  `scrollHeight`) is unreliable in jsdom. The pure math is already covered by
  `toc-active.test.ts` (unchanged). The hook can only be tested for
  "items from storage → correct output shape" and "empty → `[]`"; scroll-driven
  active highlighting cannot be unit-tested in jsdom. Backstopped by `tsc` and
  by not altering the `computeActiveTocIndex` call.
- **No existing DescriptionEditor integration test**; adding a full
  tiptap-in-jsdom integration test is out of scope. Confidence comes from the
  per-unit tests + tsc + green baseline.

## TDD order

For each unit: write/extend its unit test (red) → extract + wire (green) →
`tsc --noEmit` + run that directory's jest.

1. `mention-with-type` — render branches: task/user × with/without title/status
2. `insert-image-with-upload` — insert placeholder, swap src on success, remove
   + call `onError` on failure, revoke object URL
3. `useImageUploads` — validate rejection (toast, no pending++), pending
   tracking, `runOrDeferCommit` defer-vs-immediate, decrement on success & failure
4. `useTocSync` — storage items → output shape, empty → `[]`
5. `DescriptionEditor.tsx` wiring — final assembly; full suite + tsc green

## Known gotchas (from project memory)

- Run jest with cwd **inside** the worktree (haste collision otherwise).
- `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` are on — only
  `tsc --noEmit` catches these; run it before claiming done.
- Optimistic/async hook tests need `waitFor`, not a sync read after `act`.

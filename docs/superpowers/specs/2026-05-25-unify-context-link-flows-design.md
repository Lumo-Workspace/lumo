# Unify Task Context Link Flows (LUM-93)

**Status**: Design
**Date**: 2026-05-25
**Task**: [LUM-93](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-93)

## Problem

The task detail page exposes four "context" sections that link external resources to a task: **Pull Requests**, **Web Links**, **Slack Messages**, **Documents**. The four flows are inconsistent today:

| Type     | Today's entry                             | Form fields                                              |
| -------- | ----------------------------------------- | -------------------------------------------------------- |
| PR       | Popover with search + URL paste, no modal | URL/PR (no description)                                  |
| Web Link | Modal dialog                              | URL + optional Note                                      |
| Slack    | Modal dialog                              | Permalink                                                |
| Document | **No attach entry — read-only**           | — (linked only via `@LUM-N` mentions in document bodies) |

The inconsistency hurts both users (every type behaves differently) and developers (duplicated dialog patterns). PR already implements the desired pattern.

## Goals

1. **Visual & interaction consistency**: weblink, Slack, and document attach flows match the PR popover pattern — popover triggered from `addSlot`, no modal dialog, no separate "Add" button.
2. **Drop the weblink "Note" input field**: the user-facing description input goes away. (OG-derived `description` continues to show in the card preview.)
3. **Add a document attach entry point**: document linking from the task detail page is currently impossible; this spec introduces it.

## Non-goals

- Refactor PR linking — `LinkPrPopover` is the reference pattern and stays as-is.
- Drop the `TaskWebLink.note` database column — UI no longer writes it, but the column is retained.
- Extract a shared popover shell component — body shapes differ enough that abstraction is premature (YAGNI).
- Change `lumo doc bind / doc unbind` CLI commands — they continue to work; only the underlying service is restructured to share code with the new web route.

## Design

### Component layer

Four popovers, each mounted at its section's `addSlot`:

| Type     | Component                | Status                                          | Popover body                                          |
| -------- | ------------------------ | ----------------------------------------------- | ----------------------------------------------------- |
| PR       | `LinkPrPopover.tsx`      | unchanged (reference)                           | Search input + remote PR list + URL paste             |
| Web Link | `LinkWebLinkPopover.tsx` | **new** (replaces `WebLinkAddDialog`)           | Single URL input                                      |
| Slack    | `LinkSlackPopover.tsx`   | **new** (replaces `AddSlackContextDialog`)      | Single permalink input                                |
| Doc      | `LinkDocPopover.tsx`     | **new** (mounted on `DocumentsSection.addSlot`) | Search input + accessible-doc list + identifier paste |

**Shared popover skeleton**: trigger button → Radix Popover panel → top input → middle content (search results or empty) → bottom error/loading row. **No separate Add button. No Cancel button.** Click outside dismisses. `Enter` submits; on success the popover closes and the section list invalidates.

**Files deleted**: `WebLinkAddDialog.tsx`, `AddSlackContextDialog.tsx` and any orphaned imports.

### Document popover input resolution

The doc popover's input does double duty as both **search query** and **identifier paste**. Routing rule:

1. Input contains `/documents/` → parse as URL, extract trailing `<slug>-<n>` segment, resolve to `documentId`.
2. Input starts with `cmd_` → treat as cuid, resolve directly.
3. Input matches `^[a-z0-9-]+-\d+$` → treat as workspace slug-N.
4. Otherwise → treat as search query, hit `GET /api/documents?q=<text>`.

On `Enter`, if the input matches identifier rules (1–3) we attach immediately; otherwise we surface the first search result for the user to click. Empty result list shows "no matches" copy.

### API layer

**Weblink** — pure subtraction:

- `lib/validation/web-link.ts` → remove `note` from `createWebLinkBodySchema`.
- `lib/api-client/task-web-links.ts` → `add(taskId, { url })`; drop `note` param.
- `lib/services/task-web-link.service.ts` → `addWebLink` input no longer accepts `note`; persists `note: null` (column kept).
- `app/api/tasks/[id]/web-links/route.ts` → schema-driven, no further changes.

**Slack** — no backend change. Existing endpoint `POST /api/tasks/[id]/slack-contexts` and service `taskSlackContextService.linkSlackPermalink` are unchanged. Only the frontend dialog→popover swap.

**Doc** — new attach + detach endpoints + extracted service:

| Endpoint                                        | Method | Body / params                                          | Behavior                                                                                                                                                                                                                                                                   |
| ----------------------------------------------- | ------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/tasks/[id]/documents`                | POST   | `{ identifier: string }` _or_ `{ documentId: string }` | Resolve identifier → upsert `DocumentMention(source=EXPLICIT)`. Matches `lumo doc bind` semantics. Idempotent: existing EXPLICIT row returns 200 + `alreadyLinked: true`. Existing CONTENT row is upgraded to EXPLICIT (consistent with CLI behavior).                     |
| `DELETE /api/tasks/[id]/documents/[documentId]` | DELETE | —                                                      | Remove EXPLICIT mention. CONTENT mention returns 409 with i18n error key `errors.docMentionContentOnly`; UI shows toast directing user to edit doc body.                                                                                                                   |
| `GET /api/documents?q=<text>&limit=10`          | GET    | `q`, `limit`                                           | Title contains search, scoped to current user's accessible docs (WORKSPACE + own PRIVATE + SHARED-to-me). Verify whether the existing `/api/documents` list endpoint already accepts `q`; if so, extend; otherwise add. (Decision deferred to the plan-verification pass.) |

New / changed files:

- `lib/services/task-document-link.service.ts` — **new**. Houses identifier resolution + `attachExplicit` / `detachExplicit`. Both the new web routes and the existing CLI `doc bind`/`doc unbind` routes call this; CLI route is refactored to delegate (no behavior change visible to CLI users).
- `lib/repositories/document-mention.repository.ts` — confirm if present; if not, add `findByPair`, `upsertExplicit`, `removeExplicit`.
- `lib/api-client/task-documents.ts` — add `attach(taskId, payload)`, `detach(taskId, documentId)`, `search(q, limit?)`.
- `lib/validation/task-document.ts` — **new**. `attachTaskDocumentBodySchema` (`{ identifier?: string; documentId?: string }` with XOR refinement).

### Permissions

Centralised in `task-document-link.service.ts`:

- **Attach**: caller can read the document (same visibility rule as the search endpoint) **and** can write the task.
- **Detach**: caller can write the task. Doc read is **not** required — otherwise a doc that gets un-shared would lock the link in place.

### Error handling (all popovers)

| State                                                                     | Behavior                                                                                 |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Submitting                                                                | Input disabled, footer shows loading copy                                                |
| 422 (URL malformed / identifier unresolved)                               | Footer shows red error copy, input retains value, popover stays open                     |
| 409 (PR already linked to a different task / doc mention is CONTENT-only) | Toast + popover stays open                                                               |
| 401 / 403                                                                 | Toast "无权限" + popover closes                                                          |
| Network error                                                             | Footer red copy + retry hint                                                             |
| 200 success                                                               | Popover closes, section list re-fetches (TanStack Query `invalidateQueries` per section) |

### Idempotency and edge cases

- **Doc attach** of an existing (task, doc) EXPLICIT pair → 200, no duplicate row.
- **Doc attach** when a CONTENT mention exists → upgrade to EXPLICIT (preserves the row; CLI does the same).
- **Weblink** repeated URL: behavior unchanged from today; if duplicate-prevention is desired it's tracked separately, not in this spec.
- **Slack** repeated permalink: behavior unchanged.
- **Doc visibility lost after attach** (someone unshares the doc): UI renders a lock icon + tooltip "无权访问"; detach remains available from the task side.

### Testing

| Layer     | Tests                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service   | `task-document-link.service.test.ts` (new) — EXPLICIT upsert, CONTENT→EXPLICIT upgrade, unauthorized read rejection, unresolvable identifier            |
| Service   | `task-web-link.service.test.ts` — remove `note` input assertions; keep OG description fetch test                                                        |
| API route | `tasks/[id]/documents.route.test.ts` (new) — POST attach (identifier + documentId), DELETE unlink, CONTENT 409 case, permission rejections              |
| API route | `tasks/[id]/web-links.route.test.ts` — schema rejects unknown `note` field                                                                              |
| Component | `LinkDocPopover.test.tsx`, `LinkSlackPopover.test.tsx`, `LinkWebLinkPopover.test.tsx` (new) — Enter submits, error rendering, popover closes on success |

### i18n

Locales to update: `de, en, en-AU, en-GB, es, es-419, fr, hi, id, ja, ko, ms, ru, vi, zh-CN, zh-TW` (17 files).

**New keys** (prefixes scoped per popover):

- `task.contextLink.weblink.placeholder`, `.errors.urlInvalid`
- `task.contextLink.slack.placeholder`, `.errors.permalinkInvalid`, `.errors.workspaceNotConnected`
- `task.contextLink.doc.placeholder`, `.searchEmpty`, `.errors.notFound`, `.errors.contentMentionOnly`, `.lockTooltip`
- Shared: `task.contextLink.common.loading`, `.errors.network`, `.errors.unauthorized`

**Removed keys**: every key referenced only by `WebLinkAddDialog` / `AddSlackContextDialog` (dialog title, "Note" label, Cancel, Add link, Attach). Removal must be applied to all 17 locale files in the same PR — no English fallback per CLAUDE.md.

### Rollout / data migration

- No Prisma schema changes (`TaskWebLink.note` kept; `DocumentMention` already supports EXPLICIT/CONTENT).
- No production data migration.
- Delete `WebLinkAddDialog.tsx` and `AddSlackContextDialog.tsx`; grep imports to confirm no stragglers.

### CLI / SKILL.md sync

This change does **not** add or modify any command under `cli/src/commands/`. CLI `lumo doc bind` and `lumo doc unbind` continue to work — only the underlying service was refactored to be shared with the new web routes. Per the CLAUDE.md sync rule, `.claude/skills/lumo/SKILL.md` does not need updates.

If the plan-verification pass surfaces a need to add a CLI flag (e.g., to expose the same identifier-resolution helper), the SKILL.md update will be folded into the plan.

## Verification questions for plan-verification pass

These are the points worth double-checking against the current codebase before writing the implementation plan:

1. Does `GET /api/documents` already accept a `q` query parameter? If yes, extend it; if no, add it.
2. Does `lib/repositories/document-mention.repository.ts` exist? If yes, what's its surface?
3. Which file currently hosts the CLI `doc bind` / `doc unbind` route handler? Confirm the refactor target.
4. `LinkPrPopover` uses Radix Popover — confirm we use the same Radix component for visual consistency.
5. Are there other locale files beyond the 17 listed above (e.g., a hidden `pseudo.json`)? Confirm at plan time.

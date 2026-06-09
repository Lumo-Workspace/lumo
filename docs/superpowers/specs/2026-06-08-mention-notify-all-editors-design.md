# Wire @mention notifications across all editor surfaces [LUM-334]

## Problem

`@mention` is already wired into nearly every editor surface for **UI, search, and
rendering** — they all share one `DescriptionEditor` (`getBaseExtensions`), one
search endpoint (`mentionSearchClient` → `GET /api/workspaces/mention-search`),
and one render path (`MentionWithType` / `renderMentionHTML`).

But the **notification** side is comment-only. When you `@`-mention a teammate in a
**task / project / milestone description** or a **document body**, the mention
renders and links correctly, yet the mentioned user is **notified by nobody** —
the save path silently drops it. Two near-identical notify cores
(`comment.service.notifyMentions`, `documentComment.service.notifyDocMentions`)
serve the two comment surfaces; descriptions/bodies have no equivalent.

Additionally:
- **Milestone descriptions can't `@`-people at all** — `MilestoneOverviewTab`
  passes `useMentionSources([])` (empty members), so only entity mentions work.
- The existing **`DOCUMENT_COMMENT_MENTIONED`** notification type is never
  surfaced in the inbox (`ApiNotification['type']` union omits it) — a latent gap.

## Goal

`@`-mentioning a person anywhere an editor is used (task/project/milestone
descriptions, document body, task/document comments) reliably notifies that
person — inbox + Slack DM — gated by their existing mention preference, without
re-notifying on every edit.

## Design decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| 1 | **When to notify on a mutable description** | **Only newly-added mentions.** Save does a read-before-write diff (old content vs new); notify only `mentions(new) − mentions(old)`. Null/empty old ⇒ all are new. |
| 2 | **Inbox notification type granularity** | **Per-surface.** Reuse `TASK_MENTIONED` for task descriptions; add `PROJECT_MENTIONED`, `MILESTONE_MENTIONED`, `DOCUMENT_MENTIONED`. |
| 3 | **Delivery channels** | **inbox + Slack DM**, no project-channel broadcast for descriptions (descriptions are slow-paced; channel broadcast is too noisy). |
| 4 | **Preference control** | **Reuse the existing mention toggle** (`notifyInAppMention` / `notifySlackMention`). No new preference fields. |
| 5 | **Doc-comment inbox gap** | **Fix it in scope** — add `DOCUMENT_COMMENT_MENTIONED` to the inbox union + rendering (same change surface as the new types). |

## Architecture

### Trigger semantics — read-before-write diff (decision 1)

Comments are append-only → notify-on-create. Descriptions are mutable and
auto-saved on blur (`onCommit`), so notify-on-every-save would spam. Each
description/body save path reads the prior rich-text value before writing, then
after a successful update fires the notify helper in `waitUntil` with both old
and new HTML. The helper computes the delta and only notifies clerkIds present
in the new content but not the old. Editing a typo near an existing mention does
not re-notify; removing then re-adding a mention does re-notify (acceptable).

### Shared notify helper (de-duplicate the two comment cores)

New module `lib/services/mention-notify.service.ts` exporting a single core:

```ts
notifyMentionDelta({
  oldHtml,            // '' for comment-create (everything is "new")
  newHtml,
  authorClerkId,
  authorActorId,
  workspaceId,
  notificationType,  // NotificationType
  ref,               // { taskId? projectId? milestoneId? documentId? commentId? documentCommentId? }
  slack,             // { kind, payload } for sendDMNotification
  waitUntil,
})
```

Internals (mirrors today's `notifyMentions` minus the channel broadcast):
1. `parseMentionedUserClerkIds(newHtml, authorClerkId)` and same for `oldHtml`;
   delta = new − old. Empty ⇒ return.
2. `memberRepository.findByWorkspaceAndClerkIds(workspaceId, delta)`.
3. `shouldNotifyBatch(actors, 'inApp'|'slack', notificationType)`.
4. Slack DM to slack-allowed members (`waitUntil`); `notificationRepository.createMany`
   for inApp-allowed (with `ref` columns); `pushUserEvent` realtime ping.

**Refactor:** the two existing comment notify methods are rewritten to delegate
their core to `notifyMentionDelta` (passing `oldHtml=''`). The task-comment
**project-channel broadcast** stays in `comment.service` (decision 3 — only
comments broadcast to channel). Net: all six surfaces share one notify core.

### Schema migration

- `enum NotificationType` += `PROJECT_MENTIONED`, `MILESTONE_MENTIONED`,
  `DOCUMENT_MENTIONED`.
- `model Notification` += `projectId String?`, `milestoneId String?`
  (table already has `taskId` / `documentId` / `documentCommentId` / `sprintId`).
- Additive, no data destruction. Applied locally via the offline-migrate drift
  workaround (CLAUDE.md). **PR must call out: requires `prisma migrate deploy` on
  next prod deploy** (a merged migration ≠ prod migrated — see team-memory trap).

### Preference gate mapping (decision 4)

`lib/notifications/preferenceGate.ts` — add the three new types to both
`INAPP_MAP` → `notifyInAppMention` and `SLACK_MAP` → `notifySlackMention`. They
inherit the existing mention toggle; no new preference fields, no settings UI,
no new i18n for preferences.

### Wiring the four save paths

| Surface | Service method | New notify type | Notes |
|---------|---------------|-----------------|-------|
| Task description | `task-state.service.updateTask` | `TASK_MENTIONED` (reuse) | read old `description` before update |
| Project description | `project.service.updateProject` | `PROJECT_MENTIONED` | read old `description` |
| Milestone description | `milestone.service.updateMilestone` | `MILESTONE_MENTIONED` | read old `description` |
| Document body | `document.service.updateDocument` | `DOCUMENT_MENTIONED` | read old `content`; existing `extractTaskMentionIds` entity-sync is **unchanged** — we only add the user-mention notify |

Each: capture old text → perform update → `waitUntil(notifyMentionDelta(...))`.
`notificationRepository.createMany` input type widens to accept
`projectId?` / `milestoneId?`.

### Inbox frontend (decisions 2 & 5)

- `ApiNotification['type']` union (`app/workspace/[workspaceUrl]/types.ts`) +=
  `PROJECT_MENTIONED`, `MILESTONE_MENTIONED`, `DOCUMENT_MENTIONED`, and the
  previously-missing `DOCUMENT_COMMENT_MENTIONED`. Add `projectId/milestoneId/
  documentId` reference fields + serialized `project`/`milestone`/`document`
  display objects (name + href) from the notifications API serializer.
- `NotificationItem.tsx`: `VERB` map gets entries for all four; the body renders
  the correct **entity reference** (project name / milestone name / document
  title) and click-navigates to that entity, instead of falling back to "a task".
- i18n: new `notification.verb.projectMentioned` / `…milestoneMentioned` /
  `…documentMentioned` / `…documentCommentMentioned` keys, real translations
  across all 16 locales (strict parity test).

### Milestone @-people UI fix

Replace `useMentionSources([])` in `MilestoneOverviewTab` with real members.
Thread `members: WorkspaceMemberInfo[]` from `MilestoneDetailPage`
(via `useMembers()`) → `MilestoneDetailTabs` → `MilestoneOverviewTab`. Now
milestone descriptions can `@`-people like every other surface.

## Testing

- **Helper diff (unit):** notify only newly-added; edit-without-mention-change ⇒
  no notify; null/empty old ⇒ all new; self-mention & `__agent__` excluded;
  preference-gated recipients filtered.
- **Per-service (4):** each update path triggers `notifyMentionDelta` with the
  right type + ref when a new mention appears, and is silent when none added.
- **Preference gate:** new types map to mention fields (inApp + slack).
- **Comment refactor regression:** `notifyMentions` / `notifyDocMentions` still
  send the same notifications (delegation didn't change behavior); task comment
  still broadcasts to channel.
- **Milestone @-people UI:** members threaded; update existing
  `MilestoneOverviewTab.test` / `MilestoneDetailTabs.test`.
- **Inbox rendering:** new types render entity ref + verb; `DOCUMENT_COMMENT_MENTIONED`
  now renders.
- Run both jest roots (`__tests__/` and `tests/`); full `npx jest` at the end;
  `npx tsc --noEmit`; `npm run i18n:check`; `npm run build` (Vercel is the only
  CI gate).

## Out of scope

- New per-surface preference toggles (decision 4 reuses the mention toggle).
- Channel broadcast for descriptions (decision 3).
- Mention notifications for any non-editor surface.
- Changing entity-mention (task-reference) sync behavior in documents.

## Risks / call-outs

- **Prod migration:** additive but must run `prisma migrate deploy` on deploy —
  PR description must state this (team-memory trap: CI skips it).
- **Frontend type exhaustiveness:** `VERB` is `Record<ApiNotification['type'], string>`
  — adding union members forces matching entries (tsc enforces). Good guard.
- **Parallel-session git hygiene:** all work in isolated worktree
  `.worktrees/LUM-334-mention-notify`; never touch the shared main checkout's
  branch. `prisma generate` clobbers the shared client — verify with jest, do
  generate+tsc atomically once at the end.

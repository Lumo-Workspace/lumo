# @mention Notifications Across All Editor Surfaces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@`-mentioning a person notify them (inbox + Slack DM) from every editor surface — task/project/milestone descriptions and document bodies — not just comments, without re-notifying on every edit.

**Architecture:** A single format-agnostic notify core (`mention-notify.service.ts`) diffs old-vs-new HTML and notifies only newly-added mentions. The two existing comment notify methods are refactored to delegate to it (passing `oldHtml=''`). Four description/body save paths read the prior value before writing and fire the helper in `waitUntil`. Inbox frontend gains rendering for the new per-surface notification types plus the previously-missing document-comment type. Milestone descriptions get real workspace members so `@`-people works.

**Tech Stack:** Next.js 14 App Router, TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Prisma + Neon Postgres, Jest, react-intl (16 locales), Vercel `waitUntil`.

**Working directory:** isolated worktree `.worktrees/LUM-334-mention-notify` (branch `lumo/LUM-334-mention-notify`). All git ops pin cwd to this worktree. Run jest from inside the worktree. Do `prisma generate` + `tsc` atomically once at the very end (shared client via node_modules symlink).

---

## Key facts (verified against current code)

- **All four description/body surfaces store HTML** — `DescriptionEditor` commits `editor.getHTML()`. So `parseMentionedUserClerkIds(html, authorClerkId)` (HTML regex, `lib/editor/parse-mentions.ts`) works uniformly on all of them. No JSON extractor needed.
- `parseMentionedUserClerkIds` already excludes the author and `__agent__` and dedupes; returns `[]` on empty/garbage.
- `waitUntil` is imported directly from `@vercel/functions` in services (`document.service.ts:19`, `comment.service.ts:17`). Follow that pattern; wrap fire-and-forget with `.catch(() => {})`.
- `notificationRepository.createMany` (`lib/repositories/notification.repository.ts:91`) accepts `{ workspaceId, recipientActorId, type, taskId?, sprintId?, triggerActorId, commentId?, documentId?, documentCommentId? }` — **no `projectId`/`milestoneId` yet**.
- `Notification` model has `taskId/commentId/clarifyId/sprintId/documentId/documentCommentId` — **no `projectId`/`milestoneId`**.
- `NotificationType` enum lacks `PROJECT_MENTIONED`/`MILESTONE_MENTIONED`/`DOCUMENT_MENTIONED`.
- `preferenceGate.ts` maps type→preference field; mention types map to `notifyInAppMention`/`notifySlackMention`.
- Slack: `sendDMNotification(workspaceId, recipientClerkId, event, payload)`, event is `SlackEventType`; reuse `'comment_mention'`. `NotificationPayload` is task-shaped (`taskTitle/taskUrl/commentBody` reused generically).
- Author identity from `memberId`: `memberRepository.findActorByMemberId(memberId)` → actor row (has `.id`); `getActorClerkId(actorId)` from `@/lib/actor` → clerkId. Workspace slug: `workspaceRepository.findNameAndSlug(workspaceId)`.
- `buildTaskUrl` / `buildDocumentUrl` exist; **`buildProjectUrl`/`buildMilestoneUrl` do not** — create them.
- Notifications serializer: `enrichNotifications` in `lib/services/notification.service.ts:83`; mirror `task`/`sprint` serialization for `document`/`project`/`milestone`.
- `ApiNotification` (frontend): `app/workspace/[workspaceUrl]/types.ts:228` — union is stale (missing `DOCUMENT_COMMENT_MENTIONED`), lacks `document`/`project`/`milestone` refs.
- Milestone chain: `MilestoneDetailPage` (no members) → `MilestoneDetailTabs` → `MilestoneOverviewTab` (`useMentionSources([])`). `useMembers()` is `enabled:false` → must call `fetchMembers()` in an effect.
- Two jest roots: `__tests__/` and `tests/`. Run both.

---

## Phase A — Schema, repository, preference gate

### Task A1: Prisma schema — enum values + Notification columns

**Files:**
- Modify: `prisma/schema.prisma` (enum `NotificationType` ~line 82; model `Notification` ~line 702)
- Create: `prisma/migrations/<timestamp>_mention_notify_all_surfaces/migration.sql`

- [ ] **Step 1: Add enum values.** In `prisma/schema.prisma`, inside `enum NotificationType { … }` append:

```prisma
  PROJECT_MENTIONED // @mentioned in a project description
  MILESTONE_MENTIONED // @mentioned in a milestone description
  DOCUMENT_MENTIONED // @mentioned in a document body
```

- [ ] **Step 2: Add Notification columns.** In `model Notification`, after `documentCommentId String?` add:

```prisma
  projectId         String?
  milestoneId       String?
```

- [ ] **Step 3: Write the migration SQL by hand** (dev DB has known checksum drift — use the offline-migrate workaround from CLAUDE.md, do NOT `migrate dev`/`reset`). Create `prisma/migrations/<timestamp>_mention_notify_all_surfaces/migration.sql`:

```sql
-- Add new mention notification types
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROJECT_MENTIONED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MILESTONE_MENTIONED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DOCUMENT_MENTIONED';

-- Add entity reference columns for non-task mention notifications
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "milestoneId" TEXT;
```

- [ ] **Step 4: Apply offline + mark resolved** (per CLAUDE.md drift workaround; pin cwd to worktree). First export the unpooled prod/dev URL as the migration reference per `project_prisma_v7_config_db_execute_worktree` memory:

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-334-mention-notify
export DATABASE_URL_UNPOOLED="$(grep DATABASE_URL_UNPOOLED ../../.env.local | cut -d= -f2-)"
npx prisma db execute --file prisma/migrations/<timestamp>_mention_notify_all_surfaces/migration.sql --url "$DATABASE_URL_UNPOOLED"
npx prisma migrate resolve --applied <timestamp>_mention_notify_all_surfaces
```

Expected: db execute succeeds (or "already exists" no-ops); resolve records the migration.

- [ ] **Step 5: Do NOT run `prisma generate` yet** (shared client clobber). Verification of types happens at the atomic generate+tsc in Phase H. Commit:

```bash
git -C . add prisma/schema.prisma prisma/migrations
git -C . commit -m "feat: Notification projectId/milestoneId cols + 3 mention enum values [LUM-334]"
```

### Task A2: Extend `notificationRepository.createMany` input type

**Files:**
- Modify: `lib/repositories/notification.repository.ts:91-105`

- [ ] **Step 1: Add the two optional fields** to the `createMany` data array type:

```ts
  async createMany(
    data: {
      workspaceId: string
      recipientActorId: string
      type: NotificationType
      taskId?: string | null
      sprintId?: string | null
      projectId?: string | null
      milestoneId?: string | null
      triggerActorId: string | null
      commentId?: string
      documentId?: string | null
      documentCommentId?: string | null
    }[]
  ) {
    return prisma.notification.createMany({ data })
  },
```

- [ ] **Step 2: Commit** (tsc deferred to Phase H — the new fields won't typecheck against the Prisma client until `generate` runs, but `createMany` passes `data` straight through so there's no local type error in this file):

```bash
git -C . add lib/repositories/notification.repository.ts
git -C . commit -m "feat: createMany accepts projectId/milestoneId [LUM-334]"
```

### Task A3: Map new types in the preference gate

**Files:**
- Modify: `lib/notifications/preferenceGate.ts:8-36`
- Test: `__tests__/notifications/preferenceGate.mention-types.test.ts` (create)

- [ ] **Step 1: Write the failing test.** Create `__tests__/notifications/preferenceGate.mention-types.test.ts`:

```ts
import { describe, it, expect } from '@jest/globals'

// Re-export the internal maps for assertion by importing the module and
// exercising getPreferenceField indirectly via a tiny reflection. Since the
// maps are module-private, assert behavior through the public shape instead:
// import the maps by requiring the compiled mapping table.
import * as gate from '@/lib/notifications/preferenceGate'

describe('preferenceGate mention type mapping', () => {
  it('exports the new mention types mapped to the mention preference fields', () => {
    // The maps are private; assert via the exported MENTION_TYPES allowlist we add.
    expect(gate.MENTION_NOTIFICATION_TYPES).toEqual(
      expect.arrayContaining([
        'TASK_MENTIONED',
        'DOCUMENT_COMMENT_MENTIONED',
        'PROJECT_MENTIONED',
        'MILESTONE_MENTIONED',
        'DOCUMENT_MENTIONED',
      ])
    )
  })
})
```

- [ ] **Step 2: Run it, expect FAIL** (`MENTION_NOTIFICATION_TYPES` not exported):

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-334-mention-notify
npx jest __tests__/notifications/preferenceGate.mention-types.test.ts
```

Expected: FAIL — `MENTION_NOTIFICATION_TYPES` is undefined.

- [ ] **Step 3: Implement.** In `lib/notifications/preferenceGate.ts`, add the three new entries to both maps and export the allowlist constant. Add to `INAPP_MAP`:

```ts
  TASK_MENTIONED: 'notifyInAppMention',
  DOCUMENT_COMMENT_MENTIONED: 'notifyInAppMention',
  PROJECT_MENTIONED: 'notifyInAppMention',
  MILESTONE_MENTIONED: 'notifyInAppMention',
  DOCUMENT_MENTIONED: 'notifyInAppMention',
```

Add to `SLACK_MAP`:

```ts
  TASK_MENTIONED: 'notifySlackMention',
  DOCUMENT_COMMENT_MENTIONED: 'notifySlackMention',
  PROJECT_MENTIONED: 'notifySlackMention',
  MILESTONE_MENTIONED: 'notifySlackMention',
  DOCUMENT_MENTIONED: 'notifySlackMention',
```

Below the maps, export the allowlist (single source for "is this a mention type"):

```ts
export const MENTION_NOTIFICATION_TYPES = [
  'TASK_MENTIONED',
  'DOCUMENT_COMMENT_MENTIONED',
  'PROJECT_MENTIONED',
  'MILESTONE_MENTIONED',
  'DOCUMENT_MENTIONED',
] as const satisfies readonly NotificationType[]
```

- [ ] **Step 4: Run it, expect PASS:**

```bash
npx jest __tests__/notifications/preferenceGate.mention-types.test.ts
```

- [ ] **Step 5: Commit:**

```bash
git -C . add lib/notifications/preferenceGate.ts __tests__/notifications/preferenceGate.mention-types.test.ts
git -C . commit -m "feat: map new mention notification types to mention preference [LUM-334]"
```

---

## Phase B — Shared notify core + URL builders

### Task B1: URL builders for project & milestone

**Files:**
- Create: `lib/utils/buildProjectUrl.ts`
- Create: `lib/utils/buildMilestoneUrl.ts`
- Test: `__tests__/utils/buildEntityUrls.test.ts` (create)

- [ ] **Step 1: Write the failing test.** Create `__tests__/utils/buildEntityUrls.test.ts`:

```ts
import { describe, it, expect } from '@jest/globals'
import { buildProjectUrl } from '@/lib/utils/buildProjectUrl'
import { buildMilestoneUrl } from '@/lib/utils/buildMilestoneUrl'

describe('entity url builders', () => {
  it('builds a project url from workspace slug + project name', () => {
    expect(buildProjectUrl('acme', 'Backend Revamp')).toMatch(
      /\/workspace\/acme\/projects\/backend-revamp$/
    )
  })
  it('builds a milestone url scoped under its project + slug', () => {
    expect(buildMilestoneUrl('acme', 'Backend Revamp', 'v1-0')).toMatch(
      /\/workspace\/acme\/projects\/backend-revamp\/milestones\/v1-0$/
    )
  })
})
```

- [ ] **Step 2: Run it, expect FAIL** (modules don't exist):

```bash
npx jest __tests__/utils/buildEntityUrls.test.ts
```

Expected: FAIL — cannot find module `buildProjectUrl`.

- [ ] **Step 3: Implement, mirroring `buildTaskUrl`** (which reads `NEXT_PUBLIC_APP_URL` and uses `slugify`). Create `lib/utils/buildProjectUrl.ts`:

```ts
import { slugify } from '@/lib/utils/slugify'

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.uselumo.ai'

/** Absolute URL to a project's overview page. */
export function buildProjectUrl(workspaceSlug: string, projectName: string): string {
  return `${appUrl}/workspace/${workspaceSlug}/projects/${slugify(projectName)}`
}
```

Create `lib/utils/buildMilestoneUrl.ts`:

```ts
import { slugify } from '@/lib/utils/slugify'

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.uselumo.ai'

/** Absolute URL to a milestone, scoped under its project. `milestoneSlug` is the
 *  stored milestone slug (already slug-shaped). */
export function buildMilestoneUrl(
  workspaceSlug: string,
  projectName: string,
  milestoneSlug: string
): string {
  return `${appUrl}/workspace/${workspaceSlug}/projects/${slugify(projectName)}/milestones/${milestoneSlug}`
}
```

- [ ] **Step 4: Run it, expect PASS:**

```bash
npx jest __tests__/utils/buildEntityUrls.test.ts
```

- [ ] **Step 5: Commit:**

```bash
git -C . add lib/utils/buildProjectUrl.ts lib/utils/buildMilestoneUrl.ts __tests__/utils/buildEntityUrls.test.ts
git -C . commit -m "feat: buildProjectUrl + buildMilestoneUrl [LUM-334]"
```

### Task B2: The shared notify core `mention-notify.service.ts`

**Files:**
- Create: `lib/services/mention-notify.service.ts`
- Test: `__tests__/services/mention-notify.service.test.ts` (create)

This is the heart of the feature. It owns: parse old+new HTML, compute the delta (newly-added only), resolve members, preference-gate, Slack DM, inbox `createMany`, realtime push. Format-agnostic via `parseMentionedUserClerkIds` (all surfaces are HTML).

- [ ] **Step 1: Write the failing tests.** Create `__tests__/services/mention-notify.service.test.ts`:

```ts
import { describe, it, expect, jest, beforeEach } from '@jest/globals'

const findByWorkspaceAndClerkIds = jest.fn()
const createMany = jest.fn()
const shouldNotifyBatch = jest.fn()
const sendDMNotification = jest.fn()
const pushUserEvent = jest.fn()

jest.mock('@/lib/repositories', () => ({
  memberRepository: { findByWorkspaceAndClerkIds: (...a: unknown[]) => findByWorkspaceAndClerkIds(...a) },
  notificationRepository: { createMany: (...a: unknown[]) => createMany(...a) },
}))
jest.mock('@/lib/services/notification.service', () => ({
  shouldNotifyBatch: (...a: unknown[]) => shouldNotifyBatch(...a),
}))
jest.mock('@/lib/integrations/slack', () => ({
  sendDMNotification: (...a: unknown[]) => sendDMNotification(...a),
}))
jest.mock('@/lib/integrations/pusher', () => ({
  pushUserEvent: (...a: unknown[]) => pushUserEvent(...a),
}))

import { notifyMentionDelta } from '@/lib/services/mention-notify.service'

const M = (clerkId: string, actorId: string) => ({ clerkId, actor: { id: actorId } })
const span = (clerkId: string) =>
  `<span class="mention" data-mention-type="user" data-id="${clerkId}">@x</span>`

beforeEach(() => {
  jest.clearAllMocks()
  findByWorkspaceAndClerkIds.mockResolvedValue([M('u1', 'a1')])
  shouldNotifyBatch.mockResolvedValue(new Set(['a1']))
  createMany.mockResolvedValue({ count: 1 })
})

const base = {
  authorClerkId: 'author',
  authorActorId: 'authorActor',
  workspaceId: 'ws1',
  notificationType: 'PROJECT_MENTIONED' as const,
  ref: { projectId: 'p1' },
  slackEvent: 'comment_mention' as const,
  slackPayload: { taskTitle: 'Proj', taskUrl: 'http://x', commentBody: 'hi' },
  waitUntil: (p: Promise<unknown>) => { void p },
}

describe('notifyMentionDelta', () => {
  it('notifies only newly-added mentions (delta = new − old)', async () => {
    await notifyMentionDelta({ ...base, oldHtml: '', newHtml: span('u1') })
    expect(findByWorkspaceAndClerkIds).toHaveBeenCalledWith('ws1', ['u1'])
    expect(createMany).toHaveBeenCalledTimes(1)
    const rows = createMany.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(rows[0]).toMatchObject({ type: 'PROJECT_MENTIONED', projectId: 'p1', recipientActorId: 'a1' })
  })

  it('does NOT notify when the mention already existed in old content', async () => {
    await notifyMentionDelta({ ...base, oldHtml: span('u1'), newHtml: span('u1') })
    expect(findByWorkspaceAndClerkIds).not.toHaveBeenCalled()
    expect(createMany).not.toHaveBeenCalled()
  })

  it('treats null/empty old content as all-new', async () => {
    await notifyMentionDelta({ ...base, oldHtml: null, newHtml: span('u1') })
    expect(createMany).toHaveBeenCalledTimes(1)
  })

  it('excludes the author from the delta', async () => {
    await notifyMentionDelta({ ...base, oldHtml: '', newHtml: span('author') })
    expect(createMany).not.toHaveBeenCalled()
  })

  it('skips inbox row for a recipient who disabled inApp mention but still DMs if slack-enabled', async () => {
    findByWorkspaceAndClerkIds.mockResolvedValue([M('u1', 'a1'), M('u2', 'a2')])
    shouldNotifyBatch.mockImplementation((_a: unknown, ch: string) =>
      Promise.resolve(ch === 'inApp' ? new Set(['a1']) : new Set(['a1', 'a2']))
    )
    await notifyMentionDelta({ ...base, oldHtml: '', newHtml: span('u1') + span('u2') })
    expect(sendDMNotification).toHaveBeenCalledTimes(2)
    const rows = createMany.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(rows.map(r => r.recipientActorId)).toEqual(['a1'])
  })
})
```

- [ ] **Step 2: Run, expect FAIL** (module missing):

```bash
npx jest __tests__/services/mention-notify.service.test.ts
```

Expected: FAIL — cannot find module `mention-notify.service`.

- [ ] **Step 3: Implement** `lib/services/mention-notify.service.ts`:

```ts
import { parseMentionedUserClerkIds } from '@/lib/editor/parse-mentions'
import { memberRepository, notificationRepository } from '@/lib/repositories'
import { shouldNotifyBatch } from '@/lib/services/notification.service'
import { sendDMNotification } from '@/lib/integrations/slack'
import { pushUserEvent } from '@/lib/integrations/pusher'
import type { NotificationType } from '@prisma/client'
import type { SlackEventType, NotificationPayload } from '@/lib/integrations/slack/types'

/** Entity reference columns set on the inbox Notification row. Exactly one of
 *  the *Id fields is typically populated per surface. */
export interface MentionNotificationRef {
  taskId?: string | null
  projectId?: string | null
  milestoneId?: string | null
  documentId?: string | null
  commentId?: string
  documentCommentId?: string | null
}

export interface NotifyMentionDeltaParams {
  /** Prior stored HTML; '' or null when the content is brand-new (all mentions are new). */
  oldHtml: string | null
  /** Newly stored HTML. */
  newHtml: string | null
  authorClerkId: string
  authorActorId: string
  workspaceId: string
  notificationType: NotificationType
  ref: MentionNotificationRef
  slackEvent: SlackEventType
  slackPayload: NotificationPayload
  waitUntil: (promise: Promise<unknown>) => void
}

/**
 * Notify users newly @-mentioned between `oldHtml` and `newHtml`.
 *
 * Delta = mentions(new) − mentions(old). Author and __agent__ are already
 * excluded by parseMentionedUserClerkIds. Sends Slack DM (slack-enabled
 * recipients) + inbox rows (inApp-enabled recipients) + realtime push.
 * Channel broadcast is intentionally NOT done here (comment-only concern).
 */
export async function notifyMentionDelta(params: NotifyMentionDeltaParams): Promise<void> {
  const {
    oldHtml, newHtml, authorClerkId, authorActorId, workspaceId,
    notificationType, ref, slackEvent, slackPayload, waitUntil,
  } = params

  const newIds = parseMentionedUserClerkIds(newHtml ?? '', authorClerkId)
  if (newIds.length === 0) return
  const oldIds = new Set(parseMentionedUserClerkIds(oldHtml ?? '', authorClerkId))
  const delta = newIds.filter(id => !oldIds.has(id))
  if (delta.length === 0) return

  const members = await memberRepository.findByWorkspaceAndClerkIds(workspaceId, delta)
  if (members.length === 0) return

  const recipientActors = members
    .map(m => m.actor?.id)
    .filter((id): id is string => !!id)

  const [inAppAllowed, slackAllowed] = await Promise.all([
    shouldNotifyBatch(recipientActors, 'inApp', notificationType),
    shouldNotifyBatch(recipientActors, 'slack', notificationType),
  ])

  // Slack DM to slack-enabled recipients
  for (const m of members) {
    if (m.actor?.id && slackAllowed.has(m.actor.id)) {
      waitUntil(
        sendDMNotification(workspaceId, m.clerkId, slackEvent, slackPayload).catch(() => {})
      )
    }
  }

  // Inbox rows + realtime push to inApp-enabled recipients
  const inAppRecipients = recipientActors.filter(id => inAppAllowed.has(id))
  if (inAppRecipients.length === 0) return

  for (const m of members) {
    if (m.clerkId && m.actor?.id && inAppAllowed.has(m.actor.id)) {
      waitUntil(pushUserEvent(m.clerkId, { type: 'notification:new' }).catch(() => {}))
    }
  }

  await notificationRepository.createMany(
    inAppRecipients.map(recipientActorId => ({
      workspaceId,
      recipientActorId,
      type: notificationType,
      triggerActorId: authorActorId,
      ...ref,
    }))
  )
}
```

- [ ] **Step 4: Run, expect PASS:**

```bash
npx jest __tests__/services/mention-notify.service.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit:**

```bash
git -C . add lib/services/mention-notify.service.ts __tests__/services/mention-notify.service.test.ts
git -C . commit -m "feat: shared notifyMentionDelta core (diff-based mention notify) [LUM-334]"
```

---

## Phase C — Refactor the two comment notify methods to delegate

Goal: de-duplicate. Both comment paths route their core through `notifyMentionDelta` (passing `oldHtml=''`). Task comment keeps its channel broadcast locally.

### Task C1: Task-comment `notifyMentions` delegates

**Files:**
- Modify: `lib/services/comment.service.ts:129-228`
- Test: existing comment tests under `__tests__/` / `tests/` (run as regression)

- [ ] **Step 1: Identify the regression tests** that cover `notifyMentions`:

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-334-mention-notify
grep -rln "notifyMentions\|TASK_MENTIONED\|comment_mention" __tests__ tests
```

- [ ] **Step 2: Run them first to capture green baseline:**

```bash
npx jest comment
```

Expected: PASS (baseline).

- [ ] **Step 3: Rewrite `notifyMentions`** to delegate the DM+inbox+push core to `notifyMentionDelta` while keeping the channel broadcast inline. Replace the body (keeping the existing param destructure and `mentionPayload` construction) so the DM loop + `shouldNotifyBatch` + `createMany` + `pushUserEvent` are replaced by:

```ts
    // Channel notification stays here (project-level, comment-only — not gated
    // by personal preference). Fire regardless of per-user delta.
    waitUntil(
      sendChannelNotification(
        workspaceId,
        'comment_mention',
        { ...mentionPayload, taskId, taskIdentifier: `${teamIdentifier}-${taskNumber}` },
        projectId
      )
    )

    // DM + inbox + realtime via the shared core (comment create ⇒ oldHtml = '').
    await notifyMentionDelta({
      oldHtml: '',
      newHtml: body,
      authorClerkId,
      authorActorId,
      workspaceId,
      notificationType: 'TASK_MENTIONED',
      ref: { taskId, commentId },
      slackEvent: 'comment_mention',
      slackPayload: mentionPayload,
      waitUntil,
    })
```

Add the import at top: `import { notifyMentionDelta } from '@/lib/services/mention-notify.service'`. Remove now-unused locals (`recipientActors`, `inAppAllowed`/`slackAllowed`, the DM loop, the `createMany`) — but KEEP `mentionPayload`, the early `parseMentionedClerkIds(...).length === 0` guard MAY be removed (the helper guards), or keep it as a fast-path. Keep `sendChannelNotification` / `pushUserEvent` imports only if still referenced (channel still uses `sendChannelNotification`; `pushUserEvent` is now only inside the helper → remove its import here if unused). Run `tsc` mentally: ensure no unused-import error (project tsc is strict).

- [ ] **Step 4: Run regression, expect PASS** (behavior preserved — same DMs, same inbox rows, channel still fires):

```bash
npx jest comment
```

If a test asserted on the exact internal call (e.g. spied `createMany`), update it to assert the same observable outcome through the helper, OR keep the assertion if the helper still calls `createMany` (it does). Channel-broadcast assertions remain valid.

- [ ] **Step 5: Commit:**

```bash
git -C . add lib/services/comment.service.ts __tests__ tests
git -C . commit -m "refactor: task-comment notifyMentions delegates to notifyMentionDelta [LUM-334]"
```

### Task C2: Document-comment `notifyDocMentions` delegates

**Files:**
- Modify: `lib/services/documentComment.service.ts:60-128`

- [ ] **Step 1: Run doc-comment regression baseline:**

```bash
npx jest documentComment
```

Expected: PASS.

- [ ] **Step 2: Rewrite `notifyDocMentions`** to resolve `authorClerkId` (it already does via `getActorClerkId(authorActorId)`), build `docUrl` + `mentionPayload` as today, then delegate:

```ts
    await notifyMentionDelta({
      oldHtml: '',
      newHtml: body,
      authorClerkId: authorClerkId ?? '',
      authorActorId,
      workspaceId,
      notificationType: 'DOCUMENT_COMMENT_MENTIONED',
      ref: { documentId, documentCommentId },
      slackEvent: 'comment_mention',
      slackPayload: mentionPayload,
      waitUntil,
    })
```

Add `import { notifyMentionDelta } from '@/lib/services/mention-notify.service'`. Remove the now-redundant `findByWorkspaceAndClerkIds` / `shouldNotifyBatch` / DM loop / `createMany` (keep `getActorClerkId`, `buildDocumentUrl`, `mentionPayload`). Remove unused imports.

- [ ] **Step 3: Run regression, expect PASS:**

```bash
npx jest documentComment
```

- [ ] **Step 4: Commit:**

```bash
git -C . add lib/services/documentComment.service.ts
git -C . commit -m "refactor: doc-comment notifyDocMentions delegates to notifyMentionDelta [LUM-334]"
```

---

## Phase D — Wire the four description/body save paths

Each task: read old text → update → fire `notifyMentionDelta` in `waitUntil`. Author identity + workspace slug resolved from available params.

### Task D1: Project description (`PROJECT_MENTIONED`)

**Files:**
- Modify: `lib/services/project.service.ts:173-228`
- Test: `__tests__/services/project.mention-notify.test.ts` (create)

- [ ] **Step 1: Write the failing test.** Create `__tests__/services/project.mention-notify.test.ts` that mocks the repos + `notifyMentionDelta` and asserts a description update with a new mention calls the helper with `notificationType: 'PROJECT_MENTIONED'`, `ref.projectId`, and `oldHtml`=prior description / `newHtml`=new description. (Mirror the mocking style of `mention-notify.service.test.ts`; mock `@/lib/services/mention-notify.service`'s `notifyMentionDelta` as a jest.fn and assert its call args.)

```ts
import { describe, it, expect, jest, beforeEach } from '@jest/globals'

const notifyMentionDelta = jest.fn()
jest.mock('@/lib/services/mention-notify.service', () => ({
  notifyMentionDelta: (...a: unknown[]) => notifyMentionDelta(...a),
}))
// ...mock projectRepository.findById (returns { workspaceId, description: '<old>' }),
//    ensureMemberInProjectWorkspace, projectRepository.update (returns updated),
//    memberRepository.findActorByMemberId, getActorClerkId, workspaceRepository.findNameAndSlug,
//    pushWorkspaceEvent.

import { projectService } from '@/lib/services/project.service'

beforeEach(() => jest.clearAllMocks())

it('fires PROJECT_MENTIONED delta on description update', async () => {
  // arrange mocks: old description '' , new description has @u1 span
  await projectService.updateProject('p1', 'acme', 'mem1', {
    description: '<span class="mention" data-mention-type="user" data-id="u1">@u</span>',
  })
  expect(notifyMentionDelta).toHaveBeenCalledTimes(1)
  expect(notifyMentionDelta.mock.calls[0][0]).toMatchObject({
    notificationType: 'PROJECT_MENTIONED',
    ref: { projectId: 'p1' },
  })
})
```

- [ ] **Step 2: Run, expect FAIL** (helper never called):

```bash
npx jest __tests__/services/project.mention-notify.test.ts
```

- [ ] **Step 3: Implement.** In `updateProject`, capture `const oldDescription = project.description` before `projectRepository.update`. After `const updated = await projectRepository.update(...)` and the broadcast, add (resolving author + slug):

```ts
    if (input.description !== undefined) {
      const authorActor = await memberRepository.findActorByMemberId(memberId)
      const authorClerkId = authorActor?.id ? await getActorClerkId(authorActor.id) : null
      const ws = await workspaceRepository.findNameAndSlug(project.workspaceId)
      if (authorActor?.id && authorClerkId && ws?.slug) {
        const projectUrl = buildProjectUrl(ws.slug, updated.name)
        waitUntil(
          notifyMentionDelta({
            oldHtml: oldDescription ?? '',
            newHtml: input.description,
            authorClerkId,
            authorActorId: authorActor.id,
            workspaceId: project.workspaceId,
            notificationType: 'PROJECT_MENTIONED',
            ref: { projectId: project.id },
            slackEvent: 'comment_mention',
            slackPayload: {
              taskTitle: updated.name,
              taskUrl: projectUrl,
              commentBody: input.description.replace(/<[^>]+>/g, '').slice(0, 200),
            },
            waitUntil,
          })
        )
      }
    }
```

Add imports: `import { waitUntil } from '@vercel/functions'`, `import { notifyMentionDelta } from '@/lib/services/mention-notify.service'`, `import { buildProjectUrl } from '@/lib/utils/buildProjectUrl'`, `import { getActorClerkId } from '@/lib/actor'`, `import { workspaceRepository } from '@/lib/repositories/workspace.repository'` (and ensure `memberRepository` is imported — it already is for owner resolution).

- [ ] **Step 4: Run, expect PASS:**

```bash
npx jest __tests__/services/project.mention-notify.test.ts
```

- [ ] **Step 5: Commit:**

```bash
git -C . add lib/services/project.service.ts __tests__/services/project.mention-notify.test.ts
git -C . commit -m "feat: project description @mention notifications [LUM-334]"
```

### Task D2: Milestone description (`MILESTONE_MENTIONED`)

**Files:**
- Modify: `lib/services/milestone.service.ts:168-216`
- Test: `__tests__/services/milestone.mention-notify.test.ts` (create)

- [ ] **Step 1: Write the failing test** (same shape as D1, asserting `notificationType: 'MILESTONE_MENTIONED'`, `ref.milestoneId`). The milestone's `workspaceId` and owning project name come from the project: `projectService.getProject(existing.projectId, memberId)` already runs — capture its return for `workspaceId` + `name`. Mock accordingly.

- [ ] **Step 2: Run, expect FAIL:**

```bash
npx jest __tests__/services/milestone.mention-notify.test.ts
```

- [ ] **Step 3: Implement.** Capture `const project = await projectService.getProject(existing.projectId, memberId)` (replace the existing bare call so its result is bound) and `const oldDescription = existing.description`. After `const updated = await milestoneRepository.update(...)`, add:

```ts
    if (input.description !== undefined) {
      const authorActor = await memberRepository.findActorByMemberId(memberId)
      const authorClerkId = authorActor?.id ? await getActorClerkId(authorActor.id) : null
      const ws = await workspaceRepository.findNameAndSlug(project.workspaceId)
      if (authorActor?.id && authorClerkId && ws?.slug) {
        const milestoneUrl = buildMilestoneUrl(ws.slug, project.name, updated.slug)
        waitUntil(
          notifyMentionDelta({
            oldHtml: oldDescription ?? '',
            newHtml: input.description,
            authorClerkId,
            authorActorId: authorActor.id,
            workspaceId: project.workspaceId,
            notificationType: 'MILESTONE_MENTIONED',
            ref: { milestoneId: updated.id },
            slackEvent: 'comment_mention',
            slackPayload: {
              taskTitle: updated.name,
              taskUrl: milestoneUrl,
              commentBody: input.description.replace(/<[^>]+>/g, '').slice(0, 200),
            },
            waitUntil,
          })
        )
      }
    }
```

Add imports: `waitUntil`, `notifyMentionDelta`, `buildMilestoneUrl`, `getActorClerkId`, `memberRepository`, `workspaceRepository`. Confirm `project.workspaceId`, `project.name`, and `updated.slug` exist on the returned shapes (getProject returns the project incl. `workspaceId`+`name`; milestone has `slug` — confirm via `milestoneRepository` select; if `getProject` doesn't expose `workspaceId`, use `existing`'s project relation or fetch via `projectRepository.findById(existing.projectId)`).

- [ ] **Step 4: Run, expect PASS:**

```bash
npx jest __tests__/services/milestone.mention-notify.test.ts
```

- [ ] **Step 5: Commit:**

```bash
git -C . add lib/services/milestone.service.ts __tests__/services/milestone.mention-notify.test.ts
git -C . commit -m "feat: milestone description @mention notifications [LUM-334]"
```

### Task D3: Document body (`DOCUMENT_MENTIONED`)

**Files:**
- Modify: `lib/services/document.service.ts:422-554`
- Test: `__tests__/services/document.mention-notify.test.ts` (create)

- [ ] **Step 1: Write the failing test** asserting an `updateDocument` with `data.content` containing a new user mention fires `notifyMentionDelta` with `notificationType: 'DOCUMENT_MENTIONED'`, `ref.documentId`, `oldHtml`=`doc.content`, `newHtml`=`data.content`. Mock `documentRepository.findWithPermission` (returns `{ id, content: '<old>', title, slug }`), `updateWithChildrenAndMentions`, `memberRepository.findActorByMemberId`, `getActorClerkId`, `workspaceRepository.findNameAndSlug`, and the existing revision snapshot (`documentRevisionService.snapshotOnSave`).

- [ ] **Step 2: Run, expect FAIL:**

```bash
npx jest __tests__/services/document.mention-notify.test.ts
```

- [ ] **Step 3: Implement.** `doc` (old) is already fetched via `findWithPermission`. Capture `const oldContent = doc.content`. After `const updated = await documentRepository.updateWithChildrenAndMentions(...)`, alongside the existing `snapshotOnSave` waitUntil, add:

```ts
    if (data.content !== undefined) {
      const authorActor = await memberRepository.findActorByMemberId(memberId)
      const authorClerkId = authorActor?.id ? await getActorClerkId(authorActor.id) : null
      const ws = await workspaceRepository.findNameAndSlug(workspaceId)
      if (authorActor?.id && authorClerkId && ws?.slug) {
        const docUrl = buildDocumentUrl(ws.slug, updated.slug)
        waitUntil(
          notifyMentionDelta({
            oldHtml: oldContent ?? '',
            newHtml: data.content,
            authorClerkId,
            authorActorId: authorActor.id,
            workspaceId,
            notificationType: 'DOCUMENT_MENTIONED',
            ref: { documentId: docId },
            slackEvent: 'comment_mention',
            slackPayload: {
              taskTitle: updated.title ?? '',
              taskUrl: docUrl,
              commentBody: (data.content ?? '').replace(/<[^>]+>/g, '').slice(0, 200),
            },
            waitUntil,
          })
        )
      }
    }
```

Add imports: `notifyMentionDelta`, `buildDocumentUrl` (already imported? check — doc service may not import it; add if missing), `getActorClerkId`, `memberRepository`, `workspaceRepository`. `waitUntil` already imported. Note: `data.content` is HTML (web commits getHTML), so `parseMentionedUserClerkIds` works; the existing `extractTaskMentionIds` entity-sync is left untouched.

- [ ] **Step 4: Run, expect PASS:**

```bash
npx jest __tests__/services/document.mention-notify.test.ts
```

- [ ] **Step 5: Commit:**

```bash
git -C . add lib/services/document.service.ts __tests__/services/document.mention-notify.test.ts
git -C . commit -m "feat: document body @mention notifications [LUM-334]"
```

### Task D4: Task description (`TASK_MENTIONED`)

**Files:**
- Modify: `lib/services/task-state.service.ts` (`updateTask` ~54-237, or the side-effect dispatch in `task-notifications.service.ts`)
- Test: `__tests__/services/task-description.mention-notify.test.ts` (create)

Verified structure: `task-notifications.service.ts` already has a **`task:description_changed` branch** (in the activity-event builder, guarded by `input.description !== undefined && result.changedFields.includes('description')`). The dispatcher `dispatchUpdateTaskSideEffects({ taskId, input, result, taskCheck, actorId, actorClerkId })` has `waitUntil` (imported line 1), `buildTaskUrl` (imported line 11), `projectId = result.task.projectId`, and the assignee-notify branch already constructs `taskUrl = buildTaskUrl(...)` — that exact call pattern + workspace/project/team context is in scope to reuse. The **old description is `taskCheck.description`** (taskCheck is the pre-update row passed by the API route); the **new is `input.description`**.

- [ ] **Step 1: Write the failing test.** Create `__tests__/services/task-description.mention-notify.test.ts` mocking `@/lib/services/mention-notify.service`'s `notifyMentionDelta` and the dispatcher's context lookups. Call `dispatchUpdateTaskSideEffects` with `input.description` = new HTML containing a mention, `result.changedFields = ['description']`, and a `taskCheck` whose `description` is the old HTML. Assert `notifyMentionDelta` called once with `notificationType: 'TASK_MENTIONED'`, `ref: { taskId }`, `oldHtml: <taskCheck.description>`, `newHtml: <input.description>`.

- [ ] **Step 2: Run, expect FAIL:**

```bash
npx jest __tests__/services/task-description.mention-notify.test.ts
```

- [ ] **Step 3: Implement.** In the `task:description_changed` branch of `dispatchUpdateTaskSideEffects` (same guard `input.description !== undefined && result.changedFields.includes('description')`), after the existing `dispatchEvents({ type: 'task:description_changed', ... })`, add — reusing the `taskUrl`/`taskTitle`/team/project context from the assignee-notify branch above it:

```ts
      waitUntil(
        notifyMentionDelta({
          oldHtml: taskCheck.description ?? '',
          newHtml: input.description,
          authorClerkId: actorClerkId,
          authorActorId: actorId ?? '',
          workspaceId,
          notificationType: 'TASK_MENTIONED',
          ref: { taskId },
          slackEvent: 'comment_mention',
          slackPayload: {
            taskTitle: result.task.title,
            taskUrl: buildTaskUrl(workspaceSlug, projectName, result.task.teamIdentifier, result.task.number),
            commentBody: input.description.replace(/<[^>]+>/g, '').slice(0, 200),
          },
          waitUntil,
        })
      )
```

Add `import { notifyMentionDelta } from '@/lib/services/mention-notify.service'`. Use the same `workspaceId`/`workspaceSlug`/`projectName` bindings the existing assignee-notify branch already resolves for its `buildTaskUrl` call (do not re-fetch — reuse them; if they're local to that branch, lift them so the description branch can read them). `actorId` is the dispatcher param. Guard already ensures `input.description !== undefined`; the helper itself no-ops when old===new mentions, so no extra equality check needed.

- [ ] **Step 5: Run, expect PASS:**

```bash
npx jest __tests__/services/task-description.mention-notify.test.ts
```

- [ ] **Step 6: Commit:**

```bash
git -C . add lib/services/task-state.service.ts lib/services/task-notifications.service.ts __tests__/services/task-description.mention-notify.test.ts
git -C . commit -m "feat: task description @mention notifications [LUM-334]"
```

---

## Phase E — Notifications serializer + frontend types

### Task E1: Batch-fetch helpers for project/milestone/document refs

**Files:**
- Modify: `lib/repositories/notification.repository.ts` (add `batchFetchProjectsByIds`, `batchFetchMilestonesByIds`, `batchFetchDocumentsByIds` mirroring `batchFetchSprintsByIds` ~lines 110-131)

- [ ] **Step 1: Implement the three batch helpers:**

```ts
  async batchFetchProjectsByIds(ids: string[]) {
    if (ids.length === 0) return []
    return prisma.project.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, workspace: { select: { slug: true } } },
    })
  },
  async batchFetchMilestonesByIds(ids: string[]) {
    if (ids.length === 0) return []
    return prisma.milestone.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, slug: true, project: { select: { name: true, workspace: { select: { slug: true } } } } },
    })
  },
  async batchFetchDocumentsByIds(ids: string[]) {
    if (ids.length === 0) return []
    return prisma.document.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true, slug: true, workspace: { select: { slug: true } } },
    })
  },
```

- [ ] **Step 2: Commit** (typecheck deferred to Phase H):

```bash
git -C . add lib/repositories/notification.repository.ts
git -C . commit -m "feat: notification batch-fetch helpers for project/milestone/document [LUM-334]"
```

### Task E2: `enrichNotifications` serializes new refs

**Files:**
- Modify: `lib/services/notification.service.ts:83-225`
- Test: `__tests__/services/notification.enrich.test.ts` (create or extend existing)

- [ ] **Step 1: Write the failing test** asserting a `PROJECT_MENTIONED` notification row with `projectId` is serialized with a `project: { id, name, url }` reference, a `MILESTONE_MENTIONED` with `milestone`, a `DOCUMENT_MENTIONED`/`DOCUMENT_COMMENT_MENTIONED` with `document`. Mock the repo batch helpers.

- [ ] **Step 2: Run, expect FAIL:**

```bash
npx jest __tests__/services/notification.enrich.test.ts
```

- [ ] **Step 3: Implement.** In `enrichNotifications`: collect `projectIds`/`milestoneIds`/`documentIds` from `rawNotifications` (alongside the existing taskIds/commentIds/sprintIds at lines ~102-116); pass them to a widened `batchFetchRelatedData`; build `projectMap`/`milestoneMap`/`documentMap`; in the `.map(n => …)` return, add:

```ts
        projectId: n.projectId,
        milestoneId: n.milestoneId,
        documentId: n.documentId,
        project: project
          ? { id: project.id, name: project.name, url: buildProjectUrl(project.workspace.slug, project.name) }
          : null,
        milestone: milestone
          ? { id: milestone.id, name: milestone.name, url: buildMilestoneUrl(milestone.project.workspace.slug, milestone.project.name, milestone.slug) }
          : null,
        document: doc
          ? { id: doc.id, title: doc.title, url: buildDocumentUrl(doc.workspace.slug, doc.slug) }
          : null,
```

(Resolve `const project = n.projectId ? projectMap.get(n.projectId) : null`, `const milestone = n.milestoneId ? milestoneMap.get(n.milestoneId) : null`, `const doc = n.documentId ? documentMap.get(n.documentId) : null` above the return. Use `buildProjectUrl`/`buildMilestoneUrl`/`buildDocumentUrl` imports. Each batch-fetch select includes `workspace.slug` (project/milestone/document) so no ambient workspace slug is needed — `enrichNotifications(rawNotifications)` takes only the rows and has no slug in scope. Widen `batchFetchRelatedData(taskIds, commentIds, sprintIds)` → also accept `projectIds, milestoneIds, documentIds` and return `projectMap`/`milestoneMap`/`documentMap` built from the new repo helpers.)

- [ ] **Step 4: Run, expect PASS:**

```bash
npx jest __tests__/services/notification.enrich.test.ts
```

- [ ] **Step 5: Commit:**

```bash
git -C . add lib/services/notification.service.ts __tests__/services/notification.enrich.test.ts
git -C . commit -m "feat: serialize project/milestone/document refs in notifications [LUM-334]"
```

### Task E3: Extend `ApiNotification` frontend type

**Files:**
- Modify: `app/workspace/[workspaceUrl]/types.ts:228-270`

- [ ] **Step 1: Extend the `type` union** to add the missing + new members:

```ts
    | 'DOCUMENT_COMMENT_MENTIONED'
    | 'PROJECT_MENTIONED'
    | 'MILESTONE_MENTIONED'
    | 'DOCUMENT_MENTIONED'
```

- [ ] **Step 2: Add the reference fields + objects** after the existing `task`/`sprint` blocks:

```ts
  projectId: string | null
  milestoneId: string | null
  documentId: string | null
  project: { id: string; name: string; url: string } | null
  milestone: { id: string; name: string; url: string } | null
  document: { id: string; title: string; url: string } | null
```

- [ ] **Step 3: Commit:**

```bash
git -C . add app/workspace/[workspaceUrl]/types.ts
git -C . commit -m "feat: ApiNotification union + entity refs for mention types [LUM-334]"
```

---

## Phase F — Inbox rendering + i18n

### Task F1: `NotificationItem` renders new mention types

**Files:**
- Modify: `app/workspace/[workspaceUrl]/components/pages/inbox/NotificationItem.tsx`
- Test: `__tests__/components/NotificationItem.mention.test.tsx` (create)

- [ ] **Step 1: Write the failing test** rendering `NotificationItem` with a `PROJECT_MENTIONED` notification (with `project: { name, url }`) and asserting it shows the project name + the mention verb; same for `MILESTONE_MENTIONED`, `DOCUMENT_MENTIONED`, `DOCUMENT_COMMENT_MENTIONED`. (Wrap in `IntlProvider` with the en messages; the existing inbox tests show the harness pattern.)

- [ ] **Step 2: Run, expect FAIL:**

```bash
npx jest __tests__/components/NotificationItem.mention.test.tsx
```

- [ ] **Step 3: Implement.** Add the four entries to the `VERB` record (tsc enforces exhaustiveness over the widened union):

```ts
    PROJECT_MENTIONED: intlLocal.formatMessage({ id: 'notification.verb.projectMentioned', defaultMessage: 'mentioned you in' }),
    MILESTONE_MENTIONED: intlLocal.formatMessage({ id: 'notification.verb.milestoneMentioned', defaultMessage: 'mentioned you in' }),
    DOCUMENT_MENTIONED: intlLocal.formatMessage({ id: 'notification.verb.documentMentioned', defaultMessage: 'mentioned you in' }),
    DOCUMENT_COMMENT_MENTIONED: intlLocal.formatMessage({ id: 'notification.verb.documentCommentMentioned', defaultMessage: 'mentioned you in a comment on' }),
```

Destructure `project, milestone, document` from `notification`. Generalize the reference rendering (currently task/sprint only at lines ~199-221) so for the mention types it renders the entity name/title and click-navigates to `.url`. Add a branch:

```ts
{type === 'PROJECT_MENTIONED' && project ? (
  <span className='font-medium'>{project.name}</span>
) : type === 'MILESTONE_MENTIONED' && milestone ? (
  <span className='font-medium'>{milestone.name}</span>
) : (type === 'DOCUMENT_MENTIONED' || type === 'DOCUMENT_COMMENT_MENTIONED') && document ? (
  <span className='font-medium'>{document.title}</span>
) : (/* existing task / sprint rendering */)}
```

Wire the click target: the `Item`'s `onClick` should navigate to the entity `url` for these types (follow how the task notification navigates today — if navigation is by `onSelect` + parent routing, pass the url through; otherwise add an anchor). Keep `read`-flip behavior.

- [ ] **Step 4: Run, expect PASS:**

```bash
npx jest __tests__/components/NotificationItem.mention.test.tsx
```

- [ ] **Step 5: Commit:**

```bash
git -C . add app/workspace/[workspaceUrl]/components/pages/inbox/NotificationItem.tsx __tests__/components/NotificationItem.mention.test.tsx
git -C . commit -m "feat: inbox renders project/milestone/document mention notifications [LUM-334]"
```

### Task F2: i18n keys across all 16 locales

**Files:**
- Modify: `lib/i18n/en.json` (+ all 15 other locale files via sync then manual translation)

- [ ] **Step 1: Add the four keys to `lib/i18n/en.json`** (near the existing `notification.verb.*` keys ~line 891):

```json
  "notification.verb.projectMentioned": "mentioned you in",
  "notification.verb.milestoneMentioned": "mentioned you in",
  "notification.verb.documentMentioned": "mentioned you in",
  "notification.verb.documentCommentMentioned": "mentioned you in a comment on",
```

- [ ] **Step 2: Scaffold the other 15 locales:**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-334-mention-notify
npm run i18n:sync
```

- [ ] **Step 3: Replace every `[TODO:<locale>]` placeholder** for these four keys with a real translation in each of the 15 non-en locale files (CLAUDE.md: never ship the English placeholder). The verb is short ("mentioned you in" / "在……中提到了你"). Then verify parity:

```bash
npm run i18n:check
```

Expected: no drift, no remaining TODO markers for these keys.

- [ ] **Step 4: Commit:**

```bash
git -C . add lib/i18n
git -C . commit -m "i18n: mention notification verbs across 16 locales [LUM-334]"
```

---

## Phase G — Milestone @people UI

### Task G1: Thread real members into `MilestoneOverviewTab`

**Files:**
- Modify: `app/workspace/[workspaceUrl]/components/pages/MilestoneDetailPage.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/milestones/MilestoneDetailTabs.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/milestones/MilestoneOverviewTab.tsx`
- Test: `__tests__/components/MilestoneOverviewTab.test.tsx`, `__tests__/components/MilestoneDetailTabs.test.tsx`

- [ ] **Step 1: Update the failing test.** In `__tests__/components/MilestoneOverviewTab.test.tsx`, change the render to pass a non-empty `members` prop and assert the prop is forwarded into `useMentionSources` (e.g. spy/mock `useMentionSources` and assert it received the members array, not `[]`).

- [ ] **Step 2: Run, expect FAIL** (component doesn't accept `members` yet):

```bash
npx jest MilestoneOverviewTab
```

- [ ] **Step 3: Implement.**
  - `MilestoneOverviewTab.tsx`: add `members: WorkspaceMemberInfo[]` to props; change `useMentionSources([])` → `useMentionSources(members)`. Import `WorkspaceMemberInfo` from `../../types`.
  - `MilestoneDetailTabs.tsx`: add `members: WorkspaceMemberInfo[]` to `MilestoneDetailTabsProps`; forward `members={members}` into `<MilestoneOverviewTab>`.
  - `MilestoneDetailPage.tsx`: add `const { members, fetchMembers } = useMembers()` + a `useEffect(() => { void fetchMembers() }, [fetchMembers])`; pass `members={members}` into `<MilestoneDetailTabs>`. Import `useMembers` from `../../hooks/useMembers`.

- [ ] **Step 4: Update `MilestoneDetailTabs.test.tsx`** to pass the new required `members` prop (its `MilestoneOverviewTab` is mocked, so just satisfy the prop type).

- [ ] **Step 5: Run, expect PASS:**

```bash
npx jest MilestoneOverviewTab MilestoneDetailTabs
```

- [ ] **Step 6: Commit:**

```bash
git -C . add app/workspace/[workspaceUrl]/components/pages/MilestoneDetailPage.tsx app/workspace/[workspaceUrl]/components/milestones/MilestoneDetailTabs.tsx app/workspace/[workspaceUrl]/components/milestones/MilestoneOverviewTab.tsx __tests__/components/MilestoneOverviewTab.test.tsx __tests__/components/MilestoneDetailTabs.test.tsx
git -C . commit -m "feat: milestone description supports @-mentioning people [LUM-334]"
```

---

## Phase H — Full verification (atomic generate + tsc + suites + build)

### Task H1: Atomic prisma generate + tsc + full suites

**Files:** none (verification only)

- [ ] **Step 1: Regenerate the Prisma client** (now that all code is in; this clobbers the shared client, so do it once here):

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-334-mention-notify
npx prisma generate
```

- [ ] **Step 2: Typecheck:**

```bash
npx tsc --noEmit
```

Expected: 0 errors. Fix any (likely: `createMany` projectId/milestoneId now resolve against the regenerated client; VERB exhaustiveness; unused imports removed in Phase C).

- [ ] **Step 3: Run BOTH jest roots** (per memory — `__tests__/` and `tests/`):

```bash
npx jest
```

Expected: all green. (`npx jest` from the worktree root runs both roots; if a root is configured separately, run each explicitly.)

- [ ] **Step 4: i18n parity:**

```bash
npm run i18n:check
```

Expected: pass, no TODO markers.

- [ ] **Step 5: Production build** (the only CI gate is Vercel build):

```bash
npm run build
```

Expected: success.

- [ ] **Step 6: Final commit if generate produced changes** (usually none committed — generated client lives in node_modules):

```bash
git -C . status --short
# commit only source changes if any remain uncommitted
```

### Task H2: Open PR

- [ ] **Step 1: Confirm branch + push:**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-334-mention-notify
git -C . branch --show-current   # must be lumo/LUM-334-mention-notify
git -C . push -u origin lumo/LUM-334-mention-notify
```

- [ ] **Step 2: Open the PR** with title `feat: @mention notifications across all editor surfaces [LUM-334]`. Body MUST state: requires `prisma migrate deploy` on next prod deploy (adds Notification.projectId/milestoneId + 3 enum values; additive, no data deletion). List: new shared `notifyMentionDelta` core, diff-based (newly-added only) semantics, milestone @-people fix, inbox rendering for 4 mention types incl. backfilled `DOCUMENT_COMMENT_MENTIONED`. Note no new npm packages.

- [ ] **Step 3: Mark task in review:**

```bash
lumo task update LUM-334 --status in_review
```

---

## Self-review notes

- **Spec coverage:** decision 1 (diff) → B2/D*; decision 2 (per-surface types) → A1/F*; decision 3 (inbox+DM, no channel) → B2 (helper omits channel; channel stays in C1); decision 4 (reuse mention pref) → A3; decision 5 (doc-comment gap) → C2/E2/E3/F1. Milestone @people → G1. Shared helper → B2 + C1/C2 delegation.
- **Resolved during planning (previously open):** D4 — verified `task:description_changed` branch exists in `task-notifications.service.ts`; old description = `taskCheck.description`, new = `input.description`, and `buildTaskUrl`/`waitUntil`/workspace+project context are already in the dispatcher (reuse the assignee branch's bindings). E2 — `enrichNotifications(rawNotifications)` has no ambient workspace slug, so every batch-fetch select (project/milestone/document) carries `workspace.slug`; URLs built from the fetched row, not an ambient value.
- **Type consistency:** helper export is `notifyMentionDelta` everywhere; ref interface `MentionNotificationRef`; `slackEvent: 'comment_mention'` reused on every call; new enum values spelled `PROJECT_MENTIONED`/`MILESTONE_MENTIONED`/`DOCUMENT_MENTIONED` consistently across schema, preferenceGate, services, serializer, frontend union, VERB map, i18n key suffixes.
- **No new npm deps.**

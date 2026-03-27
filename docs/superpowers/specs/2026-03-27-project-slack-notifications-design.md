# Project-Level Slack Notifications — Design Spec

**Date:** 2026-03-27
**Status:** Approved

## Overview

Replace workspace-level Slack channel notifications with per-project Slack channel notifications. Each project can independently connect a Slack channel and choose which event types to receive. The Settings page retains the Slack OAuth connect/disconnect UI but no longer manages channels.

## Background

Currently `SlackChannel` records are workspace-scoped (no `projectId`). `sendChannelNotification` broadcasts to all channels in the workspace that subscribe to a given event. The goal is to scope notifications to the project a task belongs to, matching the UX pattern popularised by Linear.

---

## Data Model

### `SlackChannel` — final Prisma model after changes

The old `@@unique([integrationId, channelId])` directive is **removed**. One-per-project uniqueness is enforced by a partial DB index (see Migration). The `@@index([integrationId])` is retained.

```prisma
model SlackChannel {
  id            String   @id @default(cuid())
  integrationId String
  channelId     String
  channelName   String
  events        String[]
  projectId     String?   // null = legacy workspace-level (inert); non-null = project-level
  createdAt     DateTime  @default(now())

  integration SlackIntegration @relation(fields: [integrationId], references: [id], onDelete: Cascade)
  project     Project?         @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([integrationId])
  @@map("slack_channels")
}
```

### `Project` — add reverse relation (Prisma-only, no SQL column)

```prisma
model Project {
  // ...existing fields...
  slackChannels SlackChannel[]
}
```

### Migration SQL

```sql
-- 1. Add the new column (nullable, FK with cascade)
ALTER TABLE "slack_channels"
  ADD COLUMN "projectId" TEXT REFERENCES "projects"("id") ON DELETE CASCADE;

-- 2. Drop the old workspace-level unique constraint
DROP INDEX IF EXISTS "slack_channels_integrationId_channelId_key";

-- 3. Partial unique index: one SlackChannel per (integrationId, projectId) for non-null rows.
--    channelId is intentionally NOT part of the index — each project gets exactly one channel
--    record regardless of which Slack channel it points to; uniqueness of the Slack channelId
--    within a project is not a business requirement.
--    Because SlackIntegration is @@unique([workspaceId]), this index effectively enforces
--    one SlackChannel per project globally.
CREATE UNIQUE INDEX "slack_channels_integrationId_projectId_key"
  ON "slack_channels"("integrationId", "projectId")
  WHERE "projectId" IS NOT NULL;
```

> **Legacy rows** (`projectId = NULL`): preserved, inert, and will not match any new
> `sendChannelNotification` calls. If a legacy row exists for the same `(integrationId, channelId)`
> as a new project row, that is acceptable — the legacy row is never queried for notifications.
> Cleanup of legacy rows is deferred (out of scope).

---

## API Changes

### `GET /api/slack/channels?workspaceUrl=&projectId=`

- `projectId` is now **required**. Missing = `400 Bad Request`.
- Returns `200 { channel: SlackChannel }` if a project channel exists, `200 { channel: null }` if not.
- **Old caller** (`SlackIntegrationCard` for channel listing) is removed. **New only caller** is `ProjectSlackDialog`.

### `POST /api/slack/channels?workspaceUrl=`

- `projectId` is now **required** in the request body. Missing = `400 Bad Request`.
- The old workspace-level code path (without `projectId`) is removed.
- **Authorization:** verify `prisma.project.findFirst({ where: { id: projectId, workspaceId } })` — return `403` if the project does not belong to the caller's workspace.
- If a `SlackChannel` with that `projectId` already exists (app-level check), return `409 Conflict`.
- Also catch Prisma `P2002` (unique constraint violation from concurrent POST) and return `409 Conflict` — same response as app-level check.

### `PATCH /api/slack/channels/[id]`

Used to update an existing project channel (`channelId`, `channelName`, `events`). Avoids the DELETE+POST race window.

**Authorization (must be added/verified):** Before patching, load the `SlackChannel` and verify its `integration.workspaceId` matches the caller's workspace. Return `403` if not.

### `DELETE /api/slack/channels/[id]`

Used when the user turns the toggle OFF.

**Authorization (must be added/verified):** Same as `PATCH` — verify `integration.workspaceId` matches the caller's workspace before deleting. Return `403` if not.

### `lib/slack/notify.ts` — `sendChannelNotification`

**Signature change** — `projectId` becomes a required fourth parameter:

```ts
export async function sendChannelNotification(
  workspaceId: string,
  event: SlackEventType,
  payload: NotificationPayload,
  projectId: string // required
): Promise<void>
```

**Filtering:** Add `projectId` to the Prisma query (not just JS post-filter) so only the relevant channel is fetched:

```ts
// In the Prisma query:
channels: {
  where: { projectId, events: { has: event } },
  select: { channelId: true },
}
```

Legacy rows (`projectId = null`) never match.

**All callers must be updated.** Run `grep -r "sendChannelNotification" app/` to find all call sites. Making `projectId` required causes TypeScript compile errors at any missed call site. Known call sites:

- `app/api/webhooks/github/handlers.ts` — `task.projectId` is available on the loaded task.
- Any comment-notification code — resolve `task.projectId` before calling.

---

## UI Changes

### `SlackIntegrationCard` (Settings page)

- **Remove:** channel list, `GET /api/slack/channels` call, and "Add channel" button.
- **Add:** static note after connected state: `"Channel notifications are configured per project."`
- Legacy workspace-level `SlackChannel` rows will no longer appear in Settings UI — intentional clean break; no deprecation warning is shown.
- OAuth connect / disconnect flow unchanged.

### `ProjectDetailStandalonePage` — Slack button

Fetch `GET /api/slack/integration?workspaceUrl=` on mount to determine Slack connection status.

- **Loading:** button rendered but disabled (muted icon).
- **Not connected:** button visible and clickable; dialog shows "Connect Slack in Settings first" with a link to `/workspace/{workspaceUrl}/settings/integrations`.
- **Connected:** button active; clicking opens `ProjectSlackDialog`.

### `ProjectSlackDialog` (new component)

**Location:** `app/workspace/[workspaceUrl]/components/ProjectSlackDialog.tsx`
(Co-located with `CreateBranchDialog.tsx` and other workspace-level dialog components.)

**Props:**

```ts
interface ProjectSlackDialogProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  projectName: string
  workspaceUrl: string
}
```

**On open — two parallel fetches:**

1. `GET /api/slack/channels?workspaceUrl={workspaceUrl}&projectId={projectId}` → `{ channel: SlackChannel | null }`
2. `GET /api/slack/available-channels?workspaceUrl={workspaceUrl}` → available Slack channels

Show a loading spinner while fetching. Show an inline error with a retry button if either fetch fails.

**Initial state (when no config exists):** toggle is **OFF** by default.

**Layout:**

- Title: `Slack notifications for {projectName}`
- Toggle: `Project notifications — Send notifications to a Slack channel`
  - Off: channel selector and event list are `opacity-50 pointer-events-none`
  - On: channel selector and event list are interactive
- Channel selector: dropdown (`channelName` display, `channelId` value)
- Event checklist (7 items, labels from `SLACK_EVENT_LABELS` in `lib/slack/types.ts`):
  `task_assigned` / `task_in_review` / `task_done` / `task_sent_back` / `pr_opened` / `pr_merged` / `comment_mention`
- Save button

**Save button disabled when:**

- No changes from server state at open time.
- Toggle is ON but no channel is selected.
- Toggle is ON but no events are checked.
- User reverted toggle back to OFF (matching original OFF server state).

**Save logic:**

| Previous state        | New state                               | Action                                                                            |
| --------------------- | --------------------------------------- | --------------------------------------------------------------------------------- |
| No channel configured | Toggle ON + channel + ≥1 event          | `POST /api/slack/channels` with `projectId`, `channelId`, `channelName`, `events` |
| Channel configured    | Toggle OFF                              | `DELETE /api/slack/channels/[id]`                                                 |
| Channel configured    | Toggle ON + different channel or events | `PATCH /api/slack/channels/[id]` with `channelId`, `channelName`, `events`        |
| No changes            | —                                       | Save disabled                                                                     |

**Error handling:**

- `409 Conflict` on `POST`: re-fetch `GET /api/slack/channels?workspaceUrl=&projectId=`, update local state, switch to PATCH path, show toast "Configuration refreshed from server."
- All other errors: inline error message below Save button.
- On success: close dialog + success toast.

---

## Notification Routing

After this change, a task event in project `P` triggers
`sendChannelNotification(workspaceId, event, payload, P)`. Only the `SlackChannel` row with
`projectId = P` that includes `event` in its `events` array receives the message. Projects with
no configured channel receive no notification for that event.

---

## Out of Scope

- Multiple Slack channels per project (one enforced by the partial unique index).
- Workspace-wide "catch-all" channel (removed by design choice).
- Deleting legacy `projectId = null` rows (inert; cleanup deferred to a future migration).

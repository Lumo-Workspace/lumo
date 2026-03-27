# Project-Level Slack Notifications — Design Spec

**Date:** 2026-03-27
**Status:** Approved

## Overview

Replace workspace-level Slack channel notifications with per-project Slack channel notifications. Each project can independently connect a Slack channel and choose which event types to receive. The Settings page retains the Slack OAuth connect/disconnect UI but no longer manages channels.

## Background

Currently `SlackChannel` records are workspace-scoped (no `projectId`). `sendChannelNotification` broadcasts to all channels in the workspace that subscribe to a given event. The goal is to scope notifications to the project a task belongs to, matching the UX pattern popularised by Linear.

---

## Data Model

### `SlackChannel` — add optional `projectId`

```prisma
model SlackChannel {
  id            String   @id @default(cuid())
  integrationId String
  channelId     String
  channelName   String
  events        String[]
  projectId     String?          // null = legacy workspace-level; non-null = project-level
  createdAt     DateTime @default(now())

  integration SlackIntegration @relation(fields: [integrationId], references: [id], onDelete: Cascade)
  project     Project?         @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([integrationId, channelId, projectId])
  @@index([integrationId])
  @@map("slack_channels")
}
```

### `Project` — add reverse relation

```prisma
model Project {
  // ...existing fields...
  slackChannels SlackChannel[]
}
```

### Migration SQL

```sql
ALTER TABLE "slack_channels"
  ADD COLUMN "projectId" TEXT REFERENCES "projects"("id") ON DELETE CASCADE;

DROP INDEX IF EXISTS "slack_channels_integrationId_channelId_key";

CREATE UNIQUE INDEX "slack_channels_integrationId_channelId_projectId_key"
  ON "slack_channels"("integrationId", "channelId", "projectId");
```

Existing rows (`projectId = NULL`) are preserved and remain inert — `sendChannelNotification` will no longer send to them once callers pass `projectId`.

---

## API Changes

### `GET /api/slack/channels?workspaceUrl=&projectId=`

- New optional query param `projectId`.
- When present: return only `SlackChannel` rows where `channel.projectId = projectId`.
- When absent: return all rows (used by Settings page if needed).

### `POST /api/slack/channels?workspaceUrl=`

- Body gains optional `projectId: string`.
- Persists to `SlackChannel.projectId`.

### `DELETE /api/slack/channels/[id]` and `PATCH /api/slack/channels/[id]`

No changes required — they already operate on a specific channel by its `id`.

### `lib/slack/notify.ts` — `sendChannelNotification`

Signature change:

```ts
export async function sendChannelNotification(
  workspaceId: string,
  event: SlackEventType,
  payload: NotificationPayload,
  projectId?: string
): Promise<void>
```

Filtering logic:

```ts
const targetChannels = integration.channels.filter(c => {
  if (!c.events.includes(event)) return false
  if (projectId !== undefined) return c.projectId === projectId
  return c.projectId === null // legacy fallback
})
```

### Callers of `sendChannelNotification`

All call sites in `app/api/webhooks/github/handlers.ts` have access to `task.projectId` and must pass it as the fourth argument. Any other call sites (e.g. comment notifications) similarly pass the relevant `projectId`.

---

## UI Changes

### `SlackIntegrationCard` (Settings page)

- **Remove:** "Add channel" button and the channel list.
- **Add:** After successful connection, display a static line:
  `"Channel notifications are configured per project."`
- OAuth connect / disconnect flow is unchanged.

### `ProjectDetailStandalonePage` — Slack button

Add a Slack icon button in the project header action area (alongside any existing icon buttons). Clicking opens `ProjectSlackDialog`.

- Button is always visible when Slack is connected to the workspace.
- If Slack is not connected, button is shown but dialog displays a "Connect Slack in Settings first" prompt.

### `ProjectSlackDialog` (new component)

**Location:** `app/workspace/[workspaceUrl]/components/ProjectSlackDialog.tsx`

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

**States on open:**

1. Fetch `GET /api/slack/channels?workspaceUrl=&projectId=` to check existing config.
2. Fetch `GET /api/slack/available-channels?workspaceUrl=` to populate the channel dropdown.

**Layout:**

- Title: `Slack notifications for {projectName}`
- Toggle: `Project notifications — Send notifications to a Slack channel`
  - Off: channel selector and event list are visually disabled
  - On: channel selector and event list are interactive
- Channel selector: dropdown of available Slack channels (`channelName`)
- Event checklist (7 items using `SLACK_EVENT_LABELS`):
  - `task_assigned` / `task_in_review` / `task_done` / `task_sent_back`
  - `pr_opened` / `pr_merged` / `comment_mention`
- Save button (disabled when no changes)

**Save logic:**
| Previous state | New state | Action |
|---|---|---|
| No channel configured | Toggle ON + channel selected | `POST /api/slack/channels` with `projectId` |
| Channel configured | Toggle OFF | `DELETE /api/slack/channels/[id]` |
| Channel configured | Toggle ON + different channel or events | `DELETE` old + `POST` new |
| Channel configured | No changes | Button disabled, no-op |

---

## Notification Routing

After this change, a task event in project `P` triggers `sendChannelNotification(workspaceId, event, payload, P)`. Only the `SlackChannel` row whose `projectId = P` and `events` includes `event` receives the message. Projects with no Slack channel configured receive no Slack notification for that event.

---

## Out of Scope

- Multiple Slack channels per project (one channel per project is sufficient for now)
- Workspace-wide "catch-all" channel (removed by design choice)
- Migrating or deleting legacy workspace-level `SlackChannel` rows (they become inert; can be cleaned up later)

# Project-Level Slack Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace workspace-level Slack channel notifications with per-project Slack channel notifications, adding a `ProjectSlackDialog` accessible from each project's header.

**Architecture:** Add an optional `projectId` column to `slack_channels`, enforce one-channel-per-project with a partial unique DB index, update `sendChannelNotification` to filter by `projectId`, strip channel management from the Settings page, and add a new `ProjectSlackDialog` component opened from `ProjectDetailStandalonePage`.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma (PostgreSQL/Neon), shadcn/ui, Tailwind CSS, Sonner (toasts)

**Spec:** `docs/superpowers/specs/2026-03-27-project-slack-notifications-design.md`

---

## File Map

| File                                                                            | Action | Purpose                                                                                                              |
| ------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| `prisma/schema.prisma`                                                          | Modify | Add `projectId` to `SlackChannel`, add `slackChannels` relation to `Project`                                         |
| `prisma/migrations/20260327120000_slack_channel_project_scope/migration.sql`    | Create | Add column, drop old index, create partial unique index                                                              |
| `lib/slack/notify.ts`                                                           | Modify | Add `projectId` param to `sendChannelNotification`, filter by it in Prisma query                                     |
| `app/api/slack/channels/route.ts`                                               | Modify | `GET` requires `projectId`, returns single channel or null; `POST` requires `projectId`, validates project ownership |
| `app/api/slack/channels/[id]/route.ts`                                          | Modify | `PATCH` also allows updating `channelId`+`channelName`; auth already present                                         |
| `app/api/webhooks/github/handlers.ts`                                           | Modify | Pass `task.projectId` to all `sendChannelNotification` calls                                                         |
| `app/api/tasks/[id]/route.ts`                                                   | Modify | Pass `task.projectId` to all `sendChannelNotification` calls                                                         |
| `app/workspace/[workspaceUrl]/constants.ts`                                     | Modify | Update `API.slack.channels` to accept `projectId` param                                                              |
| `app/workspace/[workspaceUrl]/components/SlackIntegrationCard.tsx`              | Modify | Remove channel list, `fetchChannels`, `AddSlackChannelDialog`, add static note                                       |
| `app/workspace/[workspaceUrl]/components/ProjectSlackDialog.tsx`                | Create | New dialog for per-project Slack channel config                                                                      |
| `app/workspace/[workspaceUrl]/components/pages/ProjectDetailStandalonePage.tsx` | Modify | Add Slack button + Slack integration status fetch + `ProjectSlackDialog`                                             |

---

## Task 1: Database migration — add `projectId` to `slack_channels`

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260327120000_slack_channel_project_scope/migration.sql`

- [ ] **Step 1: Update `prisma/schema.prisma`**

In `SlackChannel`, remove `@@unique([integrationId, channelId])` and add `projectId`:

```prisma
model SlackChannel {
  id            String   @id @default(cuid())
  integrationId String
  channelId     String
  channelName   String
  events        String[]
  projectId     String?
  createdAt     DateTime @default(now())

  integration SlackIntegration @relation(fields: [integrationId], references: [id], onDelete: Cascade)
  project     Project?         @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([integrationId])
  @@map("slack_channels")
}
```

In `Project`, add the reverse relation (no new SQL column):

```prisma
  slackChannels  SlackChannel[]
```

- [ ] **Step 2: Create migration SQL file**

Create `prisma/migrations/20260327120000_slack_channel_project_scope/migration.sql`:

```sql
-- Add projectId column (nullable FK)
ALTER TABLE "slack_channels"
  ADD COLUMN "projectId" TEXT REFERENCES "projects"("id") ON DELETE CASCADE;

-- Drop old unique constraint
DROP INDEX IF EXISTS "slack_channels_integrationId_channelId_key";

-- Partial unique index: one channel per project (non-null rows only)
-- channelId excluded intentionally — one record per project regardless of which channel
CREATE UNIQUE INDEX "slack_channels_integrationId_projectId_key"
  ON "slack_channels"("integrationId", "projectId")
  WHERE "projectId" IS NOT NULL;
```

- [ ] **Step 3: Apply migration to dev database**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
npx prisma migrate dev --name slack_channel_project_scope
```

Expected: migration applied, Prisma client regenerated with `projectId` on `SlackChannel`.

- [ ] **Step 4: Verify Prisma client generated correctly**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260327120000_slack_channel_project_scope/
git commit -m "feat: add projectId to slack_channels for project-scoped notifications"
```

---

## Task 2: Update `sendChannelNotification` to filter by `projectId`

**Files:**

- Modify: `lib/slack/notify.ts`

- [ ] **Step 1: Update the function signature and Prisma query**

In `lib/slack/notify.ts`, change `sendChannelNotification` to require `projectId` and push the filter into the Prisma query:

```ts
export async function sendChannelNotification(
  workspaceId: string,
  event: SlackEventType,
  payload: NotificationPayload,
  projectId: string
): Promise<void> {
  try {
    // Workspace scoping is maintained via the outer findUnique({ where: { workspaceId } }).
    // The channels filter is an additional constraint on the relation — not a standalone query.
    const integration = await prisma.slackIntegration.findUnique({
      where: { workspaceId },
      select: {
        accessToken: true,
        channels: {
          where: { projectId, events: { has: event } },
          select: { channelId: true },
        },
      },
    })
    if (!integration || integration.channels.length === 0) return

    const token = decrypt(integration.accessToken)
    const blocks = buildBlocks(event, payload)

    await Promise.allSettled(
      integration.channels.map(c => postToChannel(token, c.channelId, blocks))
    )
  } catch (error) {
    console.error(
      `[slack notify] sendChannelNotification error (${event}):`,
      error
    )
  }
}
```

- [ ] **Step 2: Check TypeScript — expect compile errors at all call sites**

```bash
npx tsc --noEmit 2>&1 | grep "sendChannelNotification"
```

Expected: errors in `app/api/webhooks/github/handlers.ts`, `app/api/tasks/[id]/route.ts`, and `lib/notifications/notifyTaskInReview.ts` (all missing the 4th argument). This confirms all call sites are found.

- [ ] **Step 3: Update call sites in `app/api/webhooks/github/handlers.ts`**

The `task` object returned by `findTaskForBranch` includes `task.projectId` as a scalar column (not via the `project` relation). Use `task.projectId` (not `task.project.id`):

```ts
// line ~180: pr_opened
void sendChannelNotification(workspaceId, 'pr_opened', prOpenedPayload, task.projectId)

// line ~213: pr_merged
void sendChannelNotification(workspaceId, 'pr_merged', mergePayload, task.projectId)

// line ~214: task_done
void sendChannelNotification(workspaceId, 'task_done', { ... }, task.projectId)
```

- [ ] **Step 4: Update call sites in `app/api/tasks/[id]/route.ts`**

There are 4 calls: `task_assigned` (×1), `task_sent_back` (×2, for both `IN_PROGRESS` and `TODO` transitions), `task_done` (×1). The `task` object has `projectId` as a scalar column:

```ts
// task_assigned
void sendChannelNotification(workspaceId, 'task_assigned', { ... }, task.projectId)

// task_sent_back (appears twice for different status transitions)
void sendChannelNotification(workspaceId, 'task_sent_back', { ... }, task.projectId)

// task_done
void sendChannelNotification(workspaceId, 'task_done', dmPayload, task.projectId)
```

- [ ] **Step 5: Update call site in `lib/notifications/notifyTaskInReview.ts`**

This file has a `sendChannelNotification(wsId, 'task_in_review', {...})` call. It needs `projectId` as the 4th argument. The `taskForSlack` query must be updated to also select `projectId`:

```ts
// In the Prisma query, add projectId to select:
const taskForSlack = await prisma.task.findUnique({
  where: { id: taskId },
  select: {
    title: true,
    number: true,
    projectId: true, // ← add this
    team: {
      select: {
        identifier: true,
        workspace: { select: { id: true, slug: true } },
      },
    },
  },
})

// Then pass it to the call:
void sendChannelNotification(
  wsId,
  'task_in_review',
  {
    taskId,
    taskTitle: taskForSlack.title,
    taskIdentifier: identifier,
    taskUrl,
  },
  taskForSlack.projectId
) // ← add this
```

- [ ] **Step 6: Verify no remaining compile errors**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/slack/notify.ts lib/notifications/notifyTaskInReview.ts app/api/webhooks/github/handlers.ts 'app/api/tasks/[id]/route.ts'
git commit -m "feat: scope sendChannelNotification to projectId"
```

---

## Task 3: Update Slack channel API routes

**Files:**

- Modify: `app/api/slack/channels/route.ts`
- Modify: `app/api/slack/channels/[id]/route.ts`

- [ ] **Step 1: Rewrite `GET /api/slack/channels` to require `projectId`**

Replace the existing `GET` handler in `app/api/slack/channels/route.ts`:

```ts
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const workspaceUrl = request.nextUrl.searchParams.get('workspaceUrl')
    const projectId = request.nextUrl.searchParams.get('projectId')
    if (!workspaceUrl || !projectId)
      return NextResponse.json(
        { error: 'workspaceUrl and projectId are required' },
        { status: 400 }
      )

    const ws = await getUserWorkspace(userId)
    if (!ws || ws.workspace.slug !== workspaceUrl)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const integration = await prisma.slackIntegration.findUnique({
      where: { workspaceId: ws.workspaceId },
      select: { id: true },
    })
    if (!integration)
      return NextResponse.json({ error: 'Not connected' }, { status: 404 })

    const channel = await prisma.slackChannel.findFirst({
      where: { integrationId: integration.id, projectId },
      select: { id: true, channelId: true, channelName: true, events: true },
    })

    return NextResponse.json({ channel: channel ?? null })
  } catch (error) {
    console.error('GET /api/slack/channels error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Rewrite `POST /api/slack/channels` to require `projectId` and validate ownership**

Replace the existing `POST` handler:

```ts
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const workspaceUrl = request.nextUrl.searchParams.get('workspaceUrl')
    if (!workspaceUrl)
      return NextResponse.json(
        { error: 'workspaceUrl is required' },
        { status: 400 }
      )

    const ws = await getUserWorkspace(userId)
    if (!ws || ws.workspace.slug !== workspaceUrl)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const channelId: string = body.channelId ?? ''
    const channelName: string = body.channelName ?? ''
    const projectId: string = body.projectId ?? ''
    const rawEvents: unknown[] = Array.isArray(body.events)
      ? body.events
      : ALL_SLACK_EVENTS
    const events = rawEvents.filter((e): e is SlackEventType =>
      ALL_SLACK_EVENTS.includes(e as SlackEventType)
    )

    if (!channelId || !channelName || !projectId)
      return NextResponse.json(
        { error: 'channelId, channelName, and projectId are required' },
        { status: 400 }
      )
    if (events.length === 0)
      return NextResponse.json(
        { error: 'At least one valid event is required' },
        { status: 400 }
      )

    // Verify project belongs to this workspace
    const project = await prisma.project.findFirst({
      where: { id: projectId, workspaceId: ws.workspaceId },
    })
    if (!project)
      return NextResponse.json({ error: 'Project not found' }, { status: 403 })

    const integration = await prisma.slackIntegration.findUnique({
      where: { workspaceId: ws.workspaceId },
      select: { id: true },
    })
    if (!integration)
      return NextResponse.json({ error: 'Not connected' }, { status: 404 })

    // App-level check before DB insert
    const existing = await prisma.slackChannel.findFirst({
      where: { integrationId: integration.id, projectId },
    })
    if (existing)
      return NextResponse.json(
        { error: 'Channel already configured for this project' },
        { status: 409 }
      )

    const channel = await prisma.slackChannel.create({
      data: {
        integrationId: integration.id,
        channelId,
        channelName,
        events,
        projectId,
      },
      select: {
        id: true,
        channelId: true,
        channelName: true,
        events: true,
        projectId: true,
      },
    })

    return NextResponse.json({ channel }, { status: 201 })
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      return NextResponse.json(
        { error: 'Channel already configured for this project' },
        { status: 409 }
      )
    }
    console.error('POST /api/slack/channels error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 3: Update `PATCH /api/slack/channels/[id]` to also allow updating `channelId` and `channelName`**

In `app/api/slack/channels/[id]/route.ts`, update the `PATCH` handler's data object:

```ts
// Replace the update call with:
const updated = await prisma.slackChannel.update({
  where: { id },
  data: {
    ...(body.channelId ? { channelId: body.channelId } : {}),
    ...(body.channelName ? { channelName: body.channelName } : {}),
    events,
  },
  select: {
    id: true,
    channelId: true,
    channelName: true,
    events: true,
    projectId: true,
  },
})
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/slack/channels/route.ts 'app/api/slack/channels/[id]/route.ts'
git commit -m "feat: update Slack channel API routes for project-scoped configuration"
```

---

## Task 4: Update `API.slack.channels` constant and clean up `SlackIntegrationCard`

**Files:**

- Modify: `app/workspace/[workspaceUrl]/constants.ts`
- Modify: `app/workspace/[workspaceUrl]/components/SlackIntegrationCard.tsx`

- [ ] **Step 1: Update `API.slack.channels` in `constants.ts`**

`API.slack.channels` is currently called only in `SlackIntegrationCard` (confirmed by grep — both call sites are being removed in Step 2). Change the signature to accept `projectId`:

```ts
// Before:
channels: (workspaceUrl: string) => `/api/slack/channels?workspaceUrl=${workspaceUrl}`,

// After:
channels: (workspaceUrl: string, projectId: string) =>
  `/api/slack/channels?workspaceUrl=${workspaceUrl}&projectId=${encodeURIComponent(projectId)}`,
```

- [ ] **Step 2: Strip channel management from `SlackIntegrationCard`**

Remove from `SlackIntegrationCard.tsx`:

- `channels` state and `fetchChannels` callback
- `useEffect` that calls `fetchChannels`
- `handleRemoveChannel` function
- `addChannelOpen` state
- `AddSlackChannelDialog` import and usage
- The channel list JSX (the `ul` rendering channels with remove buttons)

Add in the connected state section, after the workspace name line:

```tsx
<p className='text-xs text-zinc-400 dark:text-zinc-500'>
  Channel notifications are configured per project.
</p>
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors (the old `API.slack.channels(workspaceUrl)` calls in `SlackIntegrationCard` are removed, so no arity breakage).

- [ ] **Step 4: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/constants.ts app/workspace/\[workspaceUrl\]/components/SlackIntegrationCard.tsx
git commit -m "feat: remove workspace-level channel management from Slack settings card"
```

---

## Task 5: Build `ProjectSlackDialog`

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/ProjectSlackDialog.tsx`

- [ ] **Step 1: Create the component file**

Create `app/workspace/[workspaceUrl]/components/ProjectSlackDialog.tsx` with this full implementation:

```tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { API } from '../constants'
import {
  ALL_SLACK_EVENTS,
  SLACK_EVENT_LABELS,
  SlackEventType,
} from '@/lib/slack/types'

interface ProjectSlackDialogProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  projectName: string
  workspaceUrl: string
}

interface AvailableChannel {
  id: string
  name: string
  private: boolean
}

interface SavedChannel {
  id: string
  channelId: string
  channelName: string
  events: SlackEventType[]
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | {
      phase: 'ready'
      savedChannel: SavedChannel | null
      availableChannels: AvailableChannel[]
    }

export function ProjectSlackDialog({
  isOpen,
  onClose,
  projectId,
  projectName,
  workspaceUrl,
}: ProjectSlackDialogProps) {
  const [loadState, setLoadState] = useState<LoadState>({ phase: 'loading' })
  const [enabled, setEnabled] = useState(false)
  const [selectedChannelId, setSelectedChannelId] = useState('')
  const [selectedChannelName, setSelectedChannelName] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<SlackEventType[]>([
    ...ALL_SLACK_EVENTS,
  ])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!isOpen) return
    setLoadState({ phase: 'loading' })
    try {
      const [channelRes, availableRes] = await Promise.all([
        fetch(API.slack.channels(workspaceUrl, projectId)),
        fetch(API.slack.availableChannels(workspaceUrl)),
      ])
      if (!channelRes.ok || !availableRes.ok) throw new Error()
      const channelData = (await channelRes.json()) as {
        channel: SavedChannel | null
      }
      const availableData = (await availableRes.json()) as {
        channels: AvailableChannel[]
      }
      const saved = channelData.channel

      setLoadState({
        phase: 'ready',
        savedChannel: saved,
        availableChannels: availableData.channels ?? [],
      })

      // Initialise form from saved state
      if (saved) {
        setEnabled(true)
        setSelectedChannelId(saved.channelId)
        setSelectedChannelName(saved.channelName)
        setSelectedEvents(saved.events as SlackEventType[])
      } else {
        setEnabled(false)
        setSelectedChannelId('')
        setSelectedChannelName('')
        setSelectedEvents([...ALL_SLACK_EVENTS])
      }
    } catch {
      setLoadState({ phase: 'error' })
    }
  }, [isOpen, workspaceUrl, projectId])

  useEffect(() => {
    if (isOpen) {
      setSaveError(null)
      load()
    }
  }, [isOpen, load])

  const handleChannelSelect = (
    channelId: string,
    channels: AvailableChannel[]
  ) => {
    const ch = channels.find(c => c.id === channelId)
    if (!ch) return
    setSelectedChannelId(ch.id)
    setSelectedChannelName(ch.name)
  }

  const toggleEvent = (event: SlackEventType) => {
    setSelectedEvents(prev =>
      prev.includes(event) ? prev.filter(e => e !== event) : [...prev, event]
    )
  }

  const isDirty = (savedChannel: SavedChannel | null): boolean => {
    if (!enabled && !savedChannel) return false
    if (!enabled && savedChannel) return true
    if (enabled && !savedChannel)
      return selectedChannelId !== '' && selectedEvents.length > 0
    if (!savedChannel) return false
    if (selectedChannelId !== savedChannel.channelId) return true
    const sortedNew = [...selectedEvents].sort().join(',')
    const sortedOld = [...savedChannel.events].sort().join(',')
    return sortedNew !== sortedOld
  }

  const isSaveDisabled = (savedChannel: SavedChannel | null): boolean => {
    if (saving) return true
    if (!isDirty(savedChannel)) return true
    if (enabled && !selectedChannelId) return true
    if (enabled && selectedEvents.length === 0) return true
    return false
  }

  const handleSave = async (savedChannel: SavedChannel | null) => {
    setSaving(true)
    setSaveError(null)
    try {
      if (!enabled && savedChannel) {
        // Toggle OFF → DELETE
        const res = await fetch(API.slack.channelById(savedChannel.id), {
          method: 'DELETE',
        })
        if (!res.ok) throw new Error('Failed to remove channel')
      } else if (enabled && !savedChannel) {
        // New config → POST
        const res = await fetch(
          `/api/slack/channels?workspaceUrl=${workspaceUrl}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              channelId: selectedChannelId,
              channelName: selectedChannelName,
              events: selectedEvents,
              projectId,
            }),
          }
        )
        if (res.status === 409) {
          // Concurrent POST — re-fetch and switch to PATCH
          await load()
          toast.info('Configuration refreshed from server')
          return
        }
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string
          }
          throw new Error(data.error ?? 'Failed to save')
        }
      } else if (enabled && savedChannel) {
        // Update → PATCH
        const res = await fetch(API.slack.channelById(savedChannel.id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channelId: selectedChannelId,
            channelName: selectedChannelName,
            events: selectedEvents,
          }),
        })
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string
          }
          throw new Error(data.error ?? 'Failed to save')
        }
      }
      toast.success('Slack notifications updated')
      onClose()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            Slack notifications for {projectName}
          </DialogTitle>
          <DialogDescription>
            Send notifications to a Slack channel when events occur in this
            project.
          </DialogDescription>
        </DialogHeader>

        {loadState.phase === 'loading' && (
          <div className='flex items-center justify-center py-8'>
            <Loader2 size={20} className='animate-spin text-zinc-400' />
          </div>
        )}

        {loadState.phase === 'error' && (
          <div className='space-y-3 py-2'>
            <p className='text-sm text-red-600 dark:text-red-400'>
              Failed to load configuration.
            </p>
            <Button variant='outline' className='w-full' onClick={load}>
              Retry
            </Button>
          </div>
        )}

        {loadState.phase === 'ready' && (
          <div className='space-y-4 py-2'>
            {/* Toggle */}
            <div className='flex items-center justify-between'>
              <div>
                <p className='text-sm font-medium text-zinc-900 dark:text-zinc-100'>
                  Project notifications
                </p>
                <p className='text-xs text-zinc-500 dark:text-zinc-400'>
                  Send notifications to a Slack channel.
                </p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>

            {/* Channel + events (disabled when toggle OFF) */}
            <div className={enabled ? '' : 'opacity-50 pointer-events-none'}>
              {/* Channel selector */}
              <div className='space-y-1.5 mb-4'>
                <label className='text-xs font-medium text-zinc-500 dark:text-zinc-400'>
                  Channel
                </label>
                <select
                  value={selectedChannelId}
                  onChange={e =>
                    handleChannelSelect(
                      e.target.value,
                      loadState.availableChannels
                    )
                  }
                  className='w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-400'
                >
                  <option value=''>Select a channel…</option>
                  {loadState.availableChannels.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.private ? ' (private)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Event checklist */}
              <div className='space-y-2'>
                <p className='text-xs font-medium text-zinc-500 dark:text-zinc-400'>
                  Notify on
                </p>
                {ALL_SLACK_EVENTS.map(event => (
                  <label
                    key={event}
                    className='flex items-center gap-2 cursor-pointer'
                  >
                    <input
                      type='checkbox'
                      checked={selectedEvents.includes(event)}
                      onChange={() => toggleEvent(event)}
                      className='rounded border-zinc-300 dark:border-zinc-600 text-zinc-900'
                    />
                    <span className='text-sm text-zinc-700 dark:text-zinc-300'>
                      {SLACK_EVENT_LABELS[event]}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {saveError && (
              <p className='text-xs text-red-600 dark:text-red-400'>
                {saveError}
              </p>
            )}

            <Button
              className='w-full'
              onClick={() => handleSave(loadState.savedChannel)}
              disabled={isSaveDisabled(loadState.savedChannel)}
            >
              {saving ? (
                <Loader2 size={14} className='animate-spin mr-2' />
              ) : null}
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/ProjectSlackDialog.tsx
git commit -m "feat: add ProjectSlackDialog for per-project Slack channel configuration"
```

---

## Task 6: Add Slack button to `ProjectDetailStandalonePage`

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/ProjectDetailStandalonePage.tsx`

- [ ] **Step 1: Add Slack integration status fetch and state**

Add to the imports at the top of the file:

```tsx
import { Slack } from 'lucide-react'
import { ProjectSlackDialog } from '../ProjectSlackDialog'
```

Add state variables after the existing `useState` declarations:

```tsx
const [slackConnected, setSlackConnected] = useState<boolean | null>(null) // null = loading
const [slackDialogOpen, setSlackDialogOpen] = useState(false)
```

Add a fetch inside the existing `useEffect` on mount (add to the `Promise.all` array):

```tsx
fetch(API.slack.integration(workspaceUrl)).then(r => (r.ok ? r.json() : null)),
```

And handle the result:

```tsx
// In the .then() destructure:
const [membersData, tasksData, projectsData, slackData] = ...
// Add:
if (slackData !== null) setSlackConnected(slackData.connected === true)
```

- [ ] **Step 2: Add the Slack button to the breadcrumb header**

In the breadcrumb `<div>` (the one containing the copy-link button, around line 246), add the Slack button alongside it:

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <Button
      variant='ghost'
      size='icon'
      onClick={() => setSlackDialogOpen(true)}
      disabled={slackConnected === null}
      className='h-7 w-7 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-30'
    >
      <Slack size={14} />
    </Button>
  </TooltipTrigger>
  <TooltipContent>
    {slackConnected === false
      ? 'Connect Slack in Settings first'
      : 'Slack notifications'}
  </TooltipContent>
</Tooltip>
```

- [ ] **Step 3: Add `ProjectSlackDialog` to the render output**

After the closing `</SidebarInset>` tag (before the final `</SidebarProvider>`), add:

```tsx
<ProjectSlackDialog
  isOpen={slackDialogOpen}
  onClose={() => setSlackDialogOpen(false)}
  projectId={project.id}
  projectName={project.name}
  workspaceUrl={workspaceUrl}
/>
```

- [ ] **Step 4: Handle "not connected" click — open dialog to show connect message**

When `slackConnected === false`, the button is still enabled (remove `disabled` check above). Instead, the dialog handles this case. Update `ProjectSlackDialog` to detect when it's opened without `availableChannels` reachable due to 404 from integration:

In `load()` inside `ProjectSlackDialog`, if `availableRes.status === 404`:

```tsx
setLoadState({
  phase: 'ready',
  savedChannel: null,
  availableChannels: [],
})
setEnabled(false)
```

And in the `ready` render, if `availableChannels.length === 0 && !loadState.savedChannel`:

```tsx
<p className='text-sm text-zinc-500 dark:text-zinc-400'>
  Slack is not connected to this workspace.{' '}
  <a
    href={`/workspace/${workspaceUrl}/settings/integrations`}
    className='text-blue-600 dark:text-blue-400 hover:underline'
  >
    Connect it in Settings →
  </a>
</p>
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/pages/ProjectDetailStandalonePage.tsx
git commit -m "feat: add Slack notifications button to project detail page"
```

---

## Task 7: Apply migration to production database

- [ ] **Step 1: Apply the migration SQL directly to the production Neon database**

The production DB uses the connection string from `.env.production`. Apply the migration manually (the same pattern used for previous migrations in this project):

```bash
node -e "
const { Client } = require('pg')
require('dotenv').config({ path: '.env.production' })
const client = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED })
client.connect().then(async () => {
  await client.query(\`
    ALTER TABLE \"slack_channels\"
      ADD COLUMN IF NOT EXISTS \"projectId\" TEXT REFERENCES \"projects\"(\"id\") ON DELETE CASCADE;
    DROP INDEX IF EXISTS \"slack_channels_integrationId_channelId_key\";
    CREATE UNIQUE INDEX IF NOT EXISTS \"slack_channels_integrationId_projectId_key\"
      ON \"slack_channels\"(\"integrationId\", \"projectId\")
      WHERE \"projectId\" IS NOT NULL;
  \`)
  console.log('Migration applied')
  await client.end()
}).catch(e => { console.error(e); process.exit(1) })
"
```

Expected output: `Migration applied`

- [ ] **Step 2: Commit**

```bash
git commit --allow-empty -m "chore: production DB migration applied for slack_channel_project_scope"
```

---

## Final Verification

- [ ] Run `npx tsc --noEmit` — zero errors
- [ ] Open a project detail page → Slack button appears in header
- [ ] Click button when Slack not connected → dialog shows connect link
- [ ] Click button when Slack connected → dialog loads, toggle OFF by default
- [ ] Toggle ON, select channel, select events, Save → `POST` succeeds, toast shown, dialog closes
- [ ] Reopen dialog → toggle is ON, saved channel and events shown
- [ ] Change channel, Save → `PATCH` succeeds
- [ ] Toggle OFF, Save → `DELETE` succeeds; reopen → toggle OFF
- [ ] Settings → Integrations → Slack card shows "Channel notifications are configured per project." with no channel list
- [ ] Task event (e.g. PR merge) on a project with a configured Slack channel → notification arrives in that channel only

# Slack Integration — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Slack OAuth connection, channel management, and Settings UI — the foundation for bot and notification features.

**Architecture:** Workspace-level SlackIntegration stored in Prisma (one per Lumo workspace). OAuth flow mirrors GitHub integration. Channel subscriptions stored in SlackChannel model. Settings UI in IntegrationsPage.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma/Neon, Tailwind CSS, shadcn/ui, lucide-react, Clerk auth, lib/crypto.ts (AES-256-GCM).

---

## Spec reference

`docs/superpowers/specs/2026-03-27-slack-integration-design.md`

---

## Task 1: Prisma Schema + Migration

**Files:** `prisma/schema.prisma`

- [ ] **1.1** Open `prisma/schema.prisma`. After the `GitHubWebhook` model block (around line 344), add the `SlackIntegration` model:

  ```prisma
  model SlackIntegration {
    id            String   @id @default(cuid())
    workspaceId   String   @unique
    installedBy   String?
    installer     WorkspaceMember @relation("SlackInstaller", fields: [installedBy], references: [id], onDelete: SetNull)
    accessToken   String
    slackTeamId   String
    slackTeamName String
    slackUserId   String
    createdAt     DateTime @default(now())
    updatedAt     DateTime @updatedAt

    workspace Workspace      @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
    channels  SlackChannel[]

    @@index([slackTeamId])
    @@map("slack_integrations")
  }
  ```

- [ ] **1.2** Immediately after the `SlackIntegration` model, add the `SlackChannel` model:

  ```prisma
  model SlackChannel {
    id            String   @id @default(cuid())
    integrationId String
    channelId     String
    channelName   String
    events        String[]
    createdAt     DateTime @default(now())

    integration SlackIntegration @relation(fields: [integrationId], references: [id], onDelete: Cascade)

    @@unique([integrationId, channelId])
    @@index([integrationId])
    @@map("slack_channels")
  }
  ```

- [ ] **1.3** In the `Workspace` model (around line 59), add `slackIntegration SlackIntegration?` to the relations list (after `githubIntegrations GitHubIntegration[]`).

  Expected result: the Workspace model relations block includes:

  ```prisma
  githubIntegrations GitHubIntegration[]
  pullRequests       PullRequest[]
  slackIntegration   SlackIntegration?
  ```

- [ ] **1.4** In the `WorkspaceMember` model (around line 114), add `slackInstalled SlackIntegration[] @relation("SlackInstaller")` to the relations list (after `githubIntegrations GitHubIntegration[]`).

  Expected result: the WorkspaceMember model relations block includes:

  ```prisma
  githubIntegrations     GitHubIntegration[]
  slackInstalled         SlackIntegration[] @relation("SlackInstaller")
  ```

- [ ] **1.5** Run the migration from the `lumo/` app directory:

  ```bash
  cd /Users/chaoli/Desktop/lumo/lumo
  export $(grep -v '^#' .env.local | xargs) && npx prisma migrate dev --name add_slack_integration
  ```

  Expected output contains:

  ```
  The following migration(s) have been created and applied from new schema changes:

  migrations/
    └─ 20260327......_add_slack_integration/
      └─ migration.sql

  Your database is now in sync with your schema.

  ✔ Generated Prisma Client
  ```

- [ ] **1.6** Verify the Prisma client was regenerated with the new models:

  ```bash
  cd /Users/chaoli/Desktop/lumo/lumo
  node -e "const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); console.log(typeof p.slackIntegration, typeof p.slackChannel);"
  ```

  Expected output: `object object`

- [ ] **1.7** Commit:

  ```bash
  cd /Users/chaoli/Desktop/lumo/lumo
  git add prisma/ && git commit -m "feat: add SlackIntegration and SlackChannel Prisma models"
  ```

---

## Task 2: Shared Types

**Files:** Create `lib/slack/types.ts`

- [ ] **2.1** Create the directory and file `lib/slack/types.ts` with the following content:

  ```typescript
  export type SlackEventType =
    | 'task_assigned'
    | 'task_in_review'
    | 'task_done'
    | 'task_sent_back'
    | 'pr_opened'
    | 'pr_merged'
    | 'comment_mention'

  export const ALL_SLACK_EVENTS: SlackEventType[] = [
    'task_assigned',
    'task_in_review',
    'task_done',
    'task_sent_back',
    'pr_opened',
    'pr_merged',
    'comment_mention',
  ]

  export const SLACK_EVENT_LABELS: Record<SlackEventType, string> = {
    task_assigned: 'Task assigned',
    task_in_review: 'Task in review',
    task_done: 'Task done',
    task_sent_back: 'Task sent back',
    pr_opened: 'PR opened',
    pr_merged: 'PR merged',
    comment_mention: 'Comment mention',
  }

  export interface NotificationPayload {
    taskId?: string
    taskTitle?: string
    taskIdentifier?: string // e.g. "ENG-123"
    taskUrl?: string // full URL to task in Lumo
    actorName?: string // display name of who triggered the event
    prNumber?: number
    prTitle?: string
    prUrl?: string
    commentBody?: string
  }
  ```

- [ ] **2.2** Commit:

  ```bash
  cd /Users/chaoli/Desktop/lumo/lumo
  git add lib/slack/types.ts && git commit -m "feat: add shared Slack types"
  ```

- [ ] **Step 2: TypeScript check**
  ```bash
  npx tsc --noEmit 2>&1 | grep -v node_modules
  ```
  Expected: no errors.

---

## Task 3: OAuth Routes

**Files:**

- Create `app/api/slack/oauth/route.ts`
- Create `app/api/slack/callback/route.ts`
- Create `app/api/slack/integration/route.ts`

### 3.1 — `app/api/slack/oauth/route.ts`

- [ ] **3.1** Create `app/api/slack/oauth/route.ts`:

  ```typescript
  import { NextRequest, NextResponse } from 'next/server'
  import { requireAuth, getUserWorkspace } from '@/lib/auth'
  import { encrypt } from '@/lib/crypto'

  const SLACK_SCOPES = [
    'chat:write',
    'channels:read',
    'users:read',
    'users:read.email',
    'app_mentions:read',
    'commands',
    'im:write',
  ].join(',')

  export async function GET(request: NextRequest) {
    try {
      const authResult = await requireAuth()
      if (authResult instanceof NextResponse) return authResult
      const { userId } = authResult

      const workspaceUrl = request.nextUrl.searchParams.get('workspaceUrl')
      if (!workspaceUrl) {
        return NextResponse.json(
          { error: 'workspaceUrl is required' },
          { status: 400 }
        )
      }

      const ws = await getUserWorkspace(userId)
      if (!ws || ws.workspace.slug !== workspaceUrl) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const state = encrypt(
        JSON.stringify({
          workspaceId: ws.workspaceId,
          memberId: ws.member.id,
          workspaceUrl,
        })
      )
      const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/slack/callback`

      const params = new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID!,
        scope: SLACK_SCOPES,
        redirect_uri: redirectUri,
        state,
      })

      return NextResponse.redirect(
        `https://slack.com/oauth/v2/authorize?${params}`
      )
    } catch (error) {
      console.error('GET /api/slack/oauth error:', error)
      return NextResponse.json(
        { error: 'Internal Server Error' },
        { status: 500 }
      )
    }
  }
  ```

  **Pattern notes (mirrors `app/api/github/oauth/route.ts`):**
  - `requireAuth()` → guard, extract `userId`
  - `getUserWorkspace(userId)` → look up workspace, verify slug
  - `encrypt(JSON.stringify({ workspaceId, memberId, workspaceUrl }))` → CSRF-safe state
  - Redirect to `https://slack.com/oauth/v2/authorize` with scopes, `redirect_uri`, and `state`

### 3.2 — `app/api/slack/callback/route.ts`

- [ ] **3.2** Create `app/api/slack/callback/route.ts`:

  ```typescript
  import { NextRequest, NextResponse } from 'next/server'
  import { prisma } from '@/lib/db/prisma'
  import { decrypt, encrypt } from '@/lib/crypto'

  export async function GET(request: NextRequest) {
    const code = request.nextUrl.searchParams.get('code')
    const stateParam = request.nextUrl.searchParams.get('state')
    const error = request.nextUrl.searchParams.get('error')

    // Handle user denial
    if (error) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/?slack_error=1`
      )
    }

    if (!code || !stateParam) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/?slack_error=1`
      )
    }

    try {
      const { workspaceId, memberId, workspaceUrl } = JSON.parse(
        decrypt(stateParam)
      ) as {
        workspaceId: string
        memberId: string
        workspaceUrl: string
      }

      const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/slack/callback`

      const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.SLACK_CLIENT_ID!,
          client_secret: process.env.SLACK_CLIENT_SECRET!,
          code,
          redirect_uri: redirectUri,
        }),
      })

      const tokenData = await tokenRes.json()
      if (!tokenData.ok) {
        console.error(
          '[slack callback] token exchange failed:',
          tokenData.error
        )
        return NextResponse.redirect(
          `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${workspaceUrl}/settings/integrations?slack_error=1`
        )
      }

      const encryptedToken = encrypt(tokenData.access_token)

      await prisma.slackIntegration.upsert({
        where: { workspaceId },
        create: {
          workspaceId,
          installedBy: memberId,
          accessToken: encryptedToken,
          slackTeamId: tokenData.team.id,
          slackTeamName: tokenData.team.name,
          slackUserId: tokenData.authed_user.id,
        },
        update: {
          installedBy: memberId,
          accessToken: encryptedToken,
          slackTeamId: tokenData.team.id,
          slackTeamName: tokenData.team.name,
          slackUserId: tokenData.authed_user.id,
        },
      })

      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${workspaceUrl}/settings/integrations?slack_connected=1`
      )
    } catch (error) {
      console.error('GET /api/slack/callback error:', error)
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/?slack_error=1`
      )
    }
  }
  ```

  **Pattern notes (mirrors `app/api/github/callback/route.ts`):**
  - Decrypt `state` to recover `workspaceId`, `memberId`, `workspaceUrl`
  - POST to `https://slack.com/api/oauth.v2.access` with `client_id`, `client_secret`, `code`, `redirect_uri`
  - Slack responds with `{ ok, access_token, team: { id, name }, authed_user: { id } }`
  - `encrypt(tokenData.access_token)` before storing
  - `prisma.slackIntegration.upsert({ where: { workspaceId }, ... })` — one record per workspace
  - Redirect to `?slack_connected=1` on success, `?slack_error=1` on failure

### 3.3 — `app/api/slack/integration/route.ts`

- [ ] **3.3** Create `app/api/slack/integration/route.ts`:

  ```typescript
  import { NextRequest, NextResponse } from 'next/server'
  import { prisma } from '@/lib/db/prisma'
  import {
    requireAuth,
    getUserWorkspace,
    requireWorkspaceMember,
  } from '@/lib/auth'
  import { decrypt } from '@/lib/crypto'

  export async function GET(request: NextRequest) {
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

      const integration = await prisma.slackIntegration.findUnique({
        where: { workspaceId: ws.workspaceId },
        select: { slackTeamName: true, slackUserId: true, slackTeamId: true },
      })

      if (!integration) return NextResponse.json({ connected: false })
      return NextResponse.json({ connected: true, ...integration })
    } catch (error) {
      console.error('GET /api/slack/integration error:', error)
      return NextResponse.json(
        { error: 'Internal Server Error' },
        { status: 500 }
      )
    }
  }

  export async function DELETE(request: NextRequest) {
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

      const memberResult = await requireWorkspaceMember(ws.workspaceId, userId)
      if (memberResult instanceof NextResponse) return memberResult

      if (memberResult.role !== 'OWNER') {
        return NextResponse.json(
          { error: 'Only workspace owners can disconnect Slack' },
          { status: 403 }
        )
      }

      const integration = await prisma.slackIntegration.findUnique({
        where: { workspaceId: ws.workspaceId },
        select: { id: true, accessToken: true },
      })
      if (!integration)
        return NextResponse.json({ error: 'Not connected' }, { status: 404 })

      // Revoke token with Slack (fire-and-forget)
      const token = decrypt(integration.accessToken)
      fetch('https://slack.com/api/auth.revoke', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }).catch(err => console.error('[slack] token revoke failed:', err))

      await prisma.slackIntegration.delete({
        where: { workspaceId: ws.workspaceId },
      })
      return NextResponse.json({ success: true })
    } catch (error) {
      console.error('DELETE /api/slack/integration error:', error)
      return NextResponse.json(
        { error: 'Internal Server Error' },
        { status: 500 }
      )
    }
  }
  ```

  **Pattern notes (mirrors `app/api/github/integration/route.ts`):**
  - GET: find by `workspaceId` (unique), return `{ connected: false }` when absent, otherwise return team metadata. Never return the access token.
  - DELETE: look up integration, fire-and-forget `auth.revoke` against Slack, then `prisma.slackIntegration.delete`. Cascade in Prisma removes all `SlackChannel` rows automatically.

- [ ] **3.4** TypeScript check — expect no errors:

  ```bash
  cd /Users/chaoli/Desktop/lumo/lumo
  npx tsc --noEmit 2>&1 | grep -v node_modules
  ```

  Expected: no output (zero errors).

- [ ] **3.5** Commit:

  ```bash
  cd /Users/chaoli/Desktop/lumo/lumo
  git add app/api/slack/ && git commit -m "feat: add Slack OAuth routes"
  ```

---

## Task 4: Channel Management Routes

**Files:**

- Create `app/api/slack/channels/route.ts` (GET + POST)
- Create `app/api/slack/channels/[id]/route.ts` (PATCH + DELETE)
- Create `app/api/slack/available-channels/route.ts` (GET)

### 4.1 — `app/api/slack/channels/route.ts`

- [ ] **4.1** Create `app/api/slack/channels/route.ts`:

  ```typescript
  import { NextRequest, NextResponse } from 'next/server'
  import { prisma } from '@/lib/db/prisma'
  import { requireAuth, getUserWorkspace } from '@/lib/auth'
  import { SlackEventType, ALL_SLACK_EVENTS } from '@/lib/slack/types'

  export async function GET(request: NextRequest) {
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

      const integration = await prisma.slackIntegration.findUnique({
        where: { workspaceId: ws.workspaceId },
        select: {
          channels: {
            select: {
              id: true,
              channelId: true,
              channelName: true,
              events: true,
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      })

      if (!integration)
        return NextResponse.json({ error: 'Not connected' }, { status: 404 })
      return NextResponse.json({ channels: integration.channels })
    } catch (error) {
      console.error('GET /api/slack/channels error:', error)
      return NextResponse.json(
        { error: 'Internal Server Error' },
        { status: 500 }
      )
    }
  }

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
      const events: SlackEventType[] = body.events ?? ALL_SLACK_EVENTS

      if (!channelId || !channelName) {
        return NextResponse.json(
          { error: 'channelId and channelName are required' },
          { status: 400 }
        )
      }

      const integration = await prisma.slackIntegration.findUnique({
        where: { workspaceId: ws.workspaceId },
        select: { id: true },
      })
      if (!integration)
        return NextResponse.json({ error: 'Not connected' }, { status: 404 })

      const channel = await prisma.slackChannel.create({
        data: {
          integrationId: integration.id,
          channelId,
          channelName,
          events,
        },
        select: { id: true, channelId: true, channelName: true, events: true },
      })

      return NextResponse.json({ channel }, { status: 201 })
    } catch (error) {
      console.error('POST /api/slack/channels error:', error)
      return NextResponse.json(
        { error: 'Internal Server Error' },
        { status: 500 }
      )
    }
  }
  ```

### 4.2 — `app/api/slack/channels/[id]/route.ts`

- [ ] **4.2** Create `app/api/slack/channels/[id]/route.ts`:

  ```typescript
  import { NextRequest, NextResponse } from 'next/server'
  import { prisma } from '@/lib/db/prisma'
  import { requireAuth, getUserWorkspace } from '@/lib/auth'
  import { SlackEventType } from '@/lib/slack/types'

  type Params = { params: Promise<{ id: string }> }

  async function getChannelAndVerify(channelRecordId: string, userId: string) {
    const ws = await getUserWorkspace(userId)
    if (!ws) return null

    const channel = await prisma.slackChannel.findUnique({
      where: { id: channelRecordId },
      include: { integration: { select: { workspaceId: true } } },
    })
    if (!channel || channel.integration.workspaceId !== ws.workspaceId)
      return null
    return channel
  }

  export async function PATCH(request: NextRequest, { params }: Params) {
    try {
      const authResult = await requireAuth()
      if (authResult instanceof NextResponse) return authResult
      const { userId } = authResult
      const { id } = await params

      const channel = await getChannelAndVerify(id, userId)
      if (!channel)
        return NextResponse.json({ error: 'Not found' }, { status: 404 })

      const body = await request.json()
      const events: SlackEventType[] = body.events ?? channel.events

      const updated = await prisma.slackChannel.update({
        where: { id },
        data: { events },
        select: { id: true, channelId: true, channelName: true, events: true },
      })
      return NextResponse.json({ channel: updated })
    } catch (error) {
      console.error('PATCH /api/slack/channels/[id] error:', error)
      return NextResponse.json(
        { error: 'Internal Server Error' },
        { status: 500 }
      )
    }
  }

  export async function DELETE(request: NextRequest, { params }: Params) {
    try {
      const authResult = await requireAuth()
      if (authResult instanceof NextResponse) return authResult
      const { userId } = authResult
      const { id } = await params

      const channel = await getChannelAndVerify(id, userId)
      if (!channel)
        return NextResponse.json({ error: 'Not found' }, { status: 404 })

      await prisma.slackChannel.delete({ where: { id } })
      return NextResponse.json({ success: true })
    } catch (error) {
      console.error('DELETE /api/slack/channels/[id] error:', error)
      return NextResponse.json(
        { error: 'Internal Server Error' },
        { status: 500 }
      )
    }
  }
  ```

### 4.3 — `app/api/slack/available-channels/route.ts`

- [ ] **4.3** Create `app/api/slack/available-channels/route.ts`:

  ```typescript
  import { NextRequest, NextResponse } from 'next/server'
  import { prisma } from '@/lib/db/prisma'
  import { requireAuth, getUserWorkspace } from '@/lib/auth'
  import { decrypt } from '@/lib/crypto'

  export async function GET(request: NextRequest) {
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

      const integration = await prisma.slackIntegration.findUnique({
        where: { workspaceId: ws.workspaceId },
        select: { accessToken: true },
      })
      if (!integration)
        return NextResponse.json({ error: 'Not connected' }, { status: 404 })

      const token = decrypt(integration.accessToken)
      const res = await fetch(
        'https://slack.com/api/conversations.list?exclude_archived=true&types=public_channel,private_channel&limit=200',
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      )
      const data = await res.json()
      if (!data.ok)
        return NextResponse.json(
          { error: 'Failed to fetch channels from Slack' },
          { status: 502 }
        )

      const channels = (
        data.channels as Array<{
          id: string
          name: string
          is_private: boolean
        }>
      ).map(c => ({
        id: c.id,
        name: `#${c.name}`,
        private: c.is_private,
      }))

      return NextResponse.json({ channels })
    } catch (error) {
      console.error('GET /api/slack/available-channels error:', error)
      return NextResponse.json(
        { error: 'Internal Server Error' },
        { status: 500 }
      )
    }
  }
  ```

  **Pattern notes (mirrors `app/api/github/repos/route.ts` GET):**
  - Decrypt stored token, call `conversations.list` on the Slack API
  - Map response to `{ id, name, private }` — `name` is prefixed with `#` for display
  - Returns 502 if the Slack API call fails (e.g. bad token)

- [ ] **4.4** TypeScript check — expect no errors:

  ```bash
  cd /Users/chaoli/Desktop/lumo/lumo
  npx tsc --noEmit 2>&1 | grep -v node_modules
  ```

  Expected: no output (zero errors).

- [ ] **4.5** Commit:

  ```bash
  cd /Users/chaoli/Desktop/lumo/lumo
  git add app/api/slack/ && git commit -m "feat: add Slack channel management and available-channels routes"
  ```

---

## Task 5: API Constants + env.example

**Files:**

- `app/workspace/[workspaceUrl]/constants.ts`
- `.env.example`

- [ ] **5.1** In `app/workspace/[workspaceUrl]/constants.ts`, add a `slack` key inside the `API` object, after the `github` block:

  ```typescript
  slack: {
    oauth: (workspaceUrl: string) => `/api/slack/oauth?workspaceUrl=${workspaceUrl}`,
    integration: (workspaceUrl: string) => `/api/slack/integration?workspaceUrl=${workspaceUrl}`,
    channels: (workspaceUrl: string) => `/api/slack/channels?workspaceUrl=${workspaceUrl}`,
    channelById: (id: string) => `/api/slack/channels/${id}`,
    availableChannels: (workspaceUrl: string) => `/api/slack/available-channels?workspaceUrl=${workspaceUrl}`,
  },
  ```

  Note: the GitHub pattern uses static strings for most endpoints (`integration: '/api/github/integration'`). The Slack pattern uses functions for all endpoints since they all require `workspaceUrl` as a query param. Be consistent with the existing pattern where functions take `workspaceUrl: string`.

  > **Note:** these are defined as functions (not static strings) since all Slack routes require `workspaceUrl` as a query parameter. This diverges from the spec's table which showed static strings, but is consistent with how the UI will call them.

- [ ] **5.2** In `.env.example`, add the Slack OAuth app credentials section after the GitHub section:

  ```
  # Slack OAuth App
  SLACK_CLIENT_ID=""
  SLACK_CLIENT_SECRET=""
  SLACK_SIGNING_SECRET=""
  ```

- [ ] **5.3** TypeScript check — expect no errors:

  ```bash
  cd /Users/chaoli/Desktop/lumo/lumo
  npx tsc --noEmit 2>&1 | grep -v node_modules
  ```

  Expected: no output (zero errors).

- [ ] **5.4** Commit:

  ```bash
  cd /Users/chaoli/Desktop/lumo/lumo
  git add app/workspace/ .env.example && git commit -m "feat: add Slack API constants and env vars"
  ```

---

## Task 6: SlackIntegrationCard UI

**Files:**

- Create `app/workspace/[workspaceUrl]/components/SlackIntegrationCard.tsx`
- Modify `app/workspace/[workspaceUrl]/components/pages/IntegrationsPage.tsx`

### 6.1 — Create `SlackIntegrationCard.tsx`

- [ ] **6.1** Create `app/workspace/[workspaceUrl]/components/SlackIntegrationCard.tsx` with the full component below. Do not abbreviate or shorten any section — write the entire file:

  ```tsx
  'use client'

  import { useState, useEffect, useCallback } from 'react'
  import { useParams } from 'next/navigation'
  import { Slack, Plus, Trash2, Loader2, X } from 'lucide-react'
  import { toast } from 'sonner'
  import { Button } from '@/components/ui/button'
  import { API } from '../constants'
  import {
    ALL_SLACK_EVENTS,
    SLACK_EVENT_LABELS,
    SlackEventType,
  } from '@/lib/slack/types'

  interface SlackChannel {
    id: string
    channelId: string
    channelName: string
    events: SlackEventType[]
  }

  interface SlackStatus {
    connected: boolean
    slackTeamName?: string
    slackUserId?: string
    slackTeamId?: string
  }

  interface AvailableChannel {
    id: string
    name: string
    private: boolean
  }

  export function SlackIntegrationCard({ isOwner }: { isOwner: boolean }) {
    const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
    const [status, setStatus] = useState<SlackStatus | null>(null)
    const [channels, setChannels] = useState<SlackChannel[]>([])
    const [loading, setLoading] = useState(true)
    const [disconnecting, setDisconnecting] = useState(false)
    const [showAddChannel, setShowAddChannel] = useState(false)

    const fetchStatus = useCallback(async () => {
      try {
        const res = await fetch(API.slack.integration(workspaceUrl))
        if (res.ok) setStatus(await res.json())
      } catch {
        /* ignore */
      } finally {
        setLoading(false)
      }
    }, [workspaceUrl])

    const fetchChannels = useCallback(async () => {
      try {
        const res = await fetch(API.slack.channels(workspaceUrl))
        if (res.ok) {
          const data = await res.json()
          setChannels(data.channels ?? [])
        }
      } catch {
        /* ignore */
      }
    }, [workspaceUrl])

    useEffect(() => {
      fetchStatus()
    }, [fetchStatus])

    useEffect(() => {
      if (status?.connected) fetchChannels()
    }, [status?.connected, fetchChannels])

    // Handle ?slack_connected=1 and ?slack_error=1
    useEffect(() => {
      const params = new URLSearchParams(window.location.search)
      if (params.get('slack_connected') === '1') {
        toast.success('Slack connected successfully')
        fetchStatus()
        window.history.replaceState({}, '', window.location.pathname)
      }
      if (params.get('slack_error') === '1') {
        toast.error('Failed to connect Slack')
        window.history.replaceState({}, '', window.location.pathname)
      }
    }, [fetchStatus])

    const handleDisconnect = async () => {
      if (
        !confirm('Disconnect Slack? All channel subscriptions will be removed.')
      )
        return
      setDisconnecting(true)
      try {
        await fetch(API.slack.integration(workspaceUrl), { method: 'DELETE' })
        setStatus({ connected: false })
        setChannels([])
        toast.success('Slack disconnected')
      } catch {
        toast.error('Failed to disconnect')
      } finally {
        setDisconnecting(false)
      }
    }

    const handleRemoveChannel = async (id: string) => {
      try {
        await fetch(API.slack.channelById(id), { method: 'DELETE' })
        setChannels(prev => prev.filter(c => c.id !== id))
      } catch {
        toast.error('Failed to remove channel')
      }
    }

    if (loading) {
      return (
        <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 p-4'>
          <div className='flex items-center gap-3'>
            <Slack size={20} className='text-zinc-400' />
            <div className='flex-1'>
              <p className='text-sm font-medium'>Slack</p>
              <p className='text-xs text-zinc-500'>Loading...</p>
            </div>
            <Loader2 size={16} className='animate-spin text-zinc-400' />
          </div>
        </div>
      )
    }

    return (
      <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-4'>
        <div className='flex items-center gap-3'>
          <Slack size={20} className='text-zinc-400' />
          <div className='flex-1'>
            <p className='text-sm font-medium'>Slack</p>
            <p className='text-xs text-zinc-500 dark:text-zinc-400'>
              Send notifications and manage tasks from Slack.
            </p>
          </div>
          {status?.connected ? (
            <span className='flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium'>
              ✓ Connected
            </span>
          ) : isOwner ? (
            <Button size='sm' variant='outline' asChild>
              <a href={API.slack.oauth(workspaceUrl)}>Connect Slack</a>
            </Button>
          ) : null}
        </div>

        {status?.connected && (
          <>
            <p className='text-xs text-zinc-500 dark:text-zinc-400'>
              Connected to workspace:{' '}
              <span className='font-medium text-zinc-700 dark:text-zinc-300'>
                {status.slackTeamName}
              </span>
            </p>

            {/* Channels list */}
            <div className='space-y-2'>
              <p className='text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider'>
                Notification Channels
              </p>
              {channels.length === 0 && (
                <p className='text-xs text-zinc-400 dark:text-zinc-500'>
                  No channels configured yet.
                </p>
              )}
              {channels.map(ch => (
                <div
                  key={ch.id}
                  className='flex items-start gap-2 rounded-md border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2'
                >
                  <div className='flex-1 min-w-0'>
                    <p className='text-xs font-mono font-medium text-zinc-700 dark:text-zinc-300'>
                      {ch.channelName}
                    </p>
                    <div className='flex flex-wrap gap-1 mt-1'>
                      {ch.events.map(ev => (
                        <span
                          key={ev}
                          className='text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                        >
                          {SLACK_EVENT_LABELS[ev]}
                        </span>
                      ))}
                    </div>
                  </div>
                  {isOwner && (
                    <button
                      onClick={() => handleRemoveChannel(ch.id)}
                      className='text-zinc-400 hover:text-red-500 transition-colors mt-0.5 shrink-0'
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {isOwner && (
              <div className='flex items-center justify-between pt-1'>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => setShowAddChannel(true)}
                >
                  <Plus size={13} className='mr-1' />
                  Add channel
                </Button>
                <Button
                  size='sm'
                  variant='ghost'
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className='text-zinc-400 hover:text-red-600'
                >
                  {disconnecting ? (
                    <Loader2 size={13} className='animate-spin mr-1' />
                  ) : (
                    <Trash2 size={13} className='mr-1' />
                  )}
                  Disconnect
                </Button>
              </div>
            )}

            {showAddChannel && (
              <AddSlackChannelDialog
                workspaceUrl={workspaceUrl}
                onClose={() => setShowAddChannel(false)}
                onAdded={ch => {
                  setChannels(prev => [...prev, ch])
                  setShowAddChannel(false)
                }}
              />
            )}
          </>
        )}
      </div>
    )
  }

  function AddSlackChannelDialog({
    workspaceUrl,
    onClose,
    onAdded,
  }: {
    workspaceUrl: string
    onClose: () => void
    onAdded: (channel: SlackChannel) => void
  }) {
    const [availableChannels, setAvailableChannels] = useState<
      AvailableChannel[]
    >([])
    const [selectedChannelId, setSelectedChannelId] = useState('')
    const [selectedEvents, setSelectedEvents] = useState<SlackEventType[]>([
      ...ALL_SLACK_EVENTS,
    ])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
      fetch(API.slack.availableChannels(workspaceUrl))
        .then(r => r.json())
        .then(data => {
          const chs = data.channels ?? []
          setAvailableChannels(chs)
          if (chs.length > 0) setSelectedChannelId(chs[0].id)
        })
        .catch(() => toast.error('Failed to load Slack channels'))
        .finally(() => setLoading(false))
    }, [workspaceUrl])

    const toggleEvent = (ev: SlackEventType) => {
      setSelectedEvents(prev =>
        prev.includes(ev) ? prev.filter(e => e !== ev) : [...prev, ev]
      )
    }

    const handleSave = async () => {
      const ch = availableChannels.find(c => c.id === selectedChannelId)
      if (!ch) return
      setSaving(true)
      try {
        const res = await fetch(API.slack.channels(workspaceUrl), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channelId: ch.id,
            channelName: ch.name,
            events: selectedEvents,
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          toast.error(data.error ?? 'Failed to add channel')
          return
        }
        onAdded(data.channel)
        toast.success(`${ch.name} added`)
      } catch {
        toast.error('Failed to add channel')
      } finally {
        setSaving(false)
      }
    }

    return (
      <div
        className='fixed inset-0 z-50 flex items-center justify-center bg-black/40'
        onClick={onClose}
      >
        <div
          className='bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xl p-5 w-full max-w-sm space-y-4'
          onClick={e => e.stopPropagation()}
        >
          <div className='flex items-center justify-between'>
            <p className='text-sm font-medium'>Add Slack channel</p>
            <button
              onClick={onClose}
              className='text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
            >
              <X size={16} />
            </button>
          </div>

          {loading ? (
            <div className='flex justify-center py-6'>
              <Loader2 size={20} className='animate-spin text-zinc-400' />
            </div>
          ) : (
            <>
              <div className='space-y-1.5'>
                <label className='text-xs font-medium text-zinc-500 dark:text-zinc-400'>
                  Channel
                </label>
                <select
                  value={selectedChannelId}
                  onChange={e => setSelectedChannelId(e.target.value)}
                  className='w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 font-mono'
                >
                  {availableChannels.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.private ? ' (private)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className='space-y-1.5'>
                <label className='text-xs font-medium text-zinc-500 dark:text-zinc-400'>
                  Notify on
                </label>
                <div className='grid grid-cols-2 gap-1.5'>
                  {ALL_SLACK_EVENTS.map(ev => (
                    <label
                      key={ev}
                      className='flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer'
                    >
                      <input
                        type='checkbox'
                        checked={selectedEvents.includes(ev)}
                        onChange={() => toggleEvent(ev)}
                        className='rounded'
                      />
                      {SLACK_EVENT_LABELS[ev]}
                    </label>
                  ))}
                </div>
              </div>

              <Button
                className='w-full'
                onClick={handleSave}
                disabled={
                  saving || !selectedChannelId || selectedEvents.length === 0
                }
              >
                {saving ? (
                  <Loader2 size={14} className='animate-spin mr-2' />
                ) : null}
                {saving ? 'Adding…' : 'Add channel'}
              </Button>
            </>
          )}
        </div>
      </div>
    )
  }
  ```

### 6.2 — Update `IntegrationsPage.tsx`

- [ ] **6.2** In `app/workspace/[workspaceUrl]/components/pages/IntegrationsPage.tsx`, add the import for `SlackIntegrationCard` after the existing `GitHubIntegrationCard` import:

  ```typescript
  import { SlackIntegrationCard } from '../SlackIntegrationCard'
  ```

- [ ] **6.3** In `IntegrationsPage.tsx`, render `<SlackIntegrationCard isOwner={isOwner} />` directly below the `<GitHubIntegrationCard ... />` element, inside the same conditional block that checks `!loading`. The current file renders `<GitHubIntegrationCard ... />` directly without a wrapper. Replace it with a `<div className='space-y-4'>` containing both cards. The updated JSX block should look like:

  ```tsx
  {
    loading ? (
      <div className='h-32 rounded-xl border border-zinc-200 dark:border-zinc-800 animate-pulse bg-zinc-50 dark:bg-zinc-900' />
    ) : (
      <div className='space-y-4'>
        <GitHubIntegrationCard
          workspaceUrl={workspaceUrl}
          status={ghStatus}
          onStatusChange={setGhStatus}
          isOwner={isOwner}
        />
        <SlackIntegrationCard isOwner={isOwner} />
      </div>
    )
  }
  ```

- [ ] **6.4** TypeScript check — expect no errors:

  ```bash
  cd /Users/chaoli/Desktop/lumo/lumo
  npx tsc --noEmit 2>&1 | grep -v node_modules
  ```

  Expected: no output (zero errors).

- [ ] **6.5** Commit:

  ```bash
  cd /Users/chaoli/Desktop/lumo/lumo
  git add app/workspace/ && git commit -m "feat: add SlackIntegrationCard and AddSlackChannelDialog"
  ```

---

## Summary

After all 6 tasks are complete, the following will be in place:

| Layer              | What was added                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Database           | `slack_integrations` table (one per workspace, unique on `workspaceId`) and `slack_channels` table (many per integration)                |
| Types              | `lib/slack/types.ts` — `SlackEventType`, `ALL_SLACK_EVENTS`, `SLACK_EVENT_LABELS`, `NotificationPayload`                                 |
| OAuth              | `GET /api/slack/oauth` initiates flow; `GET /api/slack/callback` exchanges code and upserts `SlackIntegration`                           |
| Integration API    | `GET /api/slack/integration` returns connection status; `DELETE /api/slack/integration` revokes token and deletes record                 |
| Channel API        | `GET/POST /api/slack/channels` lists and creates channel subscriptions; `PATCH/DELETE /api/slack/channels/[id]` updates and removes them |
| Available channels | `GET /api/slack/available-channels` calls Slack `conversations.list` with the stored (decrypted) token                                   |
| Constants          | `API.slack.*` helpers added to `constants.ts`                                                                                            |
| Env                | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` documented in `.env.example`                                            |
| UI                 | `SlackIntegrationCard` + `AddSlackChannelDialog` rendered below the GitHub card in `IntegrationsPage`                                    |

The foundation is ready for Sprint N+1 which adds the Slack bot (`/lumo` slash command), incoming event webhooks, and DM notifications.

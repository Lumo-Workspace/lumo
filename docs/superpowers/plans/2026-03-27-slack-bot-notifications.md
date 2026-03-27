# Slack Integration — Bot & Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Slack bot (mentions + slash commands) and outbound notification hooks so Lumo events post to Slack channels and DMs.

**Architecture:** Uses @chat-adapter/slack from chat-sdk.dev for event handling and message sending. Tokens managed via our Prisma DB (not SDK state). Bot handles @Lumo mentions and /lumo slash commands. Notifications hook into existing task/PR/comment code paths.

**Prerequisite:** Plan 1 (slack-foundation) must be complete — SlackIntegration and SlackChannel models must exist in DB.

**Tech Stack:** @chat-adapter/slack, chat, Next.js 14, TypeScript, Prisma, Clerk (for email lookup), lucide-react.

---

## Codebase Context (read before implementing)

Key patterns observed in the existing codebase:

- **Webhook verification** (`lib/github/verify.ts`): Uses `createHmac('sha256', secret).update(body, 'utf8').digest('hex')` with `timingSafeEqual` and same-length buffer check. The Slack route must mirror this exactly using `v0:${timestamp}:${body}` as the base string.
- **Webhook route** (`app/api/webhooks/github/route.ts`): Reads raw body with `request.text()`, parses JSON separately, dispatches to handlers. Always returns 200 to prevent retries.
- **Notification helper** (`lib/notifications/notifyTaskInReview.ts`): Pure async function, fire-and-forget at call site via `.catch(...)`. Takes `workspaceId`, `taskId`, Clerk IDs. Pattern to follow for Slack DM lookups.
- **Encryption** (`lib/crypto.ts`): `decrypt(storedValue)` from `@/lib/crypto` — all Slack `accessToken` fields in DB are AES-256-GCM encrypted using this same pattern as GitHub tokens.
- **Task PATCH handler** (`app/api/tasks/[id]/route.ts`): Notification hooks fire after `prisma.task.update()` at lines 237–295. `workspaceId` is available as `task.project.workspaceId`. The `updated` variable holds the result of the update. Use `void` + `.catch()` pattern already established there.
- **Comment POST handler** (`app/api/tasks/[id]/comments/route.ts`): Mentions extracted with regex `data-type="mention"[^>]*data-id="([^"]+)"` at lines 114–144. `workspaceId` is `task.project.workspaceId`. Slack DM hook goes in the same `.then()` chain after `prisma.notification.createMany`.
- **GitHub handlers** (`app/api/webhooks/github/handlers.ts`): `handlePullRequest` has `task`, `pr`, `workspaceId` all in scope. PR opened hook at line 124 (`action === 'opened' || action === 'reopened'`). PR merged hook at line 138 (`action === 'closed' && pr.merged`). Task has `team.identifier`, `number`, `id` fields.
- **Schema**: `Task` has `status` (enum: TODO/IN_PROGRESS/IN_REVIEW/DONE), `priority`, `assigneeId`, `reviewerId`, `number`, `teamId`. `WorkspaceMember` has `clerkId`. No `workspaceId` directly on `Task` — it is reached via `task.project.workspaceId`.
- **`lib/slack/types.ts` does not exist yet** — it is created in Plan 1 (slack-foundation). This plan assumes it exists and exports `SlackEventType`, `NotificationPayload`, and `SLACK_EVENT_LABELS`.
- **No `@chat-adapter/slack` or `chat` in package.json** — these must be installed in Task 1.

---

## Tasks

### Task 1: Install @chat-adapter/slack and initialise the bot

- [ ] Run the install command from the project root:

  ```bash
  cd /Users/chaoli/Desktop/lumo/lumo
  npm install @chat-adapter/slack chat
  ```

  Expected: both packages appear under `"dependencies"` in `package.json`. No peer-dependency errors. If there are peer errors, read them carefully — do not blindly pass `--legacy-peer-deps` unless the error is a known false positive for a version range mismatch that does not affect runtime.

- [ ] Create `lib/slack/bot.ts`:

  ```typescript
  import { Chat } from 'chat'
  import { createSlackAdapter } from '@chat-adapter/slack'

  export const slackAdapter = createSlackAdapter({
    clientId: process.env.SLACK_CLIENT_ID!,
    clientSecret: process.env.SLACK_CLIENT_SECRET!,
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
  })

  export const bot = new Chat({
    userName: 'Lumo',
    adapters: { slack: slackAdapter },
  })
  ```

  Note: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and `SLACK_SIGNING_SECRET` are the three Slack app credentials. They must be added to `.env.local` and `env.example`. The signing secret is also used for per-request verification in the webhook route (Task 3).

- [ ] Run TypeScript check:

  ```bash
  cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit
  ```

  Expected output: no errors. If the `chat` or `@chat-adapter/slack` packages lack type declarations, add a `declarations.d.ts` shim:

  ```typescript
  // lib/slack/declarations.d.ts
  declare module 'chat'
  declare module '@chat-adapter/slack'
  ```

  Re-run `tsc --noEmit` and confirm it passes before proceeding.

- [ ] Commit: `feat: install @chat-adapter/slack and init bot`

---

### Task 2: lib/slack/commands.ts — Bot command handlers

- [ ] **Read `lib/slack/types.ts` first** to confirm the exact shape of `SlackEventType` and `NotificationPayload` exported by Plan 1 before importing them. This file is created in the slack-foundation plan and its field names must match exactly.

- [ ] **Read `prisma/schema.prisma`** to confirm the exact field names on `Task`, `Team`, `WorkspaceMember`, `Project`, and `Workspace`. Pay attention to: `Task.number` (Int), `Task.status` (TaskStatus enum values are `TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`), `Task.priority` (TaskPriority enum), `Team.identifier` (String), `Workspace.slug` (String). The `Task` model does NOT have a direct `workspaceId` field — it must be reached via `task.project.workspaceId` or queried through the `team` relation.

- [ ] Create `lib/slack/commands.ts` with the following content:

  ```typescript
  import { prisma } from '@/lib/db/prisma'

  // Input: the raw text after "@Lumo " or "/lumo "
  // Returns: Slack Block Kit blocks array OR a plain string message
  export type CommandResult =
    | { type: 'blocks'; blocks: object[] }
    | { type: 'text'; text: string }

  // Resolve Slack user email → WorkspaceMember in workspaceId
  async function resolveSlackUser(
    slackUserId: string,
    slackToken: string,
    workspaceId: string
  ) {
    const res = await fetch(
      `https://slack.com/api/users.info?user=${slackUserId}`,
      { headers: { Authorization: `Bearer ${slackToken}` } }
    )
    const data = await res.json()
    if (!data.ok || !data.user?.profile?.email) return null

    const email: string = data.user.profile.email

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      select: { id: true, clerkId: true },
    })

    // Use Clerk backend API to match email → WorkspaceMember
    const { createClerkClient } = await import('@clerk/nextjs/server')
    const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
    for (const member of members) {
      const clerkUser = await clerk.users.getUser(member.clerkId)
      const primaryEmail = clerkUser.emailAddresses.find(
        e => e.id === clerkUser.primaryEmailAddressId
      )
      if (primaryEmail?.emailAddress === email) return member
    }
    return null
  }

  const TASK_IDENTIFIER_REGEX = /^([A-Za-z]{1,10})-(\d+)$/

  function taskUrl(workspaceSlug: string, taskId: string) {
    return `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${workspaceSlug}/task/${taskId}`
  }

  function taskBlocks(task: {
    id: string
    number: number
    title: string
    status: string
    priority: string
    teamIdentifier: string
    workspaceSlug: string
    assigneeName?: string | null
    reviewerName?: string | null
    projectName?: string | null
  }): object[] {
    const identifier = `${task.teamIdentifier}-${task.number}`
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `*${identifier} · ${task.title}*`,
            `Status: ${task.status}   Priority: ${task.priority}`,
            task.assigneeName ? `Assignee: ${task.assigneeName}` : null,
            task.reviewerName ? `Reviewer: ${task.reviewerName}` : null,
            task.projectName ? `Project: ${task.projectName}` : null,
          ]
            .filter(Boolean)
            .join('\n'),
        },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Open in Lumo ↗' },
          url: taskUrl(task.workspaceSlug, task.id),
        },
      },
    ]
  }

  async function findTaskByIdentifier(identifier: string, workspaceId: string) {
    const match = identifier.match(TASK_IDENTIFIER_REGEX)
    if (!match) return null
    const [, teamIdentifier, numberStr] = match
    const number = parseInt(numberStr!, 10)

    const team = await prisma.team.findFirst({
      where: { workspaceId, identifier: teamIdentifier!.toUpperCase() },
      select: { id: true },
    })
    if (!team) return null

    return prisma.task.findFirst({
      where: { teamId: team.id, number },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        priority: true,
        projectId: true,
        assigneeId: true,
        reviewerId: true,
        project: { select: { name: true } },
        // Workspace is accessed via team → workspace relation
        team: {
          select: { identifier: true, workspace: { select: { slug: true } } },
        },
      },
    })
  }

  const HELP_TEXT = `Available commands:
  • \`status ENG-123\` — view task details
  • \`assign ENG-123 @user\` — assign task
  • \`done ENG-123\` — mark task as done
  • \`in-review ENG-123\` — mark task as in review
  • \`create "title" in TEAM\` — create a new task
  • \`my-tasks\` — list your open tasks`

  export async function handleCommand(
    text: string,
    slackUserId: string,
    slackToken: string,
    workspaceId: string
  ): Promise<CommandResult> {
    const parts = text.trim().split(/\s+/)
    const cmd = parts[0]?.toLowerCase()

    try {
      // ── status ENG-123 ──────────────────────────────────────────────────────
      if (cmd === 'status' && parts[1]) {
        const task = await findTaskByIdentifier(parts[1], workspaceId)
        if (!task)
          return { type: 'text', text: `Task \`${parts[1]}\` not found.` }
        return {
          type: 'blocks',
          blocks: taskBlocks({
            id: task.id,
            number: task.number,
            title: task.title,
            status: task.status,
            priority: task.priority,
            teamIdentifier: task.team.identifier,
            workspaceSlug: task.team.workspace.slug,
            projectName: task.project?.name,
          }),
        }
      }

      // ── done ENG-123 / in-review ENG-123 ───────────────────────────────────
      if ((cmd === 'done' || cmd === 'in-review') && parts[1]) {
        const member = await resolveSlackUser(
          slackUserId,
          slackToken,
          workspaceId
        )
        if (!member)
          return {
            type: 'text',
            text: `Your Slack account is not linked to a Lumo account in this workspace. Please use the same email in both.`,
          }

        const task = await findTaskByIdentifier(parts[1]!, workspaceId)
        if (!task)
          return { type: 'text', text: `Task \`${parts[1]}\` not found.` }

        const newStatus = cmd === 'done' ? 'DONE' : 'IN_REVIEW'
        await prisma.task.update({
          where: { id: task.id },
          data: { status: newStatus },
        })
        return {
          type: 'text',
          text: `✅ ${task.team.identifier}-${task.number} marked as ${cmd === 'done' ? 'Done' : 'In Review'}.`,
        }
      }

      // ── assign ENG-123 @user ────────────────────────────────────────────────
      if (cmd === 'assign' && parts[1] && parts[2]) {
        const member = await resolveSlackUser(
          slackUserId,
          slackToken,
          workspaceId
        )
        if (!member)
          return {
            type: 'text',
            text: `Your Slack account is not linked to a Lumo account.`,
          }

        const task = await findTaskByIdentifier(parts[1]!, workspaceId)
        if (!task)
          return { type: 'text', text: `Task \`${parts[1]}\` not found.` }

        // parts[2] is a Slack mention like <@U123456> or <@U123456|displayname>
        const mentionMatch = parts[2]!.match(/^<@([^|>]+)/)
        if (!mentionMatch)
          return { type: 'text', text: `Invalid user format. Use @username.` }
        const targetSlackId = mentionMatch[1]!

        const targetMember = await resolveSlackUser(
          targetSlackId,
          slackToken,
          workspaceId
        )
        if (!targetMember)
          return {
            type: 'text',
            text: `That user doesn't have a linked Lumo account.`,
          }

        await prisma.task.update({
          where: { id: task.id },
          data: { assigneeId: targetMember.id },
        })
        return {
          type: 'text',
          text: `✅ ${task.team.identifier}-${task.number} assigned.`,
        }
      }

      // ── create "title" in TEAM ──────────────────────────────────────────────
      if (cmd === 'create') {
        const member = await resolveSlackUser(
          slackUserId,
          slackToken,
          workspaceId
        )
        if (!member)
          return {
            type: 'text',
            text: `Your Slack account is not linked to a Lumo account.`,
          }

        const titleMatch = text.match(/create\s+"([^"]+)"\s+in\s+([A-Za-z]+)/i)
        if (!titleMatch)
          return {
            type: 'text',
            text: `Usage: \`create "title" in TEAM\` (e.g. \`create "Fix bug" in ENG\`)`,
          }
        const [, title, teamIdentifierRaw] = titleMatch
        const teamIdentifier = teamIdentifierRaw!.toUpperCase()

        const team = await prisma.team.findFirst({
          where: { workspaceId, identifier: teamIdentifier },
          select: {
            id: true,
            identifier: true,
            _count: { select: { tasks: true } },
            workspace: { select: { slug: true } },
          },
        })
        if (!team)
          return { type: 'text', text: `Team \`${teamIdentifier}\` not found.` }

        // Use the most recently updated project for this team as the default
        const project = await prisma.project.findFirst({
          where: { teamId: team.id },
          orderBy: { updatedAt: 'desc' },
          select: { id: true },
        })

        const task = await prisma.task.create({
          data: {
            title: title!,
            teamId: team.id,
            projectId: project?.id ?? '',
            number: team._count.tasks + 1,
            status: 'TODO',
            priority: 'MEDIUM',
            order: 0,
          },
          select: { id: true, number: true },
        })

        const taskIdentifier = `${team.identifier}-${task.number}`
        const url = taskUrl(team.workspace.slug, task.id)
        return {
          type: 'blocks',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `✅ Created *${taskIdentifier} · ${title}*`,
              },
              accessory: {
                type: 'button',
                text: { type: 'plain_text', text: 'Open in Lumo ↗' },
                url,
              },
            },
          ],
        }
      }

      // ── my-tasks ────────────────────────────────────────────────────────────
      if (cmd === 'my-tasks') {
        const member = await resolveSlackUser(
          slackUserId,
          slackToken,
          workspaceId
        )
        if (!member)
          return {
            type: 'text',
            text: `Your Slack account is not linked to a Lumo account.`,
          }

        const tasks = await prisma.task.findMany({
          where: {
            team: { workspaceId },
            assigneeId: member.id,
            status: { notIn: ['DONE', 'CANCELLED'] },
          },
          orderBy: { updatedAt: 'desc' },
          take: 5,
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            priority: true,
            team: {
              select: {
                identifier: true,
                workspace: { select: { slug: true } },
              },
            },
          },
        })

        if (tasks.length === 0)
          return { type: 'text', text: `You have no open tasks. 🎉` }

        return {
          type: 'blocks',
          blocks: tasks.map(t => ({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${t.team.identifier}-${t.number}* · ${t.title}\n${t.status} · ${t.priority}`,
            },
            accessory: {
              type: 'button',
              text: { type: 'plain_text', text: 'Open ↗' },
              url: taskUrl(t.team.workspace.slug, t.id),
            },
          })),
        }
      }

      // ── unknown command ─────────────────────────────────────────────────────
      return { type: 'text', text: HELP_TEXT }
    } catch (error) {
      console.error('[slack command] error:', error)
      return { type: 'text', text: `Something went wrong. Please try again.` }
    }
  }
  ```

  **Schema note:** `Task` does not have a direct `workspaceId` field. Use `team: { workspace: { select: { slug: true } } }` in Prisma queries where workspace slug is needed. The `findTaskByIdentifier` helper above selects the workspace slug via the team relation — confirm this path exists in the schema before running tsc.

  **Priority default note:** The `create` command uses `'MEDIUM'` as the default priority, matching the `TaskPriority` enum default in `prisma/schema.prisma`. Using `'NO_PRIORITY'` would cause a Prisma validation error since that value is not in the enum. Adjust if the enum changes.

- [ ] Create `tests/lib/slack/commands.test.ts`:

  ```typescript
  import { jest } from '@jest/globals'

  // Mock prisma
  jest.mock('@/lib/db/prisma', () => ({
    prisma: {
      team: { findFirst: jest.fn() },
      task: {
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
      },
      workspaceMember: { findMany: jest.fn() },
      project: { findFirst: jest.fn() },
    },
  }))

  // Mock Clerk so resolveSlackUser can short-circuit
  jest.mock('@clerk/nextjs/server', () => ({
    createClerkClient: () => ({
      users: { getUser: jest.fn() },
    }),
  }))

  import { handleCommand } from '@/lib/slack/commands'
  import { prisma } from '@/lib/db/prisma'

  const mockTeam = {
    id: 'team-1',
    identifier: 'ENG',
    workspace: { slug: 'acme' },
  }
  const mockTask = {
    id: 'task-1',
    number: 42,
    title: 'Fix the bug',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    projectId: 'proj-1',
    assigneeId: null,
    reviewerId: null,
    team: { identifier: 'ENG', workspace: { slug: 'acme' } },
    project: { name: 'Core' },
  }

  describe('handleCommand — status', () => {
    it('returns blocks when task exists', async () => {
      ;(prisma.team.findFirst as jest.Mock).mockResolvedValue(mockTeam)
      ;(prisma.task.findFirst as jest.Mock).mockResolvedValue(mockTask)

      const result = await handleCommand(
        'status ENG-42',
        'U123',
        'xoxb-token',
        'ws-1'
      )
      expect(result.type).toBe('blocks')
    })

    it('returns not-found text when identifier has no matching task', async () => {
      ;(prisma.team.findFirst as jest.Mock).mockResolvedValue(mockTeam)
      ;(prisma.task.findFirst as jest.Mock).mockResolvedValue(null)

      const result = await handleCommand(
        'status ENG-99',
        'U123',
        'xoxb-token',
        'ws-1'
      )
      expect(result.type).toBe('text')
      expect((result as { type: 'text'; text: string }).text).toMatch(
        /not found/
      )
    })

    it('returns not-found text when team does not exist', async () => {
      ;(prisma.team.findFirst as jest.Mock).mockResolvedValue(null)

      const result = await handleCommand(
        'status NOPE-1',
        'U123',
        'xoxb-token',
        'ws-1'
      )
      expect(result.type).toBe('text')
      expect((result as { type: 'text'; text: string }).text).toMatch(
        /not found/
      )
    })
  })

  describe('handleCommand — unknown command', () => {
    it('returns HELP_TEXT for an unrecognised command', async () => {
      const result = await handleCommand('banana', 'U123', 'xoxb-token', 'ws-1')
      expect(result.type).toBe('text')
      expect((result as { type: 'text'; text: string }).text).toContain(
        'Available commands'
      )
    })
  })

  describe('handleCommand — create', () => {
    it('returns usage hint when title is not quoted', async () => {
      const result = await handleCommand(
        'create Fix the bug in ENG',
        'U123',
        'xoxb-token',
        'ws-1'
      )
      expect(result.type).toBe('text')
      expect((result as { type: 'text'; text: string }).text).toMatch(/Usage/)
    })
  })
  ```

- [ ] Run TypeScript check:

  ```bash
  cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] Run tests:

  ```bash
  cd /Users/chaoli/Desktop/lumo/lumo && npx jest tests/lib/slack/commands.test.ts
  ```

  Expected: all 5 tests pass (3 in `status` suite + 1 unknown + 1 create).

- [ ] Commit: `feat: add Slack bot command handlers`

---

### Task 3: Webhook Route — app/api/webhooks/slack/route.ts

- [ ] **Read `lib/github/verify.ts` again** to compare the HMAC verification pattern. The Slack variant uses `v0:${timestamp}:${rawBody}` as the base string (not the body alone), and the resulting expected signature is prefixed with `v0=` instead of `sha256=`. Mirror the same `timingSafeEqual` + same-length buffer guard.

- [ ] **Read `app/api/webhooks/github/route.ts`** to understand the raw-body-first, parse-second pattern. Always return HTTP 200 to Slack even on errors — Slack retries on non-2xx, which causes duplicate processing.

- [ ] Create `app/api/webhooks/slack/route.ts`:

  ```typescript
  import { NextRequest, NextResponse } from 'next/server'
  import { prisma } from '@/lib/db/prisma'
  import { decrypt } from '@/lib/crypto'
  import { handleCommand, CommandResult } from '@/lib/slack/commands'
  import { createHmac, timingSafeEqual } from 'crypto'

  function verifySlackSignature(
    body: string,
    signature: string,
    timestamp: string,
    secret: string
  ): boolean {
    // Reject requests older than 5 minutes to prevent replay attacks
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300
    if (parseInt(timestamp, 10) < fiveMinutesAgo) return false

    const sigBasestring = `v0:${timestamp}:${body}`
    const expected =
      'v0=' +
      createHmac('sha256', secret).update(sigBasestring, 'utf8').digest('hex')

    const a = Buffer.from(signature)
    const b = Buffer.from(expected)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  }

  export async function POST(request: NextRequest) {
    try {
      // 1. Read raw body before any parsing
      const rawBody = await request.text()
      const timestamp = request.headers.get('x-slack-request-timestamp') ?? ''
      const signature = request.headers.get('x-slack-signature') ?? ''

      // 2. Verify HMAC signature
      if (
        !verifySlackSignature(
          rawBody,
          signature,
          timestamp,
          process.env.SLACK_SIGNING_SECRET!
        )
      ) {
        return NextResponse.json(
          { error: 'Invalid signature' },
          { status: 401 }
        )
      }

      // 3. Parse JSON
      const payload = JSON.parse(rawBody)

      // 4. Handle Slack URL verification challenge (one-time setup handshake)
      if (payload.type === 'url_verification') {
        return NextResponse.json({ challenge: payload.challenge })
      }

      // 5. Identify workspace by Slack team_id
      const teamId: string = payload.team_id ?? payload.team?.id ?? ''
      if (!teamId) return new NextResponse(null, { status: 200 })

      const integration = await prisma.slackIntegration.findFirst({
        where: { slackTeamId: teamId },
        select: { id: true, workspaceId: true, accessToken: true },
      })
      if (!integration) return new NextResponse(null, { status: 200 })

      const token = decrypt(integration.accessToken)

      // 6. Route to the correct handler branch
      let commandText = ''
      let responseUrl = ''
      let channelId = ''
      let slackUserId = ''

      if (
        payload.type === 'event_callback' &&
        payload.event?.type === 'app_mention'
      ) {
        // @Lumo mention — strip the "<@BOTID> " prefix
        const raw: string = payload.event.text ?? ''
        commandText = raw.replace(/^<@[^>]+>\s*/, '').trim()
        channelId = payload.event.channel
        slackUserId = payload.event.user
      } else if (payload.command) {
        // /lumo slash command
        commandText = payload.text ?? ''
        responseUrl = payload.response_url ?? ''
        channelId = payload.channel_id
        slackUserId = payload.user_id
      } else {
        // Unhandled event type — acknowledge silently
        return new NextResponse(null, { status: 200 })
      }

      // 7. Execute command asynchronously — must return 200 within 3 s for slash commands
      const executeCommand = async () => {
        const result: CommandResult = await handleCommand(
          commandText,
          slackUserId,
          token,
          integration.workspaceId
        )

        const messageBody =
          result.type === 'blocks'
            ? { blocks: result.blocks }
            : { text: result.text }

        if (responseUrl) {
          // Slash command response — post back to the response_url provided by Slack
          await fetch(responseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...messageBody,
              response_type: 'in_channel',
            }),
          })
        } else {
          // Mention — reply in the same channel
          await fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ channel: channelId, ...messageBody }),
          })
        }
      }

      // Fire-and-forget — must return 200 before the 3 s Slack timeout
      executeCommand().catch(err =>
        console.error('[slack webhook] command error:', err)
      )

      return new NextResponse(null, { status: 200 })
    } catch (error) {
      console.error('POST /api/webhooks/slack error:', error)
      // Always return 200 so Slack does not retry
      return new NextResponse(null, { status: 200 })
    }
  }
  ```

  **Important:** `prisma.slackIntegration` and its `slackTeamId` field are defined in Plan 1. If the field is named differently (e.g. `teamId`), read `prisma/schema.prisma` and adjust accordingly before running tsc.

- [ ] Run TypeScript check:

  ```bash
  cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit
  ```

  Expected: no errors. If `slackIntegration` is not on the Prisma client yet (Plan 1 not run), you will see a type error on `prisma.slackIntegration` — that is expected and means Plan 1 must be completed first.

- [ ] Commit: `feat: add Slack webhook route`

---

### Task 4: lib/slack/notify.ts — Outbound notification helpers

- [ ] **Read `lib/slack/types.ts`** to confirm the exact exported types: `SlackEventType` (string union), `NotificationPayload` (interface fields), and `SLACK_EVENT_LABELS` (Record). All field names in `notify.ts` must match what Plan 1 defined.

- [ ] **Read `lib/crypto.ts`** to confirm the `decrypt` function signature — it is `decrypt(stored: string): string` from `@/lib/crypto`.

- [ ] **Read `prisma/schema.prisma`** to confirm `SlackIntegration` has `accessToken` and a `channels` relation to `SlackChannel`, and that `SlackChannel` has `channelId` (String) and `events` (String[]) fields. Adjust field names below if they differ.

- [ ] Create `lib/slack/notify.ts`:

  ```typescript
  import { prisma } from '@/lib/db/prisma'
  import { decrypt } from '@/lib/crypto'
  import {
    SlackEventType,
    NotificationPayload,
    SLACK_EVENT_LABELS,
  } from './types'

  const EMOJI: Record<SlackEventType, string> = {
    task_assigned: '👤',
    task_in_review: '🔍',
    task_done: '✅',
    task_sent_back: '↩️',
    pr_opened: '🔀',
    pr_merged: '🎉',
    comment_mention: '💬',
  }

  function buildBlocks(
    event: SlackEventType,
    payload: NotificationPayload
  ): object[] {
    const emoji = EMOJI[event]
    const label = SLACK_EVENT_LABELS[event]
    const url = payload.taskUrl

    const lines: string[] = [`${emoji} *${label}*`]
    if (payload.taskIdentifier && payload.taskTitle) {
      lines.push(`${payload.taskIdentifier} · ${payload.taskTitle}`)
    }
    if (payload.actorName) lines.push(`_by ${payload.actorName}_`)
    if (payload.prTitle) {
      lines.push(
        `PR: <${payload.prUrl}|#${payload.prNumber} ${payload.prTitle}>`
      )
    }
    if (payload.commentBody) {
      lines.push(`> ${payload.commentBody.slice(0, 120)}`)
    }

    const blocks: object[] = [
      { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
    ]

    if (url) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Open in Lumo ↗' },
            url,
          },
        ],
      })
    }

    return blocks
  }

  async function getIntegrationToken(
    workspaceId: string
  ): Promise<string | null> {
    const integration = await prisma.slackIntegration.findUnique({
      where: { workspaceId },
      select: { accessToken: true },
    })
    if (!integration) return null
    return decrypt(integration.accessToken)
  }

  async function postToChannel(
    token: string,
    channelId: string,
    blocks: object[]
  ): Promise<void> {
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel: channelId, blocks }),
    })
  }

  async function lookupSlackUserByClerkId(
    clerkId: string,
    token: string
  ): Promise<string | null> {
    try {
      const { createClerkClient } = await import('@clerk/nextjs/server')
      const clerk = createClerkClient({
        secretKey: process.env.CLERK_SECRET_KEY,
      })
      const user = await clerk.users.getUser(clerkId)
      const email = user.emailAddresses.find(
        e => e.id === user.primaryEmailAddressId
      )?.emailAddress
      if (!email) return null

      const res = await fetch(
        `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const data = await res.json()
      if (!data.ok) return null
      return data.user?.id ?? null
    } catch {
      return null
    }
  }

  /**
   * Send a notification to all configured SlackChannel rows that have this
   * event enabled. Fire-and-forget safe — never throws.
   */
  export async function sendChannelNotification(
    workspaceId: string,
    event: SlackEventType,
    payload: NotificationPayload
  ): Promise<void> {
    try {
      const integration = await prisma.slackIntegration.findUnique({
        where: { workspaceId },
        select: {
          accessToken: true,
          channels: { select: { channelId: true, events: true } },
        },
      })
      if (!integration) return

      const token = decrypt(integration.accessToken)
      const blocks = buildBlocks(event, payload)

      const targetChannels = integration.channels.filter(c =>
        c.events.includes(event)
      )

      await Promise.allSettled(
        targetChannels.map(c => postToChannel(token, c.channelId, blocks))
      )
    } catch (error) {
      console.error(
        `[slack notify] sendChannelNotification error (${event}):`,
        error
      )
    }
  }

  /**
   * Send a DM to a Lumo workspace member identified by Clerk ID.
   * Resolves their Slack user via primary email. Gracefully no-ops if not found.
   * Fire-and-forget safe — never throws.
   */
  export async function sendDMNotification(
    workspaceId: string,
    recipientClerkId: string,
    event: SlackEventType,
    payload: NotificationPayload
  ): Promise<void> {
    try {
      const token = await getIntegrationToken(workspaceId)
      if (!token) return

      const slackUserId = await lookupSlackUserByClerkId(
        recipientClerkId,
        token
      )
      if (!slackUserId) return

      // Open or retrieve the DM channel for this user
      const openRes = await fetch('https://slack.com/api/conversations.open', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ users: slackUserId }),
      })
      const openData = await openRes.json()
      if (!openData.ok) return

      const blocks = buildBlocks(event, payload)
      await postToChannel(token, openData.channel.id, blocks)
    } catch (error) {
      console.error(
        `[slack notify] sendDMNotification error (${event}):`,
        error
      )
    }
  }
  ```

- [ ] Run TypeScript check:

  ```bash
  cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] Commit: `feat: add Slack notification helpers`

---

### Task 5: Hook Notifications Into Existing Code

> **CRITICAL:** Read every target file in full before editing it. The exact variable names, import locations, and surrounding code matter. Do not edit from memory — the snippets below describe intent and show representative code; the actual insertion points depend on what you see in the file.

#### 5a. lib/notifications/notifyTaskInReview.ts

- [ ] **Read `lib/notifications/notifyTaskInReview.ts` in full** before editing.

  Observations from the current file:
  - The function signature is `notifyTaskInReview({ workspaceId, taskId, reviewerId, defaultReviewerId, actorId })`.
  - `effectiveReviewerId` is set at line 17.
  - The function does NOT currently have access to the task's `title`, `number`, team `identifier`, or workspace `slug` — only the IDs.
  - Therefore, a Prisma query to fetch this additional data is required before calling `sendChannelNotification`.

  After the final `prisma.notification.createMany(...)` call (or after the `prisma.notification.create(...)` in the `if (effectiveReviewerId)` branch), add:

  ```typescript
  // Slack: send channel + DM notification for task_in_review
  // Import at top of file: import { sendChannelNotification, sendDMNotification } from '@/lib/slack/notify'
  const taskForSlack = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      title: true,
      number: true,
      team: {
        select: {
          identifier: true,
          workspace: { select: { id: true, slug: true } },
        },
      },
    },
  })
  if (taskForSlack) {
    const identifier = `${taskForSlack.team.identifier}-${taskForSlack.number}`
    const wsId = taskForSlack.team.workspace.id
    const taskUrl = `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${taskForSlack.team.workspace.slug}/task/${taskId}`
    void sendChannelNotification(wsId, 'task_in_review', {
      taskId,
      taskTitle: taskForSlack.title,
      taskIdentifier: identifier,
      taskUrl,
    })
    const effectiveReviewerClerkId = effectiveReviewerId
      ? ((
          await prisma.workspaceMember.findUnique({
            where: { id: effectiveReviewerId },
            select: { clerkId: true },
          })
        )?.clerkId ?? null)
      : null
    if (effectiveReviewerClerkId) {
      void sendDMNotification(
        wsId,
        effectiveReviewerClerkId,
        'task_in_review',
        {
          taskId,
          taskTitle: taskForSlack.title,
          taskIdentifier: identifier,
          taskUrl,
        }
      )
    }
  }
  ```

  Add the import at the top of the file:

  ```typescript
  import {
    sendChannelNotification,
    sendDMNotification,
  } from '@/lib/slack/notify'
  ```

  Place the Slack block at the very end of the function, after all existing DB writes, so it never interferes with the notification creation logic.

#### 5b. app/api/tasks/[id]/route.ts — PATCH handler

- [ ] **Read `app/api/tasks/[id]/route.ts` in full** before editing. Key observations from the current file:
  - `workspaceId` is set at line 234: `const workspaceId = task.project.workspaceId`
  - The `task_in_review` notification fires at lines 237–244 (calls `notifyTaskInReview`).
  - The `task_assigned` notification block is at lines 247–271. The new assignee's `clerkId` is fetched inside `.then(assignee => ...)`.
  - The `task_sent_back` notification block is at lines 273–294. The assignee's `clerkId` is fetched inside `.then(assignee => ...)`.
  - `task.team.identifier` and `task.number` are available via the `include` at lines 113–118. However, `updated` (the result of `prisma.task.update`) also includes `team.identifier` via its own `include` at lines 228–231.
  - `NEXT_PUBLIC_APP_URL` is used for URL construction. The workspace slug is NOT currently selected in this handler's queries — you will need to add `workspace: { select: { slug: true } }` to the `include` on the initial `prisma.task.findUnique` at lines 111–119, or query it separately.

  Add the import at the top of the file (alongside the existing `notifyTaskInReview` import):

  ```typescript
  import {
    sendChannelNotification,
    sendDMNotification,
  } from '@/lib/slack/notify'
  ```

  **For `task_assigned`:** Immediately after `prisma.task.update(...)` at line 225 resolves into `updated`, and after the existing DB notification `.then()` chain, add a parallel fire-and-forget Slack channel notification:

  ```typescript
  // After the existing task_assigned notification block (lines 247–271):
  if (
    parsed.data.assigneeId !== undefined &&
    parsed.data.assigneeId !== null &&
    parsed.data.assigneeId !== task.assigneeId
  ) {
    void sendChannelNotification(workspaceId, 'task_assigned', {
      taskId: id,
      taskTitle: updated.title,
      taskIdentifier: `${updated.team.identifier}-${task.number}`,
      taskUrl: `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${workspaceSlug}/task/${id}`,
    })
    // DM the new assignee if their clerkId is not the actor
    prisma.workspaceMember
      .findUnique({
        where: { id: parsed.data.assigneeId },
        select: { clerkId: true },
      })
      .then(assignee => {
        if (!assignee || assignee.clerkId === userId) return
        void sendDMNotification(
          workspaceId,
          assignee.clerkId,
          'task_assigned',
          {
            taskId: id,
            taskTitle: updated.title,
            taskIdentifier: `${updated.team.identifier}-${task.number}`,
            taskUrl: `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${workspaceSlug}/task/${id}`,
          }
        )
      })
      .catch(err => console.error('[slack] task_assigned DM failed:', err))
  }
  ```

  **For `task_done`:** After checking `parsed.data.status === 'DONE'`, add:

  ```typescript
  if (parsed.data.status === 'DONE' && task.status !== 'DONE') {
    const dmPayload = {
      taskId: id,
      taskTitle: updated.title,
      taskIdentifier: `${updated.team.identifier}-${task.number}`,
      taskUrl: `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${workspaceSlug}/task/${id}`,
    }
    void sendChannelNotification(workspaceId, 'task_done', dmPayload)
    // DM the assignee if task had one
    if (task.assigneeId) {
      const assignee = await prisma.workspaceMember.findUnique({
        where: { id: task.assigneeId },
        select: { clerkId: true },
      })
      if (assignee)
        void sendDMNotification(
          workspaceId,
          assignee.clerkId,
          'task_done',
          dmPayload
        )
    }
  }
  ```

  Note: `sendDMNotification` must be included in the import line — see the import added above.

  **For `task_sent_back`:** After the existing `task_sent_back` DB notification block (lines 273–294), add:

  ```typescript
  if (parsed.data.status === 'TODO' && task.status === 'IN_REVIEW') {
    const sentBackPayload = {
      taskId: id,
      taskTitle: updated.title,
      taskIdentifier: `${updated.team.identifier}-${task.number}`,
      taskUrl: `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${workspaceSlug}/task/${id}`,
    }
    void sendChannelNotification(workspaceId, 'task_sent_back', sentBackPayload)
    // DM the assignee if task had one
    if (task.assigneeId) {
      const assignee = await prisma.workspaceMember.findUnique({
        where: { id: task.assigneeId },
        select: { clerkId: true },
      })
      if (assignee)
        void sendDMNotification(
          workspaceId,
          assignee.clerkId,
          'task_sent_back',
          sentBackPayload
        )
    }
  }
  ```

  Read the existing block first to confirm `task.assigneeId` is available and adjust the status transition condition if the existing guard differs.

  **Workspace slug:** Because the current query does not select `workspace.slug`, add it to the `prisma.task.findUnique` include:

  ```typescript
  // In the findUnique at lines 111–119, add to the project include:
  project: {
    include: {
      defaultReviewer: { select: { id: true, clerkId: true } },
      workspace: { select: { slug: true } },   // <-- add this line
    },
  },
  ```

  Then declare `workspaceSlug` immediately after `workspaceId` is set (line 234), BEFORE the `task_assigned` / `task_done` / `task_sent_back` Slack blocks that reference it:

  ```typescript
  const workspaceId = task.project.workspaceId
  const workspaceSlug = task.project.workspace.slug // <-- must come before taskUrl construction
  ```

#### 5c. app/api/tasks/[id]/comments/route.ts

- [ ] **Read `app/api/tasks/[id]/comments/route.ts` in full** before editing. Key observations:
  - Mention extraction logic is at lines 113–144.
  - `workspaceId` is `task.project.workspaceId` (set at line 125).
  - `mentionedIds` is a `string[]` of Clerk user IDs (not WorkspaceMember IDs).
  - The existing code fires `prisma.notification.createMany(...)` inside a `.then()` chain.
  - `comment.id` and `commentBody` (the raw HTML) are both available after `prisma.comment.create`.

  Add the import at the top:

  ```typescript
  import { sendDMNotification } from '@/lib/slack/notify'
  ```

  Inside the `.then(members => { ... })` block that already exists at line 131, after the `prisma.notification.createMany(...)` call, add:

  ```typescript
  // Send Slack DM to each mentioned user
  for (const m of members) {
    void sendDMNotification(workspaceId, m.clerkId, 'comment_mention', {
      taskId: id,
      taskTitle: task.title,
      commentBody: commentBody.replace(/<[^>]+>/g, '').slice(0, 200), // strip HTML tags
      taskUrl: `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${workspaceSlug}/task/${id}`,
    })
  }
  ```

  Note: `task.title` is NOT currently selected in the POST handler's `prisma.task.findUnique` at line 61. Add `title: true` to the select. Also, `workspaceSlug` requires adding `workspace: { select: { slug: true } }` to the project include. Read the current findUnique call carefully and extend it minimally.

#### 5d. app/api/webhooks/github/handlers.ts

- [ ] **Read `app/api/webhooks/github/handlers.ts` in full** before editing. Key observations:
  - `task` is the result of `findTaskForBranch` — it is a `Task & { project: Pick<Project, 'defaultReviewerId' | 'workspaceId'> }`.
  - `task.id`, `task.status`, `task.reviewerId`, `task.number` are all directly available.
  - `task.team.identifier` and `task.workspace.slug` are NOT currently selected — `findTaskForBranch` only includes `project`. Read the include at lines 52–61 and extend it.
  - `pr.number`, `pr.title`, `pr.html_url` are available from the `GitHubPR` type.
  - `workspaceId` is a parameter to `handlePullRequest`.

  Add the import at the top of the file (alongside the existing `notifyTaskInReview` import):

  ```typescript
  import {
    sendChannelNotification,
    sendDMNotification,
  } from '@/lib/slack/notify'
  ```

  Extend `findTaskForBranch` to also select `team.identifier` and `workspace.slug`:

  ```typescript
  // In prisma.task.findFirst inside findTaskForBranch, extend include:
  include: {
    project: { select: { defaultReviewerId: true, workspaceId: true } },
    team: { select: { identifier: true } },
    // Note: Task → Workspace requires going through Team: team.workspace
    // Add workspace select via team if supported, OR query workspace separately
  },
  ```

  Check whether `Task` in the Prisma schema has a direct `workspace` relation. Looking at the schema: `Task` has `teamId` → `Team` → `workspaceId` → `Workspace`. There is no direct `task.workspace` relation. You must either extend the `findTaskForBranch` query to also select `team: { include: { workspace: { select: { slug: true } } } }`, or fetch the workspace slug with a second query after you know the `workspaceId`.

  The simplest approach is to add a `workspace` query inside `handlePullRequest` after the `findTaskForBranch` call returns a non-null task:

  ```typescript
  // After: if (!task) return
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { slug: true },
  })
  const workspaceSlug = workspace?.slug ?? ''
  const taskIdentifier = `${task.team.identifier}-${task.number}`
  const taskUrl = `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${workspaceSlug}/task/${task.id}`
  ```

  **For `pr_opened`:** Inside the `if (action === 'opened' || action === 'reopened')` block, after the existing `notifyTaskInReview` call, add:

  ```typescript
  const payload = {
    taskId: task.id,
    taskTitle: task.title,
    taskIdentifier,
    taskUrl,
    prNumber: pr.number,
    prTitle: pr.title,
    prUrl: pr.html_url,
  }
  void sendChannelNotification(workspaceId, 'pr_opened', payload)
  // DM the reviewer if task has one
  if (task?.reviewerId) {
    const reviewer = await prisma.workspaceMember.findUnique({
      where: { id: task.reviewerId },
      select: { clerkId: true },
    })
    if (reviewer)
      void sendDMNotification(
        workspaceId,
        reviewer.clerkId,
        'pr_opened',
        payload
      )
  }
  ```

  **For `pr_merged` + `task_done`:** Inside `else if (action === 'closed' && pr.merged)`, after `prisma.task.update(...)`, add:

  ```typescript
  const mergePayload = {
    taskId: task.id,
    taskTitle: task.title,
    taskIdentifier,
    taskUrl,
    prNumber: pr.number,
    prTitle: pr.title,
    prUrl: pr.html_url,
  }
  void sendChannelNotification(workspaceId, 'pr_merged', mergePayload)
  // DM the assignee on PR merge
  if (task?.assigneeId) {
    const assignee = await prisma.workspaceMember.findUnique({
      where: { id: task.assigneeId },
      select: { clerkId: true },
    })
    if (assignee)
      void sendDMNotification(
        workspaceId,
        assignee.clerkId,
        'pr_merged',
        mergePayload
      )
  }
  const taskDonePayload = {
    taskId: task.id,
    taskTitle: task.title,
    taskIdentifier,
    taskUrl,
  }
  void sendChannelNotification(workspaceId, 'task_done', taskDonePayload)
  // DM the assignee for task_done (via PR merge)
  if (task?.assigneeId) {
    const assignee = await prisma.workspaceMember.findUnique({
      where: { id: task.assigneeId },
      select: { clerkId: true },
    })
    if (assignee)
      void sendDMNotification(
        workspaceId,
        assignee.clerkId,
        'task_done',
        taskDonePayload
      )
  }
  // Note: to also DM the task creator, look up task.createdByMemberId → workspaceMember.clerkId
  // and call sendDMNotification similarly, if that relation is available in the schema.
  ```

  Note: `task.title` is not currently in the `findTaskForBranch` query either. Add `title: true` to the task select inside `findTaskForBranch`, and update the return type annotation accordingly.

- [ ] Run TypeScript check after all sub-tasks are complete:

  ```bash
  cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit
  ```

  Expected: no errors. Fix any type errors before committing — do not suppress with `@ts-ignore`.

- [ ] Commit: `feat: hook Slack notifications into task, comment, and PR events`

---

## Environment Variables

Add to `.env.local` and `env.example`:

```bash
# Slack App credentials
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_SIGNING_SECRET=
```

These are already referenced in `lib/slack/bot.ts` (Task 1) and `app/api/webhooks/slack/route.ts` (Task 3).

---

## Slack App Configuration (Manual Steps)

After all code tasks are complete, configure the Slack app at https://api.slack.com/apps:

1. **Event Subscriptions** → Request URL: `https://your-domain.com/api/webhooks/slack`
   - Subscribe to bot events: `app_mention`
2. **Slash Commands** → Create `/lumo` command pointing to the same URL
3. **OAuth & Permissions** → Bot Token Scopes required:
   - `chat:write` — post messages
   - `channels:read` — list and inspect channels (required for `GET /api/slack/available-channels`)
   - `users:read` — resolve user IDs
   - `users:read.email` — look up users by email (DM routing)
   - `im:write` — open DM channels
   - `commands` — slash commands

---

## Definition of Done

- [ ] `npm install @chat-adapter/slack chat` succeeds with no blocking peer-dep errors
- [ ] `lib/slack/bot.ts` created and compiles
- [ ] `lib/slack/commands.ts` created; all 5 unit tests pass
- [ ] `app/api/webhooks/slack/route.ts` created; signature verification mirrors `lib/github/verify.ts` pattern
- [ ] `lib/slack/notify.ts` created; `sendChannelNotification` and `sendDMNotification` exported
- [ ] `lib/notifications/notifyTaskInReview.ts` extended with Slack hooks
- [ ] `app/api/tasks/[id]/route.ts` extended for `task_assigned`, `task_done`, `task_sent_back`
- [ ] `app/api/tasks/[id]/comments/route.ts` extended for `comment_mention` DMs
- [ ] `app/api/webhooks/github/handlers.ts` extended for `pr_opened`, `pr_merged`, `task_done`
- [ ] `npx tsc --noEmit` passes with zero errors after all tasks
- [ ] Env vars documented in `env.example`

---

DONE — `/Users/chaoli/Desktop/lumo/lumo/docs/superpowers/plans/2026-03-27-slack-bot-notifications.md`

# Slack Integration Design Spec

**Date:** 2026-03-27
**Status:** Draft

---

## Goal

Add a Slack integration to Lumo that:

1. Sends configurable outbound notifications to Slack channels and DMs.
2. Provides a bot that responds to `@Lumo` mentions and `/lumo` slash commands for reading/writing tasks.

---

## Architecture

**Approach:** Chat SDK (`@chat-adapter/slack`) for event handling and message sending. OAuth tokens stored encrypted in Prisma (our own `lib/crypto.ts`), not Chat SDK's state layer. Use `slackAdapter.withBotToken(token, callback)` to inject the token per request.

**Tech stack:**

- Next.js 14 App Router
- TypeScript
- Prisma / Neon
- `@chat-adapter/slack` from chat-sdk.dev
- `lib/crypto.ts` (AES-256-GCM)
- Clerk auth
- Tailwind / shadcn
- lucide-react

---

## Data Models

```prisma
model SlackIntegration {
  id            String   @id @default(cuid())
  workspaceId   String   @unique   // one per Lumo workspace
  installedBy   String?            // WorkspaceMember.id who installed (nullable for SetNull on member delete)
  installer     WorkspaceMember @relation("SlackInstaller", fields: [installedBy], references: [id], onDelete: SetNull)
  accessToken   String             // AES-256-GCM encrypted bot token
  slackTeamId   String             // Slack workspace/team ID
  slackTeamName String             // Slack workspace name (display)
  slackUserId   String             // Slack user ID of installer
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  workspace Workspace       @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  channels  SlackChannel[]

  @@index([slackTeamId])
  @@map("slack_integrations")
}

model SlackChannel {
  id            String   @id @default(cuid())
  integrationId String
  channelId     String             // Slack channel ID (e.g. C01234567)
  channelName   String             // Display name (e.g. #engineering)
  events        String[]           // Subset of: task_assigned, task_in_review,
                                   // task_done, task_sent_back,
                                   // pr_opened, pr_merged, comment_mention
  createdAt     DateTime @default(now())

  integration SlackIntegration @relation(fields: [integrationId], references: [id], onDelete: Cascade)

  @@unique([integrationId, channelId])
  @@index([integrationId])
  @@map("slack_channels")
}
```

Add `slackIntegration SlackIntegration?` to the `Workspace` model.

Add `slackInstalled SlackIntegration[] @relation("SlackInstaller")` to the `WorkspaceMember` model (back-relation for `installer`).

---

## API Routes

| Route                           | Method | Purpose                                                                 |
| ------------------------------- | ------ | ----------------------------------------------------------------------- |
| `/api/slack/oauth`              | GET    | Redirect to Slack OAuth with encrypted state                            |
| `/api/slack/callback`           | GET    | Exchange code → bot token, save encrypted to DB                         |
| `/api/slack/integration`        | GET    | Return `{ connected, teamName, slackUserId }` or `{ connected: false }` |
| `/api/slack/integration`        | DELETE | Revoke token, delete DB record                                          |
| `/api/slack/channels`           | GET    | List configured channels + events for this workspace                    |
| `/api/slack/channels`           | POST   | Add a channel with event subscriptions                                  |
| `/api/slack/channels/[id]`      | PATCH  | Update events for a channel                                             |
| `/api/slack/channels/[id]`      | DELETE | Remove a channel                                                        |
| `/api/slack/available-channels` | GET    | Fetch available channels list from Slack API                            |
| `/api/webhooks/slack`           | POST   | Receive all Slack events (mentions + slash commands)                    |

---

## OAuth Flow

1. Owner clicks "Connect Slack" → GET `/api/slack/oauth?workspaceUrl=lumo`
2. Server: verify owner, build state = `encrypt(JSON.stringify({ workspaceId, memberId, workspaceUrl }))`, redirect to Slack with state (including `workspaceUrl` so the callback can redirect without an extra DB lookup)
3. Slack redirects to `/api/slack/callback?code=...&state=...`
4. Server: decrypt state, verify membership, POST to `https://slack.com/api/oauth.v2.access` with code + client credentials
5. Receive `{ access_token, team.id, team.name, authed_user.id }`
6. Encrypt access_token, upsert `SlackIntegration`, redirect to `/workspace/{slug}/settings/integrations`

**Slack App scopes needed:**

```
chat:write, channels:read, users:read, users:read.email,
app_mentions:read, commands, im:write
```

**Env vars:**

```
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_SIGNING_SECRET=   # for webhook verification
NEXT_PUBLIC_APP_URL=    # already in .env.example for GitHub; required here for constructing the Slack redirect_uri
ENCRYPTION_KEY=         # already in .env.example; required for bot token encryption/decryption
```

---

## Bot (chat-sdk.dev)

### Initialization (`lib/slack/bot.ts`)

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
  // No state adapter — we manage tokens ourselves
})
```

### Webhook Route (`/api/webhooks/slack/route.ts`)

```typescript
export async function POST(request: NextRequest) {
  // 1. Read raw body as text
  // 2. Verify Slack signature (X-Slack-Signature + X-Slack-Request-Timestamp, 5-min window)
  //    using SLACK_SIGNING_SECRET directly — this happens before DB lookup
  // 3. Parse JSON, extract team_id
  // 4. Look up SlackIntegration by team_id
  // 5. Decrypt token
  // 6. slackAdapter.withBotToken(token, () => bot.handleRequest(request))
}
```

> **Note — Chat SDK verification:** Chat SDK's `bot.handleRequest()` performs Slack signature verification internally using the `signingSecret` passed to `createSlackAdapter`. The 5-minute timestamp window is enforced by the SDK. Our webhook route must pass the raw request (not pre-parsed) to `bot.handleRequest()`.

> **Note — URL verification challenge:** Slack sends `{ type: "url_verification", challenge: "..." }` when first configuring the Events API endpoint. Chat SDK's `bot.handleRequest()` handles this automatically and responds with `{ challenge }`. No special handling needed in our route.

### Commands

Registered in `lib/slack/commands.ts`, wired into bot in `lib/slack/bot.ts`. Both `@Lumo <command>` and `/lumo <command>` invoke the same handler.

| Command     | Syntax                   | Action                                |
| ----------- | ------------------------ | ------------------------------------- |
| `status`    | `status ENG-123`         | Fetch task, reply with Block Kit card |
| `assign`    | `assign ENG-123 @user`   | Update task assignee, confirm         |
| `done`      | `done ENG-123`           | Set status DONE, confirm              |
| `in-review` | `in-review ENG-123`      | Set status IN_REVIEW, confirm         |
| `create`    | `create "title" in TEAM` | Create task, reply with link          |
| `my-tasks`  | `my-tasks`               | List caller's open tasks (top 5)      |
| `help`      | `help` or unknown input  | List available commands               |

### Task Card Format (Block Kit)

```
*ENG-123 · Fix authentication bug*
Status: In Review   Priority: High
Assignee: @john   Reviewer: @jane
Project: Backend
[Open in Lumo ↗]
```

### Auth in Commands

Resolve Slack user → Lumo member by email (`users.lookupByEmail` → match `WorkspaceMember.clerkId` via Clerk API or email). If no Lumo member matches the Slack user's email, reply with an error: "Your Slack account is not linked to a Lumo account in this workspace. Please use the same email in both."

### `TEAM` Resolution

In `create "title" in TEAM`, the `TEAM` argument resolves via `Team.findFirst({ where: { workspaceId, identifier: TEAM.toUpperCase() } })`, where `workspaceId` comes from the `SlackIntegration` looked up by `slackTeamId`.

---

## Notifications

### `lib/slack/notify.ts` exports

```typescript
sendChannelNotification(
  workspaceId: string,
  event: SlackEvent,
  payload: NotificationPayload
): Promise<void>

sendDMNotification(
  workspaceId: string,
  recipientClerkId: string,
  event: SlackEvent,
  payload: NotificationPayload
): Promise<void>
```

Both functions:

1. Load `SlackIntegration` for workspace (return silently if not connected)
2. Decrypt token, use `slackAdapter.withBotToken(token, ...)`
3. For channel: find `SlackChannel` records where `events` includes this event type
4. For DM: fetch Clerk user email via `clerkClient().users.getUser(clerkId)`, then call `users.lookupByEmail(email)` → get Slack user ID → open DM → send
5. Graceful degradation: log errors, never throw (notifications are non-critical)

### Hook-in Points

Call `sendChannelNotification` + `sendDMNotification` alongside existing DB notification creation:

| Event             | Hook location                                                               | DM recipient       |
| ----------------- | --------------------------------------------------------------------------- | ------------------ |
| `task_assigned`   | `app/api/tasks/[id]/route.ts` PATCH                                         | assignee           |
| `task_in_review`  | `lib/notifications/notifyTaskInReview.ts`                                   | reviewer           |
| `task_done`       | `app/api/tasks/[id]/route.ts` PATCH                                         | assignee + creator |
| `task_done`       | `app/api/webhooks/github/handlers.ts` (when PR merged + status set to DONE) | assignee + creator |
| `task_sent_back`  | `app/api/tasks/[id]/route.ts` PATCH (inline, same as `task_assigned`)       | assignee           |
| `pr_opened`       | `app/api/webhooks/github/handlers.ts`                                       | reviewer           |
| `pr_merged`       | `app/api/webhooks/github/handlers.ts`                                       | assignee           |
| `comment_mention` | `app/api/tasks/[id]/comments/route.ts`                                      | mentioned user     |

---

## Settings UI

### Files

- `app/workspace/[workspaceUrl]/components/pages/IntegrationsPage.tsx` — add `<SlackIntegrationCard>`
- `app/workspace/[workspaceUrl]/components/SlackIntegrationCard.tsx` — new component

### Card States

- **Disconnected:** Slack logo + description + "Connect Slack" button (owner only)
- **Connected:** team name, channel list with event badges, "Add channel" button, "Disconnect" button

### Add Channel Dialog

- Dropdown of available channels (fetched from `/api/slack/available-channels`)
- Checkboxes for each event type (all checked by default)
- "Save" → POST `/api/slack/channels`

### API Constants

Add to `app/workspace/[workspaceUrl]/constants.ts`:

```typescript
slack: {
  oauth: (workspaceUrl: string) => `/api/slack/oauth?workspaceUrl=${workspaceUrl}`,
  integration: '/api/slack/integration',
  channels: '/api/slack/channels',
  channelById: (id: string) => `/api/slack/channels/${id}`,
  availableChannels: '/api/slack/available-channels',
}
```

---

## Security

- Bot token encrypted at rest (AES-256-GCM via `lib/crypto.ts`)
- Webhook signature verified via `SLACK_SIGNING_SECRET` + timestamp check (5-min window) using Chat SDK's built-in verification
- OAuth state is encrypted (not plain workspaceId)
- All API routes require `requireAuth()` + workspace membership check
- Owner-only: connect/disconnect integration
- Notifications are fire-and-forget (never block critical path)

---

## File Map

### New Files

| File                                                               | Purpose                                                              |
| ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `prisma/schema.prisma`                                             | Add `SlackIntegration` + `SlackChannel` models                       |
| `lib/slack/bot.ts`                                                 | Chat SDK init                                                        |
| `lib/slack/commands.ts`                                            | Command parser + handlers                                            |
| `lib/slack/notify.ts`                                              | Outbound notification helpers                                        |
| `app/api/slack/oauth/route.ts`                                     | OAuth initiation                                                     |
| `app/api/slack/callback/route.ts`                                  | OAuth callback + token storage                                       |
| `app/api/slack/integration/route.ts`                               | GET + DELETE integration                                             |
| `app/api/slack/channels/route.ts`                                  | GET + POST channels                                                  |
| `app/api/slack/channels/[id]/route.ts`                             | PATCH + DELETE channel                                               |
| `app/api/slack/available-channels/route.ts`                        | List available Slack channels                                        |
| `app/api/webhooks/slack/route.ts`                                  | Inbound Slack events                                                 |
| `app/workspace/[workspaceUrl]/components/SlackIntegrationCard.tsx` | Settings UI card                                                     |
| `lib/slack/types.ts`                                               | Shared types: `SlackEventType` enum, `NotificationPayload` interface |

### Modified Files

| File                                                                 | Change                                                                 |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `app/workspace/[workspaceUrl]/components/pages/IntegrationsPage.tsx` | Add `<SlackIntegrationCard>`                                           |
| `app/workspace/[workspaceUrl]/constants.ts`                          | Add `slack` API constants                                              |
| `lib/notifications/notifyTaskInReview.ts`                            | Call `sendChannelNotification` + `sendDMNotification`                  |
| `app/api/tasks/[id]/route.ts`                                        | Hook `task_assigned`, `task_done`, `task_sent_back` notifications      |
| `app/api/tasks/[id]/comments/route.ts`                               | Hook `comment_mention` notifications                                   |
| `app/api/webhooks/github/handlers.ts`                                | Hook `pr_opened`, `pr_merged`, `task_done` (on PR merge) notifications |
| `.env.example`                                                       | Add `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`   |

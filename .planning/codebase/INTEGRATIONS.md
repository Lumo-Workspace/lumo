# External Integrations

**Analysis Date:** 2026-04-09

## APIs & External Services

**Authentication & Identity:**

- Clerk - User identity and authentication provider
  - SDK: `@clerk/nextjs` 7.0.8
  - Auth tokens: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
  - Supports: Google + GitHub OAuth (configured in Clerk dashboard)
  - Implementation: Middleware-based, per-route protection

**GitHub Integration:**

- OAuth 2.0 app (user-initiated) + GitHub App (workspace-wide)
- SDK: `@octokit/auth-app` 8.2.0
- Auth methods:
  - OAuth: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
  - App: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`
- Token encryption: AES-256-GCM via `ENCRYPTION_KEY`
- What it's used for:
  - Repository access and PR management
  - Branch creation from tasks
  - Webhook integration for PR/push events
- Entry points:
  - OAuth callback: `app/api/github/callback/route.ts`
  - Integration setup: `app/api/github/integration/route.ts`
  - Repo list: `app/api/github/authorized-repos/route.ts`
  - Webhooks: `app/api/webhooks/github/route.ts`
- Implementation modules: `lib/integrations/github/`
  - `auth.ts` - GitHub App token generation
  - `webhooks.ts` - Repo webhook registration/deletion
  - `verify.ts` - Webhook signature verification (HMAC-SHA256)
  - `sync.ts` - PR synchronization
  - `branch.ts` - Branch naming and parsing

**Slack Integration:**

- OAuth 2.0 app
- SDK: `@chat-adapter/slack` 4.23.0
- Auth: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`
- What it's used for:
  - Workspace notifications (task assignments, mentions, agent updates)
  - Channel subscriptions per project
  - Bot commands
  - Direct messages
- Entry points:
  - OAuth callback: `app/api/slack/callback/route.ts`
  - Channel list: `app/api/slack/available-channels/route.ts`
  - Integration config: `app/api/slack/integration/route.ts`
  - Channel subscribe/unsubscribe: `app/api/slack/channels/route.ts`
  - Webhooks: `app/api/webhooks/slack/route.ts`
- Implementation modules: `lib/integrations/slack/`
  - `bot.ts` - Slack bot adapter (message handling)
  - `commands.ts` - Command handler
  - `notify.ts` - Channel and DM notifications
  - `types.ts` - Event types and payloads

**Email Service:**

- Resend - Transactional email
- SDK: Resend 6.10.0
- Auth: `RESEND_API_KEY`
- What it's used for:
  - Workspace invitation emails
  - Task assignment notifications (future)
- Implementation modules: `lib/integrations/email/`
  - `client.ts` - Resend client initialization
  - `templates/invite.ts` - Invite email template
  - `types.ts` - Email options and result types

**Real-time Updates:**

- Pusher - WebSocket for real-time notifications
- SDK: `pusher` 5.3.3 (server), `pusher-js` 8.5.0 (client)
- Auth: `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`
- What it's used for:
  - Live task updates (status, assignments, comments)
  - Project updates
  - Agent progress events
  - Activity feed
- Channels:
  - `task-{taskId}` - Task-specific updates
  - `project-{projectId}` - Project updates
  - `user-{clerkId}` - User-specific notifications
- Implementation: `lib/integrations/pusher/`
  - `server.ts` - Pusher event publishing (push* and fire* functions)
  - `types.ts` - Event type definitions

**Cloud Storage:**

- Vercel Blob - File storage for workspace logos and documents
- SDK: `@vercel/blob` 2.3.2
- Auth: `BLOB_READ_WRITE_TOKEN` (injected on Vercel, required locally)
- What it's used for:
  - Workspace logo uploads
  - Document attachments
  - Image crops
- Entry points:
  - Image upload: `app/api/upload/image/route.ts`
  - Avatar upload: `app/api/users/profile/avatar/route.ts`

**Alternative Cloud Storage:**

- Google Cloud Storage - Archive/export option
- SDK: `@google-cloud/storage` 7.19.0
- Usage: Not actively used in core flows, available for future exports

---

## Data Storage

**Primary Database:**

- PostgreSQL via Neon (pooled + unpooled connections)
- Connection: `DATABASE_URL` (pooled via PgBouncer), `DATABASE_URL_UNPOOLED` (direct)

**ORM:**

- Prisma 7.6.0
- Client: `@prisma/client` 7.6.0
- Adapter: `@prisma/adapter-pg` 7.6.0 (extended pool support)
- Schema: `prisma/schema.prisma`
- Migrations: `prisma/migrations/`

**Data Models:**

- Workspace-centric architecture (clerkId as FK to users)
- Key entities:
  - `Workspace` - Team container
  - `WorkspaceMember` - User membership (clerkId)
  - `Project` - Team projects
  - `Task` - Self-referencing tree (parent/children)
  - `Document` - Markdown documents with tree hierarchy
  - `View` - Kanban/Document views with filters
  - `GitHubIntegration` - Per-member GitHub OAuth
  - `SlackIntegration` - Per-workspace Slack OAuth
  - `GitHubWebhook` - Repo webhook registrations
  - `PullRequest` - PR tracking
  - `AgentRun` - Agent execution history
  - `Comment` - Task comments (HTML with @mentions)
  - `Notification` - In-app notifications

---

## Authentication & Identity

**Auth Provider:**

- Clerk (Third-party)
- Implementation: `@clerk/nextjs` middleware, behind the `@/lib/auth` interface (`lib/auth/clerk/`, LUM-1026)
- Handles: User sign-up, sign-in, OAuth (Google, GitHub)
- Claims: `clerkId` stored as FK in all user-related tables
- Session management: Clerk JWT tokens + Next.js middleware

**Per-Workspace Auth:**

- Clerk provides user identity
- Lumo manages workspace membership via `WorkspaceMember` table
- Roles: `OWNER`, `MEMBER` (per workspace)

---

## Monitoring & Observability

**Error Tracking:**

- Not detected (no Sentry, Rollbar, or similar configured)

**Logs:**

- Console-based (restricted in production via ESLint rule `no-console: warn`)
- Structured logging: Via Prisma logging in development
- E2B sandbox logs: Available via sandbox health checks

**Metrics:**

- Pusher provides real-time channel metrics
- Vercel provides deployment/build metrics

---

## CI/CD & Deployment

**Hosting:**

- Vercel (primary platform)
- Environment: Node.js runtime

**CI/CD Pipeline:**

- Vercel Git integration (auto-deploy on push)
- Build script: `npm run build` (Prisma generate + Next.js build)
- Type-check: `npx tsc --noEmit`

**Git Hooks:**

- Pre-commit: Husky + lint-staged
  - ESLint fix + Prettier format on TS/JS files
  - Prettier format on JSON/Markdown

---

## Environment Configuration

**Required env vars (18 total):**

| Category          | Variables                                                               |
| ----------------- | ----------------------------------------------------------------------- |
| Database          | `DATABASE_URL`, `DATABASE_URL_UNPOOLED`                                 |
| Clerk             | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`                 |
| GitHub OAuth      | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`                              |
| GitHub App        | `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID` |
| GitHub Encryption | `ENCRYPTION_KEY` (for token storage)                                    |
| Slack OAuth       | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`                                |
| Slack Webhook     | `SLACK_SIGNING_SECRET`                                                  |
| Pusher            | `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`        |
| Storage           | `BLOB_READ_WRITE_TOKEN` (Vercel Blob)                                   |
| Email             | `RESEND_API_KEY`                                                        |
| AI                | `OPENAI_API_KEY` (if using OpenAI fallback)                             |
| App               | `NEXT_PUBLIC_APP_URL` (for invite links)                                |

**Secrets location:**

- Local: `.env.local` (git-ignored)
- Production: Vercel environment variables

---

## Webhooks & Callbacks

**Incoming (Webhook Endpoints):**

1. **GitHub Webhooks** (`app/api/webhooks/github/route.ts`)
   - Events: `pull_request`, `check_suite`, `push`
   - Triggers: PR creation/update, check runs, branch pushes
   - Signature verification: HMAC-SHA256 (X-Hub-Signature-256 header)
   - Processing: Handled by `lib/integrations/github/webhooks.ts`

2. **Slack Event Subscriptions** (`app/api/webhooks/slack/route.ts`)
   - Events: Message events, app mentions, slash commands
   - Signature verification: Slack signing secret (X-Slack-Request-Timestamp + X-Slack-Signature)
   - Processing: Handled by `lib/integrations/slack/bot.ts`

3. **E2B Sandbox Webhooks** (`app/api/webhooks/sandbox/route.ts`)
   - Events: Code execution completion, errors
   - Usage: Agent run progress updates

**Outgoing (API Calls):**

1. **GitHub REST API**
   - Create/delete branch webhooks
   - Fetch authorized repos
   - Get PR details, comments, checks
   - Client: `@octokit/auth-app` for App auth, Octokit REST client

2. **Slack Web API**
   - Send channel notifications (via `sendChannelNotification`)
   - Send direct messages (via `sendDMNotification`)
   - List channels, get user info
   - Client: Slack SDK (via `@chat-adapter/slack`)

3. **Resend API**
   - Send invitation emails
   - Client: `Resend` class from `resend` package

4. **Vercel Blob API**
   - Upload files (workspace logos, images)
   - Client: `@vercel/blob` SDK

5. **Pusher HTTP API**
   - Trigger real-time channel events
   - Client: `pusher` package (batch/fire methods)

6. **E2B Sandbox API**
   - Execute code in sandbox
   - Query execution status
   - Client: `@e2b/code-interpreter`

---

## Integration Entry Points

**By Directory (`lib/integrations/`):**

### GitHub (`lib/integrations/github/`)

- `index.ts` - Barrel export (public API)
- `auth.ts` - GitHub App token generation via `@octokit/auth-app`
- `webhooks.ts` - Create/delete repo webhooks
- `verify.ts` - HMAC signature verification
- `sync.ts` - Fetch and sync PRs from GitHub
- `branch.ts` - Branch naming schemes and parsing
- `types.ts` - TypeScript types

### Slack (`lib/integrations/slack/`)

- `index.ts` - Barrel export (public API)
- `bot.ts` - Slack bot message adapter
- `commands.ts` - Command handler for slash commands
- `notify.ts` - Functions to send channel/DM notifications
- `types.ts` - Slack event types and payloads
- `declarations.d.ts` - Type stubs for `@chat-adapter/slack`

### Email (`lib/integrations/email/`)

- `index.ts` - Barrel export (public API)
- `client.ts` - Resend client singleton
- `templates/invite.ts` - Invitation email HTML template
- `types.ts` - Email options and result types

### Pusher (`lib/integrations/pusher/`)

- `index.ts` - Barrel export (public API, currently empty)
- `server.ts` - Pusher event publishing (push*, fire* functions)
- `types.ts` - Event type definitions for agent, task, project, user events

### Sandbox (E2B) (`lib/integrations/sandbox/`)

- `index.ts` - Barrel export
- `mcp.ts` - MCP server installation in sandbox
- `proxy.ts` - Proxy requests to agent service
- `health.ts` - Sandbox health/liveness checks
- `types.ts` - Execution parameters and results

---

## Services Using Integrations

**Service Layer** (`lib/services/`):

- `github.service.ts` - GitHub integration wrapper (find webhooks, store integrations)
- `slack.service.ts` - Slack notifications and channel management
- `notification.service.ts` - Notification dispatching (in-app + Slack)

---

## Integration Security

**Token Storage:**

- GitHub OAuth tokens: AES-256-GCM encrypted, stored in `GitHubIntegration.accessToken`
- Slack tokens: Stored plaintext in `SlackIntegration.accessToken` (consider encryption)
- Webhook secrets: Stored plaintext in `GitHubIntegration.webhookSecret`, `SlackIntegration.slackTeamId`
- Encryption key: `ENCRYPTION_KEY` env var (must be 32 bytes hex)

**Signature Verification:**

- GitHub: HMAC-SHA256 on webhook body via `verifyGitHubSignature()` in `lib/integrations/github/verify.ts`
- Slack: Timestamp + signature via Slack SDK's built-in verification in `@chat-adapter/slack`

**Scopes & Permissions:**

- GitHub OAuth: Code integration + org access (configured in GitHub settings)
- GitHub App: Repository read/write, webhook access
- Slack: `chat:write`, `channels:read`, `users:read`, `commands`

---

## Error Handling

**Integration Errors:**

- GitHub webhook: Return 401 if signature doesn't match
- GitHub OAuth: Redirect with `github_error=1` param on failure
- Slack webhook: Return 401 if signing verification fails
- Pusher: Log to console, fire-and-forget on non-critical events
- Email: Throw if Resend not initialized, handle per-send failures

**User Feedback:**

- GitHub/Slack OAuth: Redirect query params (`github_error`, `slack_error`)
- Toast notifications via `sonner` for integration status changes
- Notification system for failed agent runs

---

_Integration audit: 2026-04-09_

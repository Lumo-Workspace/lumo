# Modular Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `lib/` into clear modules with explicit boundaries, add an integrations layer, slim oversized API routes, split the agent module, and fix frontend-layer violations.

**Architecture:** Bottom-up refactoring — build the integrations layer first, then split agent into services + integrations, then slim API routes, finally fix frontend. Every module gets `types.ts` (contract) + `index.ts` (barrel export).

**Tech Stack:** Next.js 14, TypeScript, Prisma, Clerk, Pusher, E2B, Resend, Slack API, GitHub API

**Spec:** `docs/superpowers/specs/2026-04-09-modular-refactoring-design.md`

---

## File Structure

### New Files to Create

```
lib/integrations/
├── github/types.ts, index.ts
├── slack/types.ts, index.ts
├── email/types.ts, index.ts
├── pusher/types.ts, index.ts
└── sandbox/types.ts, index.ts, execution.ts, mcp.ts, health.ts, proxy.ts

lib/services/
├── types.ts
├── agent-orchestration.service.ts
├── spec-generation.service.ts
├── clarification.service.ts
├── description.service.ts
├── notification-response.service.ts
├── quick-dispatch.service.ts
├── preference.service.ts

lib/utils/
├── sanitize.ts
├── markdown.ts
├── clerk-helpers.ts
```

### Files to Modify

```
lib/services/index.ts           — add new service exports
lib/services/task.service.ts    — add createTask, buildActivityEvents
lib/services/comment.service.ts — add notifyMentions
lib/services/notification.service.ts — add enrichNotifications
lib/services/github.service.ts  — add updateAuthorizedRepos, createBranchForTask
lib/services/slack.service.ts   — add createChannelWithInvite
lib/api-client/index.ts         — add new client exports
lib/api-client/tasks.ts         — add generateDescription
All 12 oversized API routes     — slim down
components/LogoUploader.tsx     — use api-client
components/task/AgentPanel.tsx   — use api-client
components/task/agent/AgentClarifyPanel.tsx — use api-client
```

### Files to Delete (after migration complete)

```
lib/github/          — replaced by lib/integrations/github/
lib/slack/           — replaced by lib/integrations/slack/
lib/email/           — replaced by lib/integrations/email/
lib/pusher/          — replaced by lib/integrations/pusher/
lib/agent/           — split into services + integrations/sandbox
lib/notifications/   — moved into services
```

---

## Phase 1: Create Integrations Layer

### Task 1: Create `lib/integrations/github/`

**Files:**

- Create: `lib/integrations/github/types.ts`
- Create: `lib/integrations/github/index.ts`
- Move: `lib/github/auth.ts` → `lib/integrations/github/auth.ts`
- Move: `lib/github/branch.ts` → `lib/integrations/github/branch.ts`
- Move: `lib/github/webhooks.ts` → `lib/integrations/github/webhooks.ts`
- Move: `lib/github/verify.ts` → `lib/integrations/github/verify.ts`
- Move: `lib/github/sync.ts` → `lib/integrations/github/sync.ts`
- Test: `__tests__/lib/integrations/github/index.test.ts`

- [ ] **Step 1: Create types.ts with interface definitions**

```typescript
// lib/integrations/github/types.ts

export interface GitHubCredentials {
  installationId: number
  appId: string
  privateKey: string
}

export interface BranchIdentifier {
  teamIdentifier: string
  number: number
}

export interface WebhookResult {
  hookId: number
}

export interface SyncRepoPRsParams {
  token: string
  fullName: string
  workspaceId: string
  integrationId: string
}
```

- [ ] **Step 2: Move files from `lib/github/` to `lib/integrations/github/`**

```bash
mkdir -p lib/integrations/github
cp lib/github/auth.ts lib/integrations/github/auth.ts
cp lib/github/branch.ts lib/integrations/github/branch.ts
cp lib/github/webhooks.ts lib/integrations/github/webhooks.ts
cp lib/github/verify.ts lib/integrations/github/verify.ts
cp lib/github/sync.ts lib/integrations/github/sync.ts
```

Update internal imports in `lib/integrations/github/sync.ts` — change:

```typescript
// OLD
import { parseBranchIdentifier, splitIdentifier } from '@/lib/github/branch'
// NEW
import { parseBranchIdentifier, splitIdentifier } from './branch'
```

- [ ] **Step 3: Create index.ts barrel export**

```typescript
// lib/integrations/github/index.ts

// Types
export type {
  GitHubCredentials,
  BranchIdentifier,
  WebhookResult,
  SyncRepoPRsParams,
} from './types'

// Auth
export { getGithubInstallationToken } from './auth'

// Branch utilities
export {
  parseBranchIdentifier,
  splitIdentifier,
  generateBranchName,
} from './branch'

// Webhooks
export { createRepoWebhook, deleteRepoWebhook } from './webhooks'

// Sync
export { syncRepoPRs } from './sync'

// Verification
export { verifyGitHubSignature } from './verify'
```

- [ ] **Step 4: Update all consumers to import from new path**

Find all files importing from `@/lib/github/`:

```bash
grep -r "from '@/lib/github/" --include="*.ts" --include="*.tsx" -l
```

For each file, change imports. Examples:

`lib/services/task.service.ts`:

```typescript
// OLD
import { getGithubInstallationToken } from '@/lib/github/auth'
// NEW
import { getGithubInstallationToken } from '@/lib/integrations/github'
```

`app/api/webhooks/github/route.ts`:

```typescript
// OLD
import { verifyGitHubSignature } from '@/lib/github/verify'
// NEW
import { verifyGitHubSignature } from '@/lib/integrations/github'
```

`app/api/webhooks/github/handlers.ts`:

```typescript
// OLD
import { parseBranchIdentifier, splitIdentifier } from '@/lib/github/branch'
// NEW
import {
  parseBranchIdentifier,
  splitIdentifier,
} from '@/lib/integrations/github'
```

`app/api/github/repos/route.ts`:

```typescript
// OLD
import { createRepoWebhook, deleteRepoWebhook } from '@/lib/github/webhooks'
import { syncRepoPRs } from '@/lib/github/sync'
// NEW
import {
  createRepoWebhook,
  deleteRepoWebhook,
  syncRepoPRs,
} from '@/lib/integrations/github'
```

`app/api/github/integration/route.ts`:

```typescript
// OLD
import { deleteRepoWebhook } from '@/lib/github/webhooks'
// NEW
import { deleteRepoWebhook } from '@/lib/integrations/github'
```

- [ ] **Step 5: Write test for barrel exports**

```typescript
// __tests__/lib/integrations/github/index.test.ts
import {
  getGithubInstallationToken,
  parseBranchIdentifier,
  splitIdentifier,
  generateBranchName,
  createRepoWebhook,
  deleteRepoWebhook,
  syncRepoPRs,
  verifyGitHubSignature,
} from '@/lib/integrations/github'

describe('lib/integrations/github barrel exports', () => {
  it('exports all public functions', () => {
    expect(typeof getGithubInstallationToken).toBe('function')
    expect(typeof parseBranchIdentifier).toBe('function')
    expect(typeof splitIdentifier).toBe('function')
    expect(typeof generateBranchName).toBe('function')
    expect(typeof createRepoWebhook).toBe('function')
    expect(typeof deleteRepoWebhook).toBe('function')
    expect(typeof syncRepoPRs).toBe('function')
    expect(typeof verifyGitHubSignature).toBe('function')
  })
})
```

- [ ] **Step 6: Run tests and verify**

```bash
npx tsc --noEmit
npm test -- --testPathPattern="integrations/github"
```

- [ ] **Step 7: Delete old `lib/github/` directory**

```bash
rm -rf lib/github/
```

Verify no remaining imports:

```bash
grep -r "from '@/lib/github/" --include="*.ts" --include="*.tsx"
```

- [ ] **Step 8: Commit**

```bash
git add lib/integrations/github/ __tests__/lib/integrations/github/
git add -u  # pick up deletions and modified imports
git commit -m "refactor: move lib/github to lib/integrations/github with types.ts + index.ts [LUM-0]"
```

---

### Task 2: Create `lib/integrations/slack/`

**Files:**

- Create: `lib/integrations/slack/types.ts`
- Create: `lib/integrations/slack/index.ts`
- Move: `lib/slack/types.ts` → merge into `lib/integrations/slack/types.ts`
- Move: `lib/slack/notify.ts` → `lib/integrations/slack/notify.ts`
- Move: `lib/slack/commands.ts` → `lib/integrations/slack/commands.ts`
- Move: `lib/slack/bot.ts` → `lib/integrations/slack/bot.ts`
- Move: `lib/slack/declarations.d.ts` → `lib/integrations/slack/declarations.d.ts`
- Test: `__tests__/lib/integrations/slack/index.test.ts`

- [ ] **Step 1: Create types.ts merging existing Slack types + new interface types**

```typescript
// lib/integrations/slack/types.ts

// ── Event types (migrated from lib/slack/types.ts) ──────────────────────

export type SlackEventType =
  | 'task_created'
  | 'task_assigned'
  | 'task_in_review'
  | 'task_done'
  | 'task_sent_back'
  | 'pr_opened'
  | 'pr_merged'
  | 'comment_mention'

export const ALL_SLACK_EVENTS: SlackEventType[] = [
  'task_created',
  'task_assigned',
  'task_in_review',
  'task_done',
  'task_sent_back',
  'pr_opened',
  'pr_merged',
  'comment_mention',
]

export const SLACK_EVENT_LABELS: Record<SlackEventType, string> = {
  task_created: 'Task Created',
  task_assigned: 'Task Assigned',
  task_in_review: 'Task In Review',
  task_done: 'Task Done',
  task_sent_back: 'Task Sent Back',
  pr_opened: 'PR Opened',
  pr_merged: 'PR Merged',
  comment_mention: 'Comment Mention',
}

export interface NotificationPayload {
  taskId?: string
  taskTitle?: string
  taskIdentifier?: string
  taskUrl?: string
  actorName?: string
  prNumber?: number
  prTitle?: string
  prUrl?: string
  commentBody?: string
}

// ── Command types ───────────────────────────────────────────────────────

export type CommandResult =
  | { type: 'blocks'; blocks: object[] }
  | { type: 'text'; text: string }
```

Read the existing `lib/slack/types.ts` to ensure the constants match exactly. Copy the values verbatim — the above is the expected shape.

- [ ] **Step 2: Move files to `lib/integrations/slack/`**

```bash
mkdir -p lib/integrations/slack
cp lib/slack/notify.ts lib/integrations/slack/notify.ts
cp lib/slack/commands.ts lib/integrations/slack/commands.ts
cp lib/slack/bot.ts lib/integrations/slack/bot.ts
cp lib/slack/declarations.d.ts lib/integrations/slack/declarations.d.ts
```

Update internal imports in `lib/integrations/slack/notify.ts`:

```typescript
// OLD
import {
  SlackEventType,
  NotificationPayload,
  SLACK_EVENT_LABELS,
} from './types'
// NEW — same path, but now points to the new merged types.ts
import {
  SlackEventType,
  NotificationPayload,
  SLACK_EVENT_LABELS,
} from './types'
```

(This import stays the same since it's relative.)

- [ ] **Step 3: Create index.ts barrel export**

```typescript
// lib/integrations/slack/index.ts

// Types and constants
export type {
  SlackEventType,
  NotificationPayload,
  CommandResult,
} from './types'
export { ALL_SLACK_EVENTS, SLACK_EVENT_LABELS } from './types'

// Notifications
export { sendChannelNotification, sendDMNotification } from './notify'

// Commands
export { handleCommand } from './commands'

// Bot
export { slackAdapter, bot } from './bot'
```

- [ ] **Step 4: Update all consumers to import from new path**

Find all files:

```bash
grep -r "from '@/lib/slack/" --include="*.ts" --include="*.tsx" -l
```

Update each consumer. Key files:

`app/api/slack/channels/route.ts`:

```typescript
// OLD
import { SlackEventType, ALL_SLACK_EVENTS } from '@/lib/slack/types'
// NEW
import { type SlackEventType, ALL_SLACK_EVENTS } from '@/lib/integrations/slack'
```

`app/api/tasks/[id]/comments/route.ts`:

```typescript
// OLD
import { sendDMNotification, sendChannelNotification } from '@/lib/slack/notify'
// NEW
import {
  sendDMNotification,
  sendChannelNotification,
} from '@/lib/integrations/slack'
```

`lib/notifications/notifyTaskChange.ts`:

```typescript
// OLD
import { sendChannelNotification, sendDMNotification } from '@/lib/slack/notify'
import type { SlackEventType, NotificationPayload } from '@/lib/slack/types'
// NEW
import {
  sendChannelNotification,
  sendDMNotification,
  type SlackEventType,
  type NotificationPayload,
} from '@/lib/integrations/slack'
```

`lib/services/slack.service.ts`:

```typescript
// OLD
import type { SlackEventType } from '@/lib/slack/types'
// NEW
import type { SlackEventType } from '@/lib/integrations/slack'
```

`app/api/webhooks/slack/route.ts`:

```typescript
// OLD
import { handleCommand } from '@/lib/slack/commands'
// NEW
import { handleCommand } from '@/lib/integrations/slack'
```

Apply similar changes to all remaining consumers found by grep.

- [ ] **Step 5: Write test for barrel exports**

```typescript
// __tests__/lib/integrations/slack/index.test.ts
import {
  ALL_SLACK_EVENTS,
  SLACK_EVENT_LABELS,
  sendChannelNotification,
  sendDMNotification,
  handleCommand,
  slackAdapter,
  bot,
} from '@/lib/integrations/slack'

describe('lib/integrations/slack barrel exports', () => {
  it('exports all public functions and constants', () => {
    expect(Array.isArray(ALL_SLACK_EVENTS)).toBe(true)
    expect(typeof SLACK_EVENT_LABELS).toBe('object')
    expect(typeof sendChannelNotification).toBe('function')
    expect(typeof sendDMNotification).toBe('function')
    expect(typeof handleCommand).toBe('function')
    expect(slackAdapter).toBeDefined()
    expect(bot).toBeDefined()
  })
})
```

- [ ] **Step 6: Run tests and verify**

```bash
npx tsc --noEmit
npm test -- --testPathPattern="integrations/slack"
```

- [ ] **Step 7: Delete old `lib/slack/` directory**

```bash
rm -rf lib/slack/
grep -r "from '@/lib/slack/" --include="*.ts" --include="*.tsx"
```

Verify zero results.

- [ ] **Step 8: Commit**

```bash
git add lib/integrations/slack/ __tests__/lib/integrations/slack/
git add -u
git commit -m "refactor: move lib/slack to lib/integrations/slack with types.ts + index.ts [LUM-0]"
```

---

### Task 3: Create `lib/integrations/email/`

**Files:**

- Create: `lib/integrations/email/types.ts`
- Create: `lib/integrations/email/index.ts`
- Move: `lib/email/resend.ts` → `lib/integrations/email/client.ts`
- Move: `lib/email/templates/invite.ts` → `lib/integrations/email/templates/invite.ts`
- Test: `__tests__/lib/integrations/email/index.test.ts`

- [ ] **Step 1: Create types.ts**

```typescript
// lib/integrations/email/types.ts

export interface InviteEmailOptions {
  workspaceName: string
  inviterName: string
  inviteUrl: string
}

export interface EmailContent {
  subject: string
  html: string
}
```

Read `lib/email/templates/invite.ts` to confirm the `InviteEmailOptions` fields match the actual function params.

- [ ] **Step 2: Move files**

```bash
mkdir -p lib/integrations/email/templates
cp lib/email/resend.ts lib/integrations/email/client.ts
cp lib/email/templates/invite.ts lib/integrations/email/templates/invite.ts
```

- [ ] **Step 3: Create index.ts**

```typescript
// lib/integrations/email/index.ts

export type { InviteEmailOptions, EmailContent } from './types'
export { getResend } from './client'
export { buildInviteEmail } from './templates/invite'
```

- [ ] **Step 4: Update consumers**

```bash
grep -r "from '@/lib/email/" --include="*.ts" --include="*.tsx" -l
```

`app/api/invites/route.ts` and `app/api/invites/[token]/resend/route.ts`:

```typescript
// OLD
import { getResend } from '@/lib/email/resend'
import { buildInviteEmail } from '@/lib/email/templates/invite'
// NEW
import { getResend, buildInviteEmail } from '@/lib/integrations/email'
```

- [ ] **Step 5: Write test, run, verify**

```typescript
// __tests__/lib/integrations/email/index.test.ts
import { getResend, buildInviteEmail } from '@/lib/integrations/email'

describe('lib/integrations/email barrel exports', () => {
  it('exports all public functions', () => {
    expect(typeof getResend).toBe('function')
    expect(typeof buildInviteEmail).toBe('function')
  })
})
```

```bash
npx tsc --noEmit
npm test -- --testPathPattern="integrations/email"
```

- [ ] **Step 6: Delete old `lib/email/`, commit**

```bash
rm -rf lib/email/
grep -r "from '@/lib/email/" --include="*.ts" --include="*.tsx"
git add lib/integrations/email/ __tests__/lib/integrations/email/
git add -u
git commit -m "refactor: move lib/email to lib/integrations/email with types.ts + index.ts [LUM-0]"
```

---

### Task 4: Create `lib/integrations/pusher/`

**Files:**

- Create: `lib/integrations/pusher/types.ts`
- Create: `lib/integrations/pusher/index.ts`
- Move: `lib/pusher/server.ts` → `lib/integrations/pusher/server.ts`
- Test: `__tests__/lib/integrations/pusher/index.test.ts`

- [ ] **Step 1: Create types.ts extracting event types from server.ts**

Read `lib/pusher/server.ts` fully to copy the exact type definitions. Then create:

```typescript
// lib/integrations/pusher/types.ts

export type AgentEvent =
  | {
      type: 'agent:started'
      runNumber: number
      steps?: { key: string; text: string; elapsedMs: number; status: string }[]
    }
  | { type: 'agent:thinking'; message: string }
  | { type: 'agent:tool'; tool: string; input: string }
  | { type: 'agent:progress'; message: string; key?: string }
  | { type: 'agent:clarify'; question: string; context: string | null }
  | { type: 'agent:spec_draft'; spec: string }
  | {
      type: 'agent:done'
      prUrl: string
      prNumber: number
      summary?: string
      changedFiles?: {
        path: string
        status: 'added' | 'modified' | 'deleted' | 'renamed'
      }[]
      durationMs?: number
    }
  | { type: 'agent:failed'; error: string }

export type TaskEvent =
  | { type: 'comment:created'; comment: Record<string, unknown> }
  | { type: 'comment:updated'; comment: Record<string, unknown> }
  | { type: 'comment:deleted'; commentId: string }
  | { type: 'task:updated'; patch: Record<string, unknown> }

export type ProjectEvent = {
  type: 'task:updated'
  taskId: string
  patch: Record<string, unknown>
}

export type UserEvent = {
  type: 'notification:new'
  notification: Record<string, unknown>
}

export type ActivityPusherEvent = {
  type: 'activity:created'
  entry: Record<string, unknown>
}
```

Read `lib/pusher/server.ts` to verify these types match the actual definitions exactly. Copy verbatim.

- [ ] **Step 2: Move server.ts and update its type imports**

```bash
mkdir -p lib/integrations/pusher
cp lib/pusher/server.ts lib/integrations/pusher/server.ts
```

In `lib/integrations/pusher/server.ts`, move the type definitions out and import from `types.ts`:

```typescript
// At the top of server.ts, replace inline type definitions with:
import type {
  AgentEvent,
  TaskEvent,
  ProjectEvent,
  UserEvent,
  ActivityPusherEvent,
} from './types'
```

Remove the inline type definitions that are now in `types.ts`.

- [ ] **Step 3: Create index.ts**

```typescript
// lib/integrations/pusher/index.ts

export type {
  AgentEvent,
  TaskEvent,
  ProjectEvent,
  UserEvent,
  ActivityPusherEvent,
} from './types'

export {
  pushAgentEvent,
  fireAgentEvent,
  pushTaskEvent,
  pushProjectEvent,
  pushUserEvent,
  pushActivityEvent,
} from './server'
```

- [ ] **Step 4: Update all consumers**

```bash
grep -r "from '@/lib/pusher/" --include="*.ts" --include="*.tsx" -l
```

This module has many consumers (~12 files). Update each one:

`lib/services/agent.service.ts`:

```typescript
// OLD
import { pushAgentEvent } from '@/lib/pusher/server'
// NEW
import { pushAgentEvent } from '@/lib/integrations/pusher'
```

`lib/events/handlers/record-activity.ts`:

```typescript
// OLD
import { pushActivityEvent } from '@/lib/pusher/server'
// NEW
import { pushActivityEvent } from '@/lib/integrations/pusher'
```

`lib/events/handlers/broadcast.ts`:

```typescript
// OLD
import { pushProjectEvent } from '@/lib/pusher/server'
// NEW
import { pushProjectEvent } from '@/lib/integrations/pusher'
```

`app/api/tasks/[id]/route.ts`:

```typescript
// OLD
import { pushTaskEvent, pushProjectEvent } from '@/lib/pusher/server'
// NEW
import { pushTaskEvent, pushProjectEvent } from '@/lib/integrations/pusher'
```

Apply the same pattern to all remaining consumers: `app/api/tasks/[id]/comments/route.ts`, `app/api/projects/[id]/tasks/batch/route.ts`, `app/api/webhooks/sandbox/route.ts`, `app/api/agent/mcp-clarify/route.ts`, `app/api/tasks/quick-dispatch/execute/route.ts`, `lib/notifications/notifyTaskChange.ts`, `lib/notifications/notifyAgentActions.ts`, `lib/notifications/notifyReviewerOrOwners.ts`.

Also update `lib/agent/execute.ts`, `lib/agent/generate-spec.ts`, `lib/agent/comment-handler.ts` (these will be moved later in Phase 2, but fix imports now so they work during transition).

- [ ] **Step 5: Write test, run, verify**

```typescript
// __tests__/lib/integrations/pusher/index.test.ts
import {
  pushAgentEvent,
  fireAgentEvent,
  pushTaskEvent,
  pushProjectEvent,
  pushUserEvent,
  pushActivityEvent,
} from '@/lib/integrations/pusher'

describe('lib/integrations/pusher barrel exports', () => {
  it('exports all public functions', () => {
    expect(typeof pushAgentEvent).toBe('function')
    expect(typeof fireAgentEvent).toBe('function')
    expect(typeof pushTaskEvent).toBe('function')
    expect(typeof pushProjectEvent).toBe('function')
    expect(typeof pushUserEvent).toBe('function')
    expect(typeof pushActivityEvent).toBe('function')
  })
})
```

```bash
npx tsc --noEmit
npm test -- --testPathPattern="integrations/pusher"
```

- [ ] **Step 6: Delete old `lib/pusher/`, commit**

```bash
rm -rf lib/pusher/
grep -r "from '@/lib/pusher/" --include="*.ts" --include="*.tsx"
git add lib/integrations/pusher/ __tests__/lib/integrations/pusher/
git add -u
git commit -m "refactor: move lib/pusher to lib/integrations/pusher with types.ts + index.ts [LUM-0]"
```

---

## Phase 2: Split Agent Module

### Task 5: Extract shared utilities from `lib/agent/`

**Files:**

- Create: `lib/utils/markdown.ts`
- Create: `lib/utils/sanitize.ts`
- Create: `lib/utils/clerk-helpers.ts`
- Move: `lib/agent/markdown.ts` → `lib/utils/markdown.ts`
- Move: `lib/agent/clerk-cache.ts` → `lib/utils/clerk-helpers.ts`
- Test: `__tests__/lib/utils/markdown.test.ts`

- [ ] **Step 1: Move markdown.ts to lib/utils/**

```bash
cp lib/agent/markdown.ts lib/utils/markdown.ts
```

No changes needed to the file content — it has no lib/ imports.

- [ ] **Step 2: Create sanitize.ts by extracting from generate-description route**

Read `app/api/tasks/generate-description/route.ts` lines 36-64 to get the exact `sanitizeHtml` function. Then:

```typescript
// lib/utils/sanitize.ts

const ALLOWED_TAGS = new Set([
  'p',
  'strong',
  'em',
  'code',
  'ul',
  'ol',
  'li',
  'input',
  'br',
])

/** Strip all HTML tags except the allowed set. Removes all attributes except type/checked on input. */
export function sanitizeHtml(html: string): string {
  return html.replace(
    /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/?>/g,
    (match, tag: string) => {
      const lower = tag.toLowerCase()
      if (!ALLOWED_TAGS.has(lower)) return ''
      if (lower === 'input') return '<input type="checkbox">'
      if (match.startsWith('</')) return `</${lower}>`
      if (match.endsWith('/>')) return `<${lower} />`
      return `<${lower}>`
    }
  )
}
```

Read the actual function to ensure this matches exactly.

- [ ] **Step 3: Create clerk-helpers.ts by merging clerk-cache + common patterns**

```typescript
// lib/utils/clerk-helpers.ts

import { clerkClient } from '@clerk/nextjs/server'

// ── Clerk user cache (migrated from lib/agent/clerk-cache.ts) ───────────

export interface CachedClerkUser {
  id: string
  firstName: string | null
  lastName: string | null
  imageUrl: string
  emailAddress: string | null
}

const cache = new Map<string, { user: CachedClerkUser; expiresAt: number }>()
const TTL_MS = 5 * 60 * 1000

export async function getClerkUser(clerkId: string): Promise<CachedClerkUser> {
  const cached = cache.get(clerkId)
  if (cached && cached.expiresAt > Date.now()) return cached.user

  const client = await clerkClient()
  const u = await client.users.getUser(clerkId)
  const user: CachedClerkUser = {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    imageUrl: u.imageUrl,
    emailAddress: u.emailAddresses[0]?.emailAddress ?? null,
  }
  cache.set(clerkId, { user, expiresAt: Date.now() + TTL_MS })
  return user
}

export function _clearClerkCache(): void {
  cache.clear()
}

// ── Batch user enrichment (extracted from 3+ API routes) ────────────────

export interface EnrichedUser {
  clerkId: string
  name: string
  imageUrl: string
}

export async function enrichClerkUsers(
  clerkIds: string[]
): Promise<Map<string, EnrichedUser>> {
  if (clerkIds.length === 0) return new Map()
  const client = await clerkClient()
  const users = await client.users.getUserList({
    userId: clerkIds,
    limit: clerkIds.length,
  })
  const map = new Map<string, EnrichedUser>()
  for (const u of users.data) {
    map.set(u.id, {
      clerkId: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Unknown',
      imageUrl: u.imageUrl,
    })
  }
  return map
}
```

Read `lib/agent/clerk-cache.ts` to ensure the cache implementation matches exactly.

- [ ] **Step 4: Update imports for markdown.ts consumers**

```bash
grep -r "from '.*agent/markdown'" --include="*.ts" --include="*.tsx" -l
```

Update each consumer:

```typescript
// OLD
import { htmlToMarkdown, markdownToHtml } from './markdown'
// or
import { htmlToMarkdown } from '@/lib/agent/markdown'
// NEW
import { htmlToMarkdown, markdownToHtml } from '@/lib/utils/markdown'
```

Apply to: `lib/agent/execute.ts`, `lib/agent/context-builder.ts`, `lib/agent/comment-handler.ts`, `lib/agent/generate-spec.ts`.

- [ ] **Step 5: Update imports for clerk-cache consumers**

```bash
grep -r "from '.*agent/clerk-cache'" --include="*.ts" --include="*.tsx" -l
```

Update `lib/agent/comment-handler.ts`:

```typescript
// OLD
import { getClerkUser } from './clerk-cache'
// NEW
import { getClerkUser } from '@/lib/utils/clerk-helpers'
```

- [ ] **Step 6: Write test for markdown utils**

```typescript
// __tests__/lib/utils/markdown.test.ts
import {
  markdownToHtml,
  htmlToMarkdown,
  isHtml,
  isMarkdown,
} from '@/lib/utils/markdown'

describe('markdown utils', () => {
  it('converts markdown to html', () => {
    const result = markdownToHtml('**bold**')
    expect(result).toContain('<strong>bold</strong>')
  })

  it('converts html to markdown', () => {
    const result = htmlToMarkdown('<strong>bold</strong>')
    expect(result).toContain('**bold**')
  })

  it('detects html', () => {
    expect(isHtml('<p>hello</p>')).toBe(true)
    expect(isHtml('hello')).toBe(false)
  })
})
```

- [ ] **Step 7: Run tests, verify, commit**

```bash
npx tsc --noEmit
npm test -- --testPathPattern="utils/markdown"
git add lib/utils/markdown.ts lib/utils/sanitize.ts lib/utils/clerk-helpers.ts
git add __tests__/lib/utils/
git add -u
git commit -m "refactor: extract shared utils (markdown, sanitize, clerk-helpers) from agent module [LUM-0]"
```

---

### Task 6: Create `lib/integrations/sandbox/`

**Files:**

- Create: `lib/integrations/sandbox/types.ts`
- Create: `lib/integrations/sandbox/index.ts`
- Move: `lib/agent/sandbox-mcp.ts` → `lib/integrations/sandbox/mcp.ts`
- Move: `lib/agent/sandbox-health.ts` → `lib/integrations/sandbox/health.ts`
- Move: `lib/agent/proxy.ts` → `lib/integrations/sandbox/proxy.ts`
- Create: `lib/integrations/sandbox/execution.ts` (extracted from `lib/agent/execute.ts`)
- Test: `__tests__/lib/integrations/sandbox/index.test.ts`

- [ ] **Step 1: Create types.ts**

```typescript
// lib/integrations/sandbox/types.ts

export interface McpEnvVars {
  callbackUrl: string
  callbackToken: string
  taskId: string
}

export interface SandboxExecutionParams {
  repoUrl: string
  branch: string
  githubToken: string
  anthropicKey: string
  taskSpec: string
  agentContext: string
  allowedTools: string[]
  mcpEnv: McpEnvVars
  gitName: string
  gitEmail: string
  timeoutMs?: number
}

export interface SandboxExecutionResult {
  exitCode: number
  stdout: string
  stderr: string
}
```

- [ ] **Step 2: Move infrastructure files**

```bash
mkdir -p lib/integrations/sandbox
cp lib/agent/sandbox-mcp.ts lib/integrations/sandbox/mcp.ts
cp lib/agent/sandbox-health.ts lib/integrations/sandbox/health.ts
cp lib/agent/proxy.ts lib/integrations/sandbox/proxy.ts
```

- [ ] **Step 3: Create execution.ts — extract sandbox lifecycle from execute.ts**

Read `lib/agent/execute.ts` fully. Identify the sandbox lifecycle functions (sandbox creation, git clone, checkout, Claude CLI invocation, cleanup). Extract them into:

```typescript
// lib/integrations/sandbox/execution.ts

import { Sandbox } from '@e2b/code-interpreter'
import { installMcpServer } from './mcp'
import type {
  SandboxExecutionParams,
  SandboxExecutionResult,
  McpEnvVars,
} from './types'

const SANDBOX_TIMEOUT_MS = 55 * 60 * 1000
const CLONE_TIMEOUT_MS = 2 * 60 * 1000
const INSTALL_TIMEOUT_MS = 3 * 60 * 1000

export async function createAndSetupSandbox(
  params: SandboxExecutionParams
): Promise<{ sandbox: Sandbox; sandboxId: string }> {
  // Create E2B sandbox — extract from execute.ts sandbox creation section
  // Clone repo — extract from execute.ts clone section
  // Checkout/create branch — extract from execute.ts branch section
  // Write task.md — extract from execute.ts file write section
  // Install MCP — call installMcpServer()
  // Return sandbox reference
  // ... (copy the exact implementation from execute.ts)
}

export async function runClaudeCodeInSandbox(
  sandbox: Sandbox,
  params: SandboxExecutionParams
): Promise<SandboxExecutionResult> {
  // Build Claude CLI command — extract from execute.ts
  // Execute in sandbox — extract from execute.ts
  // Return stdout/stderr/exitCode
  // ... (copy the exact implementation from execute.ts)
}

export async function cleanupSandbox(sandboxId: string): Promise<void> {
  // Kill sandbox — extract from execute.ts cleanup section
  // ... (copy the exact implementation from execute.ts)
}
```

**Important:** Read `lib/agent/execute.ts` in full to identify the exact code blocks to extract. The above shows the function signatures — copy the actual implementation verbatim from the corresponding sections in `execute.ts`.

- [ ] **Step 4: Create index.ts**

```typescript
// lib/integrations/sandbox/index.ts

export type {
  McpEnvVars,
  SandboxExecutionParams,
  SandboxExecutionResult,
} from './types'

export { installMcpServer, MCP_CONFIG_PATH } from './mcp'
export { isSandboxAlive } from './health'
export { isAgentServiceEnabled, proxyToAgentService } from './proxy'
export {
  createAndSetupSandbox,
  runClaudeCodeInSandbox,
  cleanupSandbox,
} from './execution'
```

- [ ] **Step 5: Update consumers of moved files**

`lib/agent/execute.ts` (still exists, will be further refactored in Task 7):

```typescript
// OLD
import { installMcpServer, MCP_CONFIG_PATH } from './sandbox-mcp'
// NEW
import { installMcpServer, MCP_CONFIG_PATH } from '@/lib/integrations/sandbox'
```

`lib/agent/comment-handler.ts`:

```typescript
// OLD
import { isSandboxAlive } from './sandbox-health'
// NEW
import { isSandboxAlive } from '@/lib/integrations/sandbox'
```

`app/api/notifications/[id]/respond/route.ts`:

```typescript
// OLD
import { isAgentServiceEnabled, proxyToAgentService } from '@/lib/agent/proxy'
// NEW
import {
  isAgentServiceEnabled,
  proxyToAgentService,
} from '@/lib/integrations/sandbox'
```

Update any other routes importing from `@/lib/agent/proxy`.

- [ ] **Step 6: Write test, run, verify, commit**

```typescript
// __tests__/lib/integrations/sandbox/index.test.ts
import {
  installMcpServer,
  MCP_CONFIG_PATH,
  isSandboxAlive,
  isAgentServiceEnabled,
  proxyToAgentService,
} from '@/lib/integrations/sandbox'

describe('lib/integrations/sandbox barrel exports', () => {
  it('exports all public functions', () => {
    expect(typeof installMcpServer).toBe('function')
    expect(typeof MCP_CONFIG_PATH).toBe('string')
    expect(typeof isSandboxAlive).toBe('function')
    expect(typeof isAgentServiceEnabled).toBe('function')
    expect(typeof proxyToAgentService).toBe('function')
  })
})
```

```bash
npx tsc --noEmit
npm test -- --testPathPattern="integrations/sandbox"
git add lib/integrations/sandbox/ __tests__/lib/integrations/sandbox/
git add -u
git commit -m "refactor: create lib/integrations/sandbox with mcp, health, proxy, execution [LUM-0]"
```

---

### Task 7: Create agent service layer

**Files:**

- Create: `lib/services/agent-orchestration.service.ts`
- Create: `lib/services/spec-generation.service.ts`
- Create: `lib/services/clarification.service.ts`
- Modify: `lib/services/index.ts` — add new service exports
- Modify: `lib/agent/execute.ts` — slim down to delegate to services + integrations
- Test: `__tests__/lib/services/agent-orchestration.test.ts`

- [ ] **Step 1: Create spec-generation.service.ts**

Read `lib/agent/generate-spec.ts` fully. Move its logic:

```typescript
// lib/services/spec-generation.service.ts

import { prisma } from '@/lib/db/prisma'
import { pushAgentEvent, fireAgentEvent } from '@/lib/integrations/pusher'
import { transitionAgentStatus } from '@/lib/agent/state-machine'
import { markdownToHtml } from '@/lib/utils/markdown'

// ... copy the entire implementation from lib/agent/generate-spec.ts
// replacing imports with new paths

export async function generateSpecDraft(taskId: string): Promise<void> {
  // ... exact copy of the function body from generate-spec.ts
}
```

Copy the function body verbatim from `lib/agent/generate-spec.ts`.

- [ ] **Step 2: Create clarification.service.ts**

Read `lib/agent/resume.ts` fully. Move its logic:

```typescript
// lib/services/clarification.service.ts

import { prisma } from '@/lib/db/prisma'
import { transitionAgentStatus } from '@/lib/agent/state-machine'

// ... copy the entire implementation from lib/agent/resume.ts
// replacing imports with new paths

export async function resumeAgent(params: {
  taskId: string
  workspaceId: string
  reply: string
}): Promise<void> {
  // ... exact copy of the function body from resume.ts
}
```

Copy verbatim from `lib/agent/resume.ts`.

- [ ] **Step 3: Create agent-orchestration.service.ts**

This is the largest new service. It consolidates business logic from `execute.ts`, `comment-handler.ts`, `context-builder.ts`, and `state-machine.ts`.

Read all four files. The service re-exports and delegates:

```typescript
// lib/services/agent-orchestration.service.ts

import { prisma } from '@/lib/db/prisma'
import {
  createAndSetupSandbox,
  runClaudeCodeInSandbox,
  cleanupSandbox,
  isAgentServiceEnabled,
  proxyToAgentService,
} from '@/lib/integrations/sandbox'
import {
  pushAgentEvent,
  fireAgentEvent,
  pushTaskEvent,
} from '@/lib/integrations/pusher'
import { getGithubInstallationToken } from '@/lib/integrations/github'
import {
  notifyAgentVerify,
  notifyAgentFailed,
} from '@/lib/notifications/notifyAgentActions'
import {
  transitionAgentStatus,
  clearAgentStatus,
  isValidTransition,
} from '@/lib/agent/state-machine'
import { transitionTaskStatus } from '@/lib/task/state-machine'
import { buildAgentContext } from '@/lib/agent/context-builder'
import { htmlToMarkdown } from '@/lib/utils/markdown'
import { dispatchEvents } from '@/lib/events/dispatcher'
import type { DomainEvent } from '@/lib/events/types'
import { generateSpecDraft } from './spec-generation.service'

// Re-export state machine for backward compatibility during migration
export { transitionAgentStatus, clearAgentStatus, isValidTransition }

// ── Types ────────────────────────────────────────────────────────────────

export type { AgentResult, ExecuteAgentOptions } from '@/lib/agent/execute'

// ── Orchestration ────────────────────────────────────────────────────────

// The actual orchestration functions are extracted from execute.ts.
// During initial migration, this service delegates to the existing
// execute.ts functions while we incrementally move logic.

export { executeAgent, processAgentCompletion } from '@/lib/agent/execute'
export {
  handleAgentComment,
  extractAgentInstruction,
  buildAgentSpec,
} from '@/lib/agent/comment-handler'
export { buildAgentContext } from '@/lib/agent/context-builder'
```

**Note:** This is a transitional step. The service initially re-exports from the existing agent files. In later phases, the actual logic moves into this file and `lib/agent/execute.ts` is deleted.

- [ ] **Step 4: Update lib/services/index.ts**

Read `lib/services/index.ts` and add:

```typescript
// Add these exports to the existing file
export { generateSpecDraft } from './spec-generation.service'
export { resumeAgent } from './clarification.service'
export {
  executeAgent,
  processAgentCompletion,
  handleAgentComment,
  extractAgentInstruction,
  buildAgentSpec,
  buildAgentContext,
  transitionAgentStatus,
  clearAgentStatus,
} from './agent-orchestration.service'
```

- [ ] **Step 5: Update API routes to import from services**

`app/api/agent/execute/route.ts`:

```typescript
// OLD
import { executeAgent } from '@/lib/agent/execute'
import { isAgentServiceEnabled, proxyToAgentService } from '@/lib/agent/proxy'
// NEW
import { executeAgent } from '@/lib/services'
import {
  isAgentServiceEnabled,
  proxyToAgentService,
} from '@/lib/integrations/sandbox'
```

`app/api/agent/resume/route.ts`:

```typescript
// OLD
import { resumeAgent } from '@/lib/agent/resume'
// NEW
import { resumeAgent } from '@/lib/services'
```

`app/api/notifications/[id]/respond/route.ts`:

```typescript
// OLD
import { resumeAgent } from '@/lib/agent/resume'
import {
  clearAgentStatus,
  transitionAgentStatus,
} from '@/lib/agent/state-machine'
import { executeAgent } from '@/lib/agent/execute'
// NEW
import {
  resumeAgent,
  executeAgent,
  clearAgentStatus,
  transitionAgentStatus,
} from '@/lib/services'
```

Apply similar changes to: `app/api/agent/confirm-spec/route.ts`, `app/api/agent/retry/route.ts`, `app/api/agent/sandbox-done/route.ts`, `app/api/agent/mcp-clarify/route.ts`, `app/api/webhooks/sandbox/route.ts`.

- [ ] **Step 6: Write test, run, verify, commit**

```typescript
// __tests__/lib/services/agent-orchestration.test.ts
import {
  executeAgent,
  processAgentCompletion,
  transitionAgentStatus,
  clearAgentStatus,
} from '@/lib/services/agent-orchestration.service'

describe('agent-orchestration.service barrel exports', () => {
  it('exports orchestration functions', () => {
    expect(typeof executeAgent).toBe('function')
    expect(typeof processAgentCompletion).toBe('function')
    expect(typeof transitionAgentStatus).toBe('function')
    expect(typeof clearAgentStatus).toBe('function')
  })
})
```

```bash
npx tsc --noEmit
npm test -- --testPathPattern="agent-orchestration"
git add lib/services/agent-orchestration.service.ts lib/services/spec-generation.service.ts lib/services/clarification.service.ts
git add -u
git commit -m "refactor: create agent service layer (orchestration, spec-generation, clarification) [LUM-0]"
```

---

## Phase 3: Notification Logic to Services

### Task 8: Move notification orchestration into service layer

**Files:**

- Modify: `lib/services/notification.service.ts` — add orchestration methods
- Keep: `lib/notifications/` files as-is during transition (services import from them)
- Test: existing notification tests

- [ ] **Step 1: Add notification orchestration exports to notification.service.ts**

Read `lib/services/notification.service.ts` fully. Add re-exports from the notification modules:

```typescript
// Add to the bottom of lib/services/notification.service.ts

// ── Re-exported notification orchestration (from lib/notifications/) ────
// These will be inlined in a future pass; for now they are re-exported
// so consumers can import from the service layer.

export {
  shouldNotify,
  shouldNotifyBatch,
} from '@/lib/notifications/preferenceGate'

export {
  buildTaskNotificationCtx,
  dispatchTaskUpdateNotifications,
  notifyActor,
  notifyChannel,
  notifyStatusChange,
  type TaskNotificationCtx,
} from '@/lib/notifications/notifyTaskChange'

export {
  notifyAgentClarify,
  notifyAgentVerify,
  notifyAgentFailed,
  notifyAgentDone,
} from '@/lib/notifications/notifyAgentActions'

export { notifyReviewerOrOwners } from '@/lib/notifications/notifyReviewerOrOwners'
export { notifyTaskInReview } from '@/lib/notifications/notifyTaskInReview'
```

- [ ] **Step 2: Update consumers to import from service**

`app/api/tasks/[id]/route.ts`:

```typescript
// OLD
import {
  buildTaskNotificationCtx,
  dispatchTaskUpdateNotifications,
} from '@/lib/notifications/notifyTaskChange'
// NEW
import {
  buildTaskNotificationCtx,
  dispatchTaskUpdateNotifications,
} from '@/lib/services/notification.service'
```

`app/api/tasks/[id]/comments/route.ts`:

```typescript
// OLD
import { shouldNotifyBatch } from '@/lib/notifications/preferenceGate'
// NEW
import { shouldNotifyBatch } from '@/lib/services/notification.service'
```

`app/api/webhooks/sandbox/route.ts`:

```typescript
// OLD
import { notifyAgentFailed } from '@/lib/notifications/notifyAgentActions'
// NEW
import { notifyAgentFailed } from '@/lib/services/notification.service'
```

Apply to all remaining consumers of `@/lib/notifications/`.

- [ ] **Step 3: Run tests, verify, commit**

```bash
npx tsc --noEmit
npm test
git add -u
git commit -m "refactor: re-export notification orchestration through service layer [LUM-0]"
```

---

## Phase 4: Add Interfaces to Existing Modules

### Task 9: Add types.ts + index.ts to services and repositories

**Files:**

- Create: `lib/services/types.ts`
- Create: `lib/repositories/types.ts`
- Modify: `lib/services/index.ts` — add type re-exports
- Modify: `lib/repositories/index.ts` — add type re-exports

- [ ] **Step 1: Create lib/services/types.ts**

Read `lib/services/task.service.ts`, `lib/services/comment.service.ts`, `lib/services/notification.service.ts` to understand existing param/return types. Create:

```typescript
// lib/services/types.ts

import type { TaskPriority, TaskStatus } from '@prisma/client'

// ── Task service types ──────────────────────────────────────────────────

export interface CreateTaskParams {
  projectId: string
  title: string
  assigneeId?: string | null
  reviewerId?: string | null
  description?: string
  priority?: TaskPriority
  parentTaskId?: string | null
  dueDate?: Date | null
}

export interface CreateTaskResult {
  task: Record<string, unknown>
  events: unknown[]
}

export interface UpdateTaskInput {
  title?: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  assigneeActorId?: string | null
  reviewerActorId?: string | null
  dueDate?: Date | null
  parentTaskId?: string | null
  repositoryId?: string | null
  tagIds?: string[]
}

export interface ActivityEventDiff {
  field: string
  oldValue: string | null
  newValue: string | null
}

// ── Description service types ───────────────────────────────────────────

export interface GenerateDescriptionParams {
  title: string
  workspaceUrl: string
  projectId?: string
}

export interface GenerateDescriptionResult {
  description: string
  suggestedProjectId?: string
  suggestedProjectReason?: string
}

// ── Notification response types ─────────────────────────────────────────

export type NotificationAction =
  | 'reply'
  | 'confirm'
  | 'send_back'
  | 'approve'
  | 'deny'
```

- [ ] **Step 2: Create lib/repositories/types.ts**

```typescript
// lib/repositories/types.ts

// Repository types define the shapes returned by repository queries.
// These are intentionally lightweight — Prisma generates the full types,
// and repositories use `select` to return subsets.

export interface TaskBasic {
  id: string
  title: string
  status: string
  priority: string
  identifier: string
}

export interface ProjectBasic {
  id: string
  name: string
  workspaceId: string
}
```

- [ ] **Step 3: Update index.ts files to re-export types**

Add to `lib/services/index.ts`:

```typescript
// Add at the top
export type * from './types'
```

Add to `lib/repositories/index.ts`:

```typescript
// Add at the top
export type * from './types'
```

- [ ] **Step 4: Run tests, commit**

```bash
npx tsc --noEmit
git add lib/services/types.ts lib/repositories/types.ts
git add -u
git commit -m "refactor: add types.ts interfaces to services and repositories [LUM-0]"
```

---

## Phase 5: Slim API Routes

### Task 10: Slim `app/api/tasks/generate-description/route.ts`

**Files:**

- Create: `lib/services/description.service.ts`
- Modify: `app/api/tasks/generate-description/route.ts`
- Test: `__tests__/lib/services/description.service.test.ts`

- [ ] **Step 1: Create description.service.ts**

Read `app/api/tasks/generate-description/route.ts` fully (264 lines). Extract the prompt builders, AI call, and sanitization:

```typescript
// lib/services/description.service.ts

import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import { z } from 'zod'
import { taskRepository, projectRepository } from '@/lib/repositories'
import { sanitizeHtml } from '@/lib/utils/sanitize'

// ── Zod schemas ─────────────────────────────────────────────────────────

const descriptionResponseSchema = z.object({
  description: z
    .string()
    .describe(
      'Generated HTML description using lightweight rich text tags: <p>, <strong>, <code>, <ul>/<li>, <input type="checkbox">'
    ),
})

const descriptionWithProjectSchema = z.object({
  description: z
    .string()
    .describe(
      'Generated HTML description using lightweight rich text tags: <p>, <strong>, <code>, <ul>/<li>, <input type="checkbox">'
    ),
  suggestedProjectId: z
    .string()
    .describe(
      'The ID of the most relevant project for this task, chosen from the provided project list'
    ),
  suggestedProjectReason: z
    .string()
    .describe('A brief reason why this project was suggested'),
})

// ── Prompt builders (extracted from route) ──────────────────────────────

// ... copy buildPrompt() and buildPromptWithoutProject() verbatim from the route

// ── Public API ──────────────────────────────────────────────────────────

export async function generateDescriptionWithProject(
  title: string,
  projectId: string,
  workspaceId: string
): Promise<{ description: string }> {
  // ... copy the "with project" branch from the route's POST handler
  // fetch recent tasks, build prompt, call generateObject, sanitize
}

export async function generateDescriptionWithoutProject(
  title: string,
  workspaceId: string
): Promise<{
  description: string
  suggestedProjectId?: string
  suggestedProjectReason?: string
}> {
  // ... copy the "without project" branch from the route's POST handler
  // fetch projects, build prompt, call generateObject, sanitize
}

export const descriptionService = {
  generateDescriptionWithProject,
  generateDescriptionWithoutProject,
}
```

Read the actual route file to copy the exact prompt templates and logic.

- [ ] **Step 2: Slim the route**

```typescript
// app/api/tasks/generate-description/route.ts — after refactor

import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { loadProjectAndMember, requireWorkspaceByUrl } from '@/lib/api/helpers'
import { generateDescriptionSchema } from '@/lib/validation/schemas'
import { descriptionService } from '@/lib/services/description.service'

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const parsed = generateDescriptionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.format() },
        { status: 400 }
      )
    }

    const { title, workspaceUrl, projectId } = parsed.data

    if (projectId) {
      const ctx = await loadProjectAndMember(projectId, userId)
      if (ctx instanceof NextResponse) return ctx

      const result = await descriptionService.generateDescriptionWithProject(
        title,
        projectId,
        ctx.project.workspaceId
      )
      return NextResponse.json(result)
    }

    const ws = await requireWorkspaceByUrl(workspaceUrl, userId)
    if (ws instanceof NextResponse) return ws

    const result = await descriptionService.generateDescriptionWithoutProject(
      title,
      ws.id
    )
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to generate description' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 3: Add to services/index.ts, test, commit**

```typescript
// Add to lib/services/index.ts
export { descriptionService } from './description.service'
```

```bash
npx tsc --noEmit
npm test
git add lib/services/description.service.ts
git add -u
git commit -m "refactor: extract description service, slim generate-description route [LUM-0]"
```

---

### Task 11: Slim `app/api/tasks/[id]/route.ts`

**Files:**

- Modify: `lib/services/task.service.ts` — add `buildActivityEvents`
- Modify: `app/api/tasks/[id]/route.ts`

- [ ] **Step 1: Add buildActivityEvents to task.service.ts**

Read `app/api/tasks/[id]/route.ts` lines 77-221 (the activity event builder). Extract into `task.service.ts`:

```typescript
// Add to lib/services/task.service.ts

import type { TaskActivityEvent } from '@/lib/events/types/task-activity'

function buildActivityEvents(
  taskId: string,
  actorId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  input: Record<string, unknown>
): TaskActivityEvent[] {
  // ... copy the entire if-else chain from the route verbatim
  // This is the 145-line block that checks each field change
}
```

Also add a `updateTaskWithSideEffects` method that wraps `updateTask` + event building + notification dispatch:

```typescript
async function updateTaskWithSideEffects(
  taskId: string,
  input: UpdateTaskInput,
  actorId: string,
  actorClerkId: string
): Promise<{ task: Record<string, unknown> }> {
  const before = await taskRepository.findById(taskId)
  const result = await updateTask(taskId, input)
  const events = buildActivityEvents(
    taskId,
    actorId,
    before,
    result.task,
    input
  )

  if (events.length > 0) {
    dispatchEvents(events)
  }

  // Push real-time updates
  pushTaskEvent(taskId, { type: 'task:updated', patch: result.task })
  pushProjectEvent(result.task.projectId, {
    type: 'task:updated',
    taskId,
    patch: result.task,
  })

  // Dispatch notifications
  const ctx = buildTaskNotificationCtx(
    before,
    result.task,
    actorId,
    actorClerkId
  )
  dispatchTaskUpdateNotifications({ ctx, taskId, ...input })

  return result
}
```

Read the route to get the exact logic — the above is the pattern; the actual field checks must match.

- [ ] **Step 2: Slim the PATCH handler**

```typescript
// app/api/tasks/[id]/route.ts PATCH handler — after refactor
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const task = await taskService.getTaskDetail(id)
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const body = await request.json()
    const parsed = updateTaskSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed.error)

    const actorId = await getHumanActorId(userId)
    const result = await taskService.updateTaskWithSideEffects(
      id,
      parsed.data,
      actorId,
      userId
    )

    return NextResponse.json({ task: result.task })
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 3: Run tests, commit**

```bash
npx tsc --noEmit
npm test
git add -u
git commit -m "refactor: extract activity event builder into task service, slim tasks/[id] route [LUM-0]"
```

---

### Task 12: Slim `app/api/projects/[id]/tasks/route.ts`

**Files:**

- Modify: `lib/services/task.service.ts` — add `createTask`
- Modify: `app/api/projects/[id]/tasks/route.ts`

- [ ] **Step 1: Add createTask to task.service.ts**

Read `app/api/projects/[id]/tasks/route.ts` POST handler (lines 119-268). Extract task creation logic:

```typescript
// Add to lib/services/task.service.ts

async function createTask(
  projectId: string,
  input: CreateTaskParams,
  actorId: string,
  actorClerkId: string
): Promise<{ task: Record<string, unknown> }> {
  // ... copy from route:
  // 1. Calculate order (find max, increment)
  // 2. Validate assignee, infer agent status
  // 3. Create task with sequence generation (taskRepository.createWithSequence)
  // 4. Dispatch task:created activity event
  // 5. Send Slack channel notification
  // 6. Create inbox notification for assignee
  // Return created task
}
```

Read the actual route to copy the implementation verbatim.

- [ ] **Step 2: Slim the POST handler**

```typescript
// app/api/projects/[id]/tasks/route.ts POST handler — after refactor
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id: projectId } = await params

    const project = await projectRepository.findById(projectId)
    if (!project)
      return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const memberResult = await requireWorkspaceMember(
      project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const body = await request.json()
    const parsed = createTaskSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed.error)

    const actorId = await getHumanActorId(userId)
    const result = await taskService.createTask(
      projectId,
      parsed.data,
      actorId,
      userId
    )

    return NextResponse.json({ task: result.task }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 3: Run tests, commit**

```bash
npx tsc --noEmit
npm test
git add -u
git commit -m "refactor: extract createTask into task service, slim projects/[id]/tasks route [LUM-0]"
```

---

### Task 13: Slim `app/api/notifications/[id]/respond/route.ts`

**Files:**

- Create: `lib/services/notification-response.service.ts`
- Modify: `app/api/notifications/[id]/respond/route.ts`

- [ ] **Step 1: Create notification-response.service.ts**

Read `app/api/notifications/[id]/respond/route.ts` lines 86-251. Extract the 3 handler branches:

```typescript
// lib/services/notification-response.service.ts

import { prisma } from '@/lib/db/prisma'
import { resumeAgent } from './clarification.service'
import {
  executeAgent,
  transitionAgentStatus,
  clearAgentStatus,
} from './agent-orchestration.service'
import { transitionTaskStatus } from '@/lib/task/state-machine'
import {
  isAgentServiceEnabled,
  proxyToAgentService,
} from '@/lib/integrations/sandbox'
import { notificationService } from './notification.service'
import { taskRepository } from '@/lib/repositories'

async function runAgent(opts: {
  taskId: string
  actorClerkId: string
  trigger: string
}): Promise<void> {
  if (isAgentServiceEnabled()) {
    await proxyToAgentService('/api/agent/execute', opts)
  } else {
    await executeAgent(opts)
  }
}

export async function handleClarifyResponse(params: {
  notificationId: string
  actorId: string
  actorClerkId: string
  reply: string
  notification: Awaited<ReturnType<typeof notificationService.loadForRespond>>
}): Promise<void> {
  // ... copy AGENT_CLARIFY branch (lines 86-147) from the route
}

export async function handleAuthorizeResponse(params: {
  notificationId: string
  actorId: string
  actorClerkId: string
  action: 'approve' | 'deny'
  notification: Awaited<ReturnType<typeof notificationService.loadForRespond>>
}): Promise<void> {
  // ... copy AGENT_AUTHORIZE branch (lines 149-205) from the route
}

export async function handleVerifyResponse(params: {
  notificationId: string
  actorId: string
  actorClerkId: string
  action: 'confirm' | 'send_back'
  notification: Awaited<ReturnType<typeof notificationService.loadForRespond>>
}): Promise<void> {
  // ... copy AGENT_VERIFY branch (lines 207-251) from the route
}

export const notificationResponseService = {
  handleClarifyResponse,
  handleAuthorizeResponse,
  handleVerifyResponse,
}
```

Read the actual route to copy each branch verbatim.

- [ ] **Step 2: Slim the route**

The route becomes ~60 lines: auth → validate → load notification → dispatch to the correct service handler based on notification type → return response.

- [ ] **Step 3: Add to services/index.ts, test, commit**

```bash
npx tsc --noEmit
npm test
git add lib/services/notification-response.service.ts
git add -u
git commit -m "refactor: extract notification response handlers, slim respond route [LUM-0]"
```

---

### Task 14: Slim `app/api/tasks/[id]/comments/route.ts`

**Files:**

- Modify: `lib/services/comment.service.ts` — add `notifyMentions`
- Modify: `app/api/tasks/[id]/comments/route.ts`

- [ ] **Step 1: Add notifyMentions to comment.service.ts**

Read `app/api/tasks/[id]/comments/route.ts` lines 129-215. Extract the @mention notification batch logic:

```typescript
// Add to lib/services/comment.service.ts

async function notifyMentions(params: {
  taskId: string
  commentId: string
  body: string
  authorActorId: string
  authorClerkId: string
  workspaceId: string
  taskUrl: string
}): Promise<void> {
  // ... copy the mention notification batch from the route:
  // 1. parseMentionedClerkIds
  // 2. Resolve clerk IDs to actor IDs
  // 3. shouldNotifyBatch for inApp and slack channels
  // 4. Create inbox notifications
  // 5. Send Slack DMs
  // 6. Push user events
}
```

Read the actual route to copy verbatim.

- [ ] **Step 2: Slim the POST handler**

The POST handler delegates to `commentService.createComment()` then `commentService.notifyMentions()`.

- [ ] **Step 3: Run tests, commit**

```bash
npx tsc --noEmit
npm test
git add -u
git commit -m "refactor: extract mention notifications into comment service, slim comments route [LUM-0]"
```

---

### Task 15: Slim remaining 7 oversized routes

**Files:**

- Modify: `app/api/notifications/route.ts`
- Modify: `app/api/tasks/quick-dispatch/execute/route.ts`
- Create: `lib/services/quick-dispatch.service.ts`
- Modify: `app/api/github/repos/route.ts`
- Modify: `lib/services/github.service.ts`
- Modify: `app/api/slack/create-channel/route.ts`
- Modify: `lib/services/slack.service.ts`
- Modify: `app/api/tasks/[id]/branch/route.ts`
- Create: `lib/services/preference.service.ts`
- Modify: `app/api/users/preferences/route.ts`
- Modify: `app/api/tasks/parse-quick-dispatch/route.ts`

- [ ] **Step 1: Slim notifications/route.ts — add enrichNotifications to notification.service.ts**

Read `app/api/notifications/route.ts` lines 95-140. Extract the enrichment mapping into `notificationService.enrichNotifications()`. Route becomes: auth → fetch notifications → enrich → return.

- [ ] **Step 2: Create quick-dispatch.service.ts — extract from 2 routes**

Read `app/api/tasks/quick-dispatch/execute/route.ts` and `app/api/tasks/parse-quick-dispatch/route.ts`. Create:

```typescript
// lib/services/quick-dispatch.service.ts

export async function executeActions(actions, workspaceId, actorId) {
  // ... extract batch action loop from execute route
}

export async function parseWithAI(text, workspaceId) {
  // ... extract AI context building from parse route
}

export const quickDispatchService = { executeActions, parseWithAI }
```

- [ ] **Step 3: Slim github/repos/route.ts — add updateAuthorizedRepos to github.service.ts**

Read `app/api/github/repos/route.ts` PATCH handler. Extract webhook create/delete loop into `githubService.updateAuthorizedRepos()`.

- [ ] **Step 4: Slim slack/create-channel/route.ts — add createChannelWithInvite to slack.service.ts**

Read `app/api/slack/create-channel/route.ts`. Extract channel creation + invitation into `slackService.createChannelWithInvite()`.

- [ ] **Step 5: Slim tasks/[id]/branch/route.ts — add createBranchForTask to github.service.ts**

Read `app/api/tasks/[id]/branch/route.ts`. Extract GitHub API branch creation into `githubService.createBranchForTask()`.

- [ ] **Step 6: Create preference.service.ts — extract from users/preferences/route.ts**

Read `app/api/users/preferences/route.ts`. Extract field validation into `preferenceService.updatePreferences()`.

- [ ] **Step 7: Update services/index.ts with all new exports**

```typescript
export { quickDispatchService } from './quick-dispatch.service'
export { preferenceService } from './preference.service'
```

- [ ] **Step 8: Run tests, verify all routes are under 100 lines, commit**

```bash
npx tsc --noEmit
npm test
# Verify line counts
wc -l app/api/tasks/[id]/route.ts app/api/projects/[id]/tasks/route.ts app/api/notifications/[id]/respond/route.ts app/api/tasks/generate-description/route.ts app/api/tasks/[id]/comments/route.ts app/api/notifications/route.ts app/api/tasks/quick-dispatch/execute/route.ts app/api/github/repos/route.ts app/api/slack/create-channel/route.ts app/api/tasks/[id]/branch/route.ts app/api/users/preferences/route.ts app/api/tasks/parse-quick-dispatch/route.ts
git add lib/services/quick-dispatch.service.ts lib/services/preference.service.ts
git add -u
git commit -m "refactor: slim remaining 7 oversized API routes into service layer [LUM-0]"
```

---

## Phase 6: Fix Frontend Layer

### Task 16: Fix components and hooks that bypass API client

**Files:**

- Modify: `lib/api-client/tasks.ts` — add agent methods
- Modify: `lib/api-client/index.ts` — add agent client export
- Modify: `components/LogoUploader.tsx`
- Modify: `components/task/AgentPanel.tsx`
- Modify: `components/task/agent/AgentClarifyPanel.tsx`

- [ ] **Step 1: Add agent API client methods**

Read `lib/api-client/tasks.ts` to understand the pattern. Add:

```typescript
// Add to lib/api-client/tasks.ts or create lib/api-client/agent.ts

export const agentClient = {
  async execute(taskId: string): Promise<void> {
    await apiFetchQuiet('/api/agent/execute', {
      method: 'POST',
      body: JSON.stringify({ taskId }),
    })
  },

  async cancel(taskId: string): Promise<void> {
    await apiFetchQuiet('/api/agent/cancel', {
      method: 'POST',
      body: JSON.stringify({ taskId }),
    })
  },

  async confirmSpec(taskId: string, spec: string): Promise<void> {
    await apiFetchQuiet('/api/agent/confirm-spec', {
      method: 'POST',
      body: JSON.stringify({ taskId, spec }),
    })
  },

  async resume(
    taskId: string,
    workspaceId: string,
    reply: string
  ): Promise<void> {
    await apiFetchQuiet('/api/agent/resume', {
      method: 'POST',
      body: JSON.stringify({ taskId, workspaceId, reply }),
    })
  },
}
```

- [ ] **Step 2: Fix LogoUploader.tsx**

Read `components/LogoUploader.tsx` to find the fetch call. The `workspacesClient.uploadLogo(formData)` already exists in `lib/api-client/workspaces.ts`. Replace:

```typescript
// OLD (line ~133)
const res = await fetch(uploadUrl, { method: 'POST', body: formData })
// NEW
const res = await workspacesClient.uploadLogo(formData)
```

Read the actual code to confirm the exact replacement.

- [ ] **Step 3: Fix AgentPanel.tsx**

Read `components/task/AgentPanel.tsx` lines 281, 310, 323. Replace:

```typescript
// OLD
const res = await fetch('/api/agent/execute', { method: 'POST', ... })
// NEW
await agentClient.execute(task.id)

// OLD
await fetch('/api/agent/cancel', { method: 'POST', ... })
// NEW
await agentClient.cancel(task.id)

// OLD
const res = await fetch('/api/agent/confirm-spec', { method: 'POST', ... })
// NEW
await agentClient.confirmSpec(task.id, task.spec ?? '')
```

- [ ] **Step 4: Fix AgentClarifyPanel.tsx**

Read `components/task/agent/AgentClarifyPanel.tsx` line 41. Replace:

```typescript
// OLD
await fetch('/api/agent/resume', { method: 'POST', ... })
// NEW
await agentClient.resume(taskId, workspaceId, reply.trim())
```

- [ ] **Step 5: Add agent client to api-client/index.ts**

```typescript
export { agentClient } from './agent'
```

- [ ] **Step 6: Verify no remaining direct fetch() in components**

```bash
grep -rn "fetch(" components/ --include="*.tsx" --include="*.ts" | grep -v node_modules | grep -v "apiFetch"
```

Should return zero results (or only legitimate uses in api-client wrapper).

- [ ] **Step 7: Run tests, commit**

```bash
npx tsc --noEmit
npm test
git add lib/api-client/agent.ts
git add -u
git commit -m "refactor: fix components to use api-client, add agent API client [LUM-0]"
```

---

## Phase 7: Cleanup

### Task 17: Delete old module directories and verify

**Files:**

- Delete: `lib/agent/` (all files now in services/ or integrations/)
- Delete: `lib/notifications/` (all exports now in notification.service.ts)
- Verify: no broken imports remain

- [ ] **Step 1: Verify all lib/agent/ exports are available through new paths**

```bash
grep -r "from '@/lib/agent/" --include="*.ts" --include="*.tsx" -l
```

If any remain, update them to import from `@/lib/services/` or `@/lib/integrations/sandbox/`.

- [ ] **Step 2: Verify all lib/notifications/ exports are available through services**

```bash
grep -r "from '@/lib/notifications/" --include="*.ts" --include="*.tsx" -l
```

If any remain, update to import from `@/lib/services/notification.service`.

- [ ] **Step 3: Delete old directories**

```bash
rm -rf lib/agent/
rm -rf lib/notifications/
```

- [ ] **Step 4: Full verification**

```bash
npx tsc --noEmit
npm test
```

- [ ] **Step 5: Verify success criteria**

```bash
# No route over 100 lines
find app/api -name "route.ts" -exec wc -l {} + | sort -rn | head -15

# No direct fetch in components (except api-client)
grep -rn "fetch(" components/ --include="*.tsx" | grep -v apiFetch

# No imports from deleted directories
grep -r "from '@/lib/agent/" --include="*.ts" --include="*.tsx"
grep -r "from '@/lib/notifications/" --include="*.ts" --include="*.tsx"
grep -r "from '@/lib/github/" --include="*.ts" --include="*.tsx"
grep -r "from '@/lib/slack/" --include="*.ts" --include="*.tsx"
grep -r "from '@/lib/email/" --include="*.ts" --include="*.tsx"
grep -r "from '@/lib/pusher/" --include="*.ts" --include="*.tsx"
```

All should return zero results.

- [ ] **Step 6: Commit**

```bash
git add -u
git commit -m "refactor: delete old module directories after migration complete [LUM-0]"
```

---

## Summary

| Phase | Tasks | Description                                                                            |
| ----- | ----- | -------------------------------------------------------------------------------------- |
| 1     | 1-4   | Create integrations layer (github, slack, email, pusher)                               |
| 2     | 5-7   | Split agent module (utils → lib/utils, infra → integrations/sandbox, logic → services) |
| 3     | 8     | Move notification orchestration to service layer                                       |
| 4     | 9     | Add types.ts + index.ts to services/repositories                                       |
| 5     | 10-15 | Slim 12 oversized API routes                                                           |
| 6     | 16    | Fix frontend components to use api-client                                              |
| 7     | 17    | Delete old directories, verify success criteria                                        |

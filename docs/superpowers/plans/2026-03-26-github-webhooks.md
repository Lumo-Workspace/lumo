# GitHub Webhook Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a developer opens/merges/closes a PR whose branch name contains a Lumo task identifier (e.g. `lumo/ENG-123-fix-bug`), automatically update the task status and display the linked PR on the task detail page.

**Architecture:** The GitHub OAuth flow (already complete) gains a second responsibility: after the user selects repos, Lumo auto-creates a per-repo webhook via the GitHub API and stores the webhook ID + a per-integration HMAC secret. `POST /api/webhooks/github` receives events, verifies signatures, looks up the workspace, parses the branch identifier, and mutates `Task` status + upserts a `PullRequest` record. TaskDetailPage fetches and renders linked PRs from the existing `/api/tasks/:id` endpoint.

**Tech Stack:** Next.js 14 App Router, Prisma + Neon Postgres, `node:crypto` (HMAC-SHA256, no extra packages), existing `lib/crypto.ts` for token decryption, `sonner` for toasts (already installed).

---

## File Map

**New files:**

- `lib/github/branch.ts` — pure helpers: `parseBranchIdentifier`, `splitIdentifier`
- `lib/github/verify.ts` — pure helper: `verifyGitHubSignature`
- `lib/github/webhooks.ts` — GitHub API calls: `createRepoWebhook`, `deleteRepoWebhook`
- `lib/notifications/notifyTaskInReview.ts` — extracted from route, shared helper
- `app/api/webhooks/github/route.ts` — POST receiver: verify → dispatch
- `app/api/webhooks/github/handlers.ts` — event handlers: `handlePullRequest`, `handleCheckSuite`
- `tests/lib/github/branch.test.ts`
- `tests/lib/github/verify.test.ts`

**Modified files:**

- `prisma/schema.prisma` — add `webhookSecret` to `GitHubIntegration`, add `GitHubWebhook` + `PullRequest` models
- `app/api/github/repos/route.ts` — PATCH: diff repos → create/delete webhooks
- `app/api/github/integration/route.ts` — DELETE: clean up webhooks before deletion
- `app/api/tasks/[id]/route.ts` — GET: include `pullRequests`; PATCH: use shared `notifyTaskInReview`
- `app/workspace/[workspaceUrl]/types.ts` — add `ApiPullRequest`, extend `TaskDetail`
- `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx` — add Linked PRs section
- `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx` — add Linked PRs section

---

## Task 1: Schema Migration

**Files:**

- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `webhookSecret` field + relations to `GitHubIntegration`**

In `prisma/schema.prisma`, find the `GitHubIntegration` model and add:

```diff
  repositories String[]
+ webhookSecret String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  workspace Workspace       @relation(...)
  member    WorkspaceMember @relation(...)
+ webhooks  GitHubWebhook[]
+ pullRequests PullRequest[]
```

- [ ] **Step 2: Add `GitHubWebhook` model** (after `GitHubIntegration`)

```prisma
model GitHubWebhook {
  id            String   @id @default(cuid())
  integrationId String
  repo          String   // "owner/repo"
  githubHookId  Int      // GitHub's webhook ID, needed for deletion

  createdAt DateTime @default(now())

  integration GitHubIntegration @relation(fields: [integrationId], references: [id], onDelete: Cascade)

  @@unique([integrationId, repo])
  @@index([repo])
  @@map("github_webhooks")
}
```

- [ ] **Step 3: Add `PullRequest` model** (after `GitHubWebhook`)

```prisma
model PullRequest {
  id            String    @id @default(cuid())
  workspaceId   String
  taskId        String?
  integrationId String
  repo          String    // "owner/repo"
  number        Int
  title         String
  url           String
  state         String    // "open" | "closed" | "merged"
  authorLogin   String
  headBranch    String
  baseBranch    String
  isDraft       Boolean   @default(false)
  ciStatus      String?   // null | "pending" | "success" | "failure"
  mergedAt      DateTime?
  closedAt      DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  workspace   Workspace         @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  task        Task?             @relation(fields: [taskId], references: [id], onDelete: SetNull)
  integration GitHubIntegration @relation(fields: [integrationId], references: [id], onDelete: Cascade)

  @@unique([repo, number])
  @@index([workspaceId])
  @@index([taskId])
  @@map("pull_requests")
}
```

- [ ] **Step 4: Add `pullRequests` relation to `Task` model**

```diff
  viewTaskOrders ViewTaskOrder[]
  comments       Comment[]
+ pullRequests   PullRequest[]
```

- [ ] **Step 5: Add `pullRequests` relation to `Workspace` model**

```diff
  githubIntegrations GitHubIntegration[]
+ pullRequests        PullRequest[]
```

- [ ] **Step 6: Run migration**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
npx prisma migrate dev --name github_webhooks
```

Expected: migration created and applied, `prisma generate` runs automatically.

- [ ] **Step 7: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -v node_modules
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add prisma/
git commit -m "feat: add GitHubWebhook and PullRequest schema models"
```

---

## Task 2: Branch Parser Utility + Tests

**Files:**

- Create: `lib/github/branch.ts`
- Create: `tests/lib/github/branch.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/github/branch.test.ts
import { parseBranchIdentifier, splitIdentifier } from '@/lib/github/branch'

describe('parseBranchIdentifier', () => {
  it('parses lumo/ prefix', () => {
    expect(parseBranchIdentifier('lumo/ENG-123-fix-bug')).toBe('ENG-123')
  })
  it('parses feature/ prefix', () => {
    expect(parseBranchIdentifier('feature/ENG-123-fix-bug')).toBe('ENG-123')
  })
  it('parses bare branch', () => {
    expect(parseBranchIdentifier('ENG-123-fix-bug')).toBe('ENG-123')
  })
  it('normalizes to uppercase', () => {
    expect(parseBranchIdentifier('lumo/eng-123-fix')).toBe('ENG-123')
  })
  it('returns null for no identifier', () => {
    expect(parseBranchIdentifier('main')).toBeNull()
    expect(parseBranchIdentifier('fix-bug')).toBeNull()
  })
  it('parses when no suffix after identifier', () => {
    expect(parseBranchIdentifier('feature/ENG-123')).toBe('ENG-123')
  })
})

describe('splitIdentifier', () => {
  it('splits ENG-123', () => {
    expect(splitIdentifier('ENG-123')).toEqual({
      teamIdentifier: 'ENG',
      number: 123,
    })
  })
  it('splits FRONTEND-456', () => {
    expect(splitIdentifier('FRONTEND-456')).toEqual({
      teamIdentifier: 'FRONTEND',
      number: 456,
    })
  })
  it('returns null for no dash', () => {
    expect(splitIdentifier('invalid')).toBeNull()
  })
  it('returns null for empty string', () => {
    expect(splitIdentifier('')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npx jest tests/lib/github/branch.test.ts --no-coverage
```

Expected: FAIL — "Cannot find module '@/lib/github/branch'"

- [ ] **Step 3: Create the implementation**

```typescript
// lib/github/branch.ts
/**
 * Extracts a Lumo task identifier from a Git branch name.
 *
 * Supported patterns (case-insensitive):
 *   lumo/ENG-123-fix-bug   → "ENG-123"
 *   feature/ENG-123-fix    → "ENG-123"
 *   eng-123-fix-bug        → "ENG-123"
 *   ENG-123                → "ENG-123"
 *
 * Returns null if no identifier is found.
 */
const IDENTIFIER_RE = /\b([A-Za-z]{1,10}-\d+)\b/

export function parseBranchIdentifier(branch: string): string | null {
  const m = IDENTIFIER_RE.exec(branch)
  return m ? m[1]!.toUpperCase() : null
}

/**
 * Splits "ENG-123" into { teamIdentifier: "ENG", number: 123 }.
 * Returns null if the format is invalid.
 */
export function splitIdentifier(
  identifier: string
): { teamIdentifier: string; number: number } | null {
  const idx = identifier.lastIndexOf('-')
  if (idx === -1) return null
  const teamIdentifier = identifier.slice(0, idx).toUpperCase()
  const number = parseInt(identifier.slice(idx + 1), 10)
  if (!teamIdentifier || isNaN(number)) return null
  return { teamIdentifier, number }
}
```

- [ ] **Step 4: Run to confirm it passes**

```bash
npx jest tests/lib/github/branch.test.ts --no-coverage
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/github/branch.ts tests/lib/github/branch.test.ts
git commit -m "feat: add branch identifier parser with unit tests"
```

---

## Task 3: HMAC Signature Verifier + Tests

**Files:**

- Create: `lib/github/verify.ts`
- Create: `tests/lib/github/verify.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/github/verify.test.ts
import { createHmac } from 'crypto'
import { verifyGitHubSignature } from '@/lib/github/verify'

function sign(body: string, secret: string): string {
  return (
    'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  )
}

describe('verifyGitHubSignature', () => {
  const body = JSON.stringify({ action: 'opened' })
  const secret = 'my-super-secret'

  it('returns true for a valid signature', () => {
    expect(verifyGitHubSignature(body, sign(body, secret), secret)).toBe(true)
  })
  it('returns false when signed with wrong secret', () => {
    expect(
      verifyGitHubSignature(body, sign(body, 'wrong-secret'), secret)
    ).toBe(false)
  })
  it('returns false for null header', () => {
    expect(verifyGitHubSignature(body, null, secret)).toBe(false)
  })
  it('returns false for header without sha256= prefix', () => {
    expect(verifyGitHubSignature(body, 'notasig', secret)).toBe(false)
  })
  it('returns false for different body', () => {
    const sig = sign('other body', secret)
    expect(verifyGitHubSignature(body, sig, secret)).toBe(false)
  })
  it('handles length mismatch without throwing', () => {
    expect(verifyGitHubSignature(body, 'sha256=short', secret)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npx jest tests/lib/github/verify.test.ts --no-coverage
```

Expected: FAIL — "Cannot find module '@/lib/github/verify'"

- [ ] **Step 3: Create the implementation**

```typescript
// lib/github/verify.ts
import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Verifies a GitHub webhook HMAC-SHA256 signature.
 *
 * @param body            - Raw request body as a string
 * @param signatureHeader - Value of the x-hub-signature-256 header
 * @param secret          - The webhook secret registered with GitHub
 */
export function verifyGitHubSignature(
  body: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false
  const expected =
    'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  try {
    // timingSafeEqual requires same-length buffers
    const a = Buffer.from(signatureHeader)
    const b = Buffer.from(expected)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run to confirm it passes**

```bash
npx jest tests/lib/github/verify.test.ts --no-coverage
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/github/verify.ts tests/lib/github/verify.test.ts
git commit -m "feat: add GitHub HMAC signature verifier with unit tests"
```

---

## Task 4: GitHub Webhook CRUD Helpers

**Files:**

- Create: `lib/github/webhooks.ts`

No unit tests — these are thin wrappers around the GitHub REST API (tested via integration).

- [ ] **Step 1: Create the helpers**

```typescript
// lib/github/webhooks.ts
const GH_API = 'https://api.github.com'
const GH_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
}

/**
 * Creates a webhook on a GitHub repo listening for pull_request,
 * pull_request_review, and check_suite events.
 *
 * @returns The GitHub webhook ID (needed to delete later).
 * @throws  If the API call fails (non-404 errors).
 */
export async function createRepoWebhook(
  token: string,
  owner: string,
  repo: string,
  webhookUrl: string,
  secret: string
): Promise<number> {
  const res = await fetch(`${GH_API}/repos/${owner}/${repo}/hooks`, {
    method: 'POST',
    headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'web',
      active: true,
      events: ['pull_request', 'pull_request_review', 'check_suite'],
      config: {
        url: webhookUrl,
        content_type: 'json',
        secret,
        insecure_ssl: '0',
      },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GitHub createRepoWebhook failed ${res.status}: ${body}`)
  }
  const data = await res.json()
  return data.id as number
}

/**
 * Deletes a webhook from a GitHub repo.
 * Silently succeeds if the webhook is already gone (404).
 */
export async function deleteRepoWebhook(
  token: string,
  owner: string,
  repo: string,
  hookId: number
): Promise<void> {
  const res = await fetch(`${GH_API}/repos/${owner}/${repo}/hooks/${hookId}`, {
    method: 'DELETE',
    headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
  })
  if (!res.ok && res.status !== 404) {
    const body = await res.text()
    console.error(
      `[github] deleteRepoWebhook ${owner}/${repo}#${hookId} failed ${res.status}: ${body}`
    )
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v node_modules
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/github/webhooks.ts
git commit -m "feat: add GitHub webhook CRUD helpers"
```

---

## Task 5: Auto-Manage Webhooks on Repo Add/Remove + Disconnect

**Files:**

- Modify: `app/api/github/repos/route.ts`
- Modify: `app/api/github/integration/route.ts`

- [ ] **Step 1: Update PATCH /api/github/repos**

Replace the entire PATCH handler in `app/api/github/repos/route.ts` with:

```typescript
import { randomBytes } from 'crypto'
import { createRepoWebhook, deleteRepoWebhook } from '@/lib/github/webhooks'

export async function PATCH(request: NextRequest) {
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

    const body = await request.json()
    const repositories: string[] = Array.isArray(body.repositories)
      ? body.repositories
      : []

    const integration = await prisma.gitHubIntegration.findUnique({
      where: {
        workspaceId_memberId: {
          workspaceId: ws.workspaceId,
          memberId: ws.member.id,
        },
      },
      include: { webhooks: true },
    })
    if (!integration) {
      return NextResponse.json(
        { error: 'GitHub not connected' },
        { status: 404 }
      )
    }

    const token = decrypt(integration.accessToken)

    // Generate + persist webhook secret if not yet set
    let { webhookSecret } = integration
    if (!webhookSecret) {
      webhookSecret = randomBytes(32).toString('hex')
      await prisma.gitHubIntegration.update({
        where: { id: integration.id },
        data: { webhookSecret },
      })
    }

    const oldRepos = integration.repositories
    const addedRepos = repositories.filter(r => !oldRepos.includes(r))
    const removedRepos = oldRepos.filter(r => !repositories.includes(r))
    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/github`

    // Create webhooks for newly added repos
    for (const fullName of addedRepos) {
      const slash = fullName.indexOf('/')
      const owner = fullName.slice(0, slash)
      const repo = fullName.slice(slash + 1)
      try {
        const hookId = await createRepoWebhook(
          token,
          owner,
          repo,
          webhookUrl,
          webhookSecret
        )
        await prisma.gitHubWebhook.upsert({
          where: {
            integrationId_repo: {
              integrationId: integration.id,
              repo: fullName,
            },
          },
          create: {
            integrationId: integration.id,
            repo: fullName,
            githubHookId: hookId,
          },
          update: { githubHookId: hookId },
        })
      } catch (err) {
        // Log but don't fail: repo is saved even if webhook creation fails
        console.error(`[github] createRepoWebhook failed for ${fullName}:`, err)
      }
    }

    // Delete webhooks for removed repos
    for (const fullName of removedRepos) {
      const slash = fullName.indexOf('/')
      const owner = fullName.slice(0, slash)
      const repo = fullName.slice(slash + 1)
      const hook = integration.webhooks.find(h => h.repo === fullName)
      if (hook) {
        await deleteRepoWebhook(token, owner, repo, hook.githubHookId)
        await prisma.gitHubWebhook.delete({
          where: {
            integrationId_repo: {
              integrationId: integration.id,
              repo: fullName,
            },
          },
        })
      }
    }

    const updated = await prisma.gitHubIntegration.update({
      where: { id: integration.id },
      data: { repositories },
      select: { repositories: true },
    })

    return NextResponse.json({ repositories: updated.repositories })
  } catch (error) {
    console.error('PATCH /api/github/repos error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

Make sure the top of the file imports `decrypt` from `@/lib/crypto`, `randomBytes` from `crypto`, and the new webhook helpers.

- [ ] **Step 2: Update DELETE /api/github/integration**

Replace the DELETE handler body to clean up webhooks first:

```typescript
export async function DELETE(request: NextRequest) {
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

    const integration = await prisma.gitHubIntegration.findUnique({
      where: {
        workspaceId_memberId: {
          workspaceId: ws.workspaceId,
          memberId: ws.member.id,
        },
      },
      include: { webhooks: true },
    })

    if (integration) {
      const token = decrypt(integration.accessToken)
      for (const hook of integration.webhooks) {
        const slash = hook.repo.indexOf('/')
        const owner = hook.repo.slice(0, slash)
        const repo = hook.repo.slice(slash + 1)
        await deleteRepoWebhook(token, owner, repo, hook.githubHookId)
      }
      // Cascade delete handles GitHubWebhook records
      await prisma.gitHubIntegration.delete({
        where: { id: integration.id },
      })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE /api/github/integration error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

Add `import { decrypt } from '@/lib/crypto'` and `import { deleteRepoWebhook } from '@/lib/github/webhooks'` at the top.

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v node_modules
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/github/repos/route.ts app/api/github/integration/route.ts
git commit -m "feat: auto-create and delete GitHub webhooks on repo add/remove"
```

---

## Task 6: Shared Notification Helper + Refactor

**Files:**

- Create: `lib/notifications/notifyTaskInReview.ts`
- Modify: `app/api/tasks/[id]/route.ts`

- [ ] **Step 1: Create the shared helper**

```typescript
// lib/notifications/notifyTaskInReview.ts
import { prisma } from '@/lib/db/prisma'

/**
 * Fires a TASK_IN_REVIEW notification to the effective reviewer.
 *
 * actorId is a Clerk userId (string) when triggered by a user action,
 * or null when triggered by GitHub webhook (no Clerk actor).
 */
export async function notifyTaskInReview(params: {
  workspaceId: string
  taskId: string
  reviewerId: string | null
  defaultReviewerId: string | null
  actorId: string | null
}): Promise<void> {
  const { workspaceId, taskId, reviewerId, defaultReviewerId, actorId } = params
  const effectiveReviewerId = reviewerId ?? defaultReviewerId ?? null

  if (effectiveReviewerId) {
    const reviewer = await prisma.workspaceMember.findUnique({
      where: { id: effectiveReviewerId },
      select: { clerkId: true },
    })
    if (!reviewer || reviewer.clerkId === actorId) return
    await prisma.notification.create({
      data: {
        workspaceId,
        recipientId: reviewer.clerkId,
        type: 'TASK_IN_REVIEW',
        taskId,
        actorId,
      },
    })
  } else {
    const owners = await prisma.workspaceMember.findMany({
      where: { workspaceId, role: 'OWNER' },
      select: { clerkId: true },
    })
    const recipients = owners.map(o => o.clerkId).filter(c => c !== actorId)
    if (recipients.length === 0) return
    await prisma.notification.createMany({
      data: recipients.map(recipientId => ({
        workspaceId,
        recipientId,
        type: 'TASK_IN_REVIEW' as const,
        taskId,
        actorId,
      })),
    })
  }
}
```

- [ ] **Step 2: Refactor app/api/tasks/[id]/route.ts to use it**

In the PATCH handler, find the TASK_IN_REVIEW notification block (around line 211) and replace it:

```typescript
// Before (remove this entire block):
if (parsed.data.status === 'IN_REVIEW' && task.status !== 'IN_REVIEW') {
  const effectiveReviewerId = ...
  if (effectiveReviewerId) { ... } else { ... }
}

// After:
if (parsed.data.status === 'IN_REVIEW' && task.status !== 'IN_REVIEW') {
  notifyTaskInReview({
    workspaceId,
    taskId: id,
    reviewerId: updated.reviewerId,
    defaultReviewerId: task.project.defaultReviewerId,
    actorId: userId,
  }).catch(err => console.error('[notify] TASK_IN_REVIEW failed:', err))
}
```

Add `import { notifyTaskInReview } from '@/lib/notifications/notifyTaskInReview'` at the top.

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v node_modules
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/notifications/notifyTaskInReview.ts app/api/tasks/[id]/route.ts
git commit -m "refactor: extract notifyTaskInReview into shared helper"
```

---

## Task 7: Webhook Receiver + Event Handlers

**Files:**

- Create: `app/api/webhooks/github/route.ts`
- Create: `app/api/webhooks/github/handlers.ts`

- [ ] **Step 1: Create event handlers**

```typescript
// app/api/webhooks/github/handlers.ts
import { prisma } from '@/lib/db/prisma'
import { parseBranchIdentifier, splitIdentifier } from '@/lib/github/branch'
import { notifyTaskInReview } from '@/lib/notifications/notifyTaskInReview'
import type { Task, Project } from '@prisma/client'

// ── Types ────────────────────────────────────────────────────────────────────

type GitHubPR = {
  number: number
  title: string
  html_url: string
  state: string
  merged: boolean
  draft: boolean
  user: { login: string }
  head: { ref: string }
  base: { ref: string }
  merged_at: string | null
  closed_at: string | null
}

type PullRequestPayload = {
  action: string
  pull_request: GitHubPR
  repository: { full_name: string }
}

type CheckSuitePayload = {
  action: string
  check_suite: {
    head_branch: string
    conclusion: string | null
    pull_requests: Array<{ number: number }>
  }
  repository: { full_name: string }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function findTaskForBranch(
  headBranch: string,
  workspaceId: string
): Promise<
  | (Task & { project: Pick<Project, 'defaultReviewerId' | 'workspaceId'> })
  | null
> {
  const identifier = parseBranchIdentifier(headBranch)
  if (!identifier) return null
  const parts = splitIdentifier(identifier)
  if (!parts) return null

  return prisma.task.findFirst({
    where: {
      number: parts.number,
      team: { identifier: parts.teamIdentifier, workspaceId },
    },
    include: {
      project: { select: { defaultReviewerId: true, workspaceId: true } },
    },
  })
}

// ── Handlers ─────────────────────────────────────────────────────────────────

export async function handlePullRequest(
  payload: Record<string, unknown>,
  workspaceId: string,
  integrationId: string
): Promise<void> {
  const {
    action,
    pull_request: pr,
    repository,
  } = payload as unknown as PullRequestPayload

  const relevantActions = [
    'opened',
    'reopened',
    'closed',
    'synchronize',
    'edited',
  ]
  if (!relevantActions.includes(action)) return

  const state =
    action === 'closed' && pr.merged
      ? 'merged'
      : action === 'closed'
        ? 'closed'
        : 'open'

  const task = await findTaskForBranch(pr.head.ref, workspaceId)

  await prisma.pullRequest.upsert({
    where: { repo_number: { repo: repository.full_name, number: pr.number } },
    create: {
      workspaceId,
      taskId: task?.id ?? null,
      integrationId,
      repo: repository.full_name,
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      state,
      authorLogin: pr.user.login,
      headBranch: pr.head.ref,
      baseBranch: pr.base.ref,
      isDraft: pr.draft,
      mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
      closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
    },
    update: {
      title: pr.title,
      state,
      isDraft: pr.draft,
      mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
      closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
      // Update taskId if we now have a match (branch could appear after PR opens)
      ...(task ? { taskId: task.id } : {}),
    },
  })

  if (!task) return

  if (action === 'opened' || action === 'reopened') {
    if (task.status === 'TODO' || task.status === 'IN_PROGRESS') {
      await prisma.task.update({
        where: { id: task.id },
        data: { status: 'IN_REVIEW' },
      })
      notifyTaskInReview({
        workspaceId,
        taskId: task.id,
        reviewerId: task.reviewerId,
        defaultReviewerId: task.project.defaultReviewerId,
        actorId: null, // GitHub-triggered — no Clerk actor
      }).catch(err => console.error('[webhook] notifyTaskInReview error:', err))
    }
  } else if (action === 'closed' && pr.merged) {
    await prisma.task.update({
      where: { id: task.id },
      data: { status: 'DONE' },
    })
  } else if (action === 'closed' && !pr.merged) {
    if (task.status === 'IN_REVIEW') {
      await prisma.task.update({
        where: { id: task.id },
        data: { status: 'IN_PROGRESS' },
      })
    }
  }
}

export async function handleCheckSuite(
  payload: Record<string, unknown>,
  _workspaceId: string
): Promise<void> {
  const {
    action,
    check_suite: suite,
    repository,
  } = payload as unknown as CheckSuitePayload

  if (action !== 'completed') return

  const ciStatus =
    suite.conclusion === 'success'
      ? 'success'
      : suite.conclusion === null
        ? 'pending'
        : 'failure'

  const prNumbers = suite.pull_requests.map(pr => pr.number)
  if (prNumbers.length === 0) return

  await prisma.pullRequest.updateMany({
    where: { repo: repository.full_name, number: { in: prNumbers } },
    data: { ciStatus },
  })
}
```

- [ ] **Step 2: Create the route**

```typescript
// app/api/webhooks/github/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { verifyGitHubSignature } from '@/lib/github/verify'
import { handlePullRequest, handleCheckSuite } from './handlers'

/**
 * POST /api/webhooks/github
 *
 * Receives GitHub webhook events. Identifies the workspace by matching
 * the repo full_name to a GitHubWebhook record, then verifies the HMAC
 * signature against the integration's webhookSecret.
 */
export async function POST(request: NextRequest) {
  const body = await request.text()
  const event = request.headers.get('x-github-event')
  const signature = request.headers.get('x-hub-signature-256')

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(body) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const repoFullName = (
    payload.repository as { full_name?: string } | undefined
  )?.full_name
  if (!repoFullName) return NextResponse.json({ ok: true })

  // Find all integrations that registered a webhook for this repo
  const webhooks = await prisma.gitHubWebhook.findMany({
    where: { repo: repoFullName },
    include: {
      integration: {
        select: { id: true, workspaceId: true, webhookSecret: true },
      },
    },
  })

  // Find the one whose secret validates this signature
  const matched = webhooks.find(
    w =>
      w.integration.webhookSecret &&
      verifyGitHubSignature(body, signature, w.integration.webhookSecret)
  )

  if (!matched) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { workspaceId, id: integrationId } = matched.integration

  try {
    switch (event) {
      case 'pull_request':
        await handlePullRequest(payload, workspaceId, integrationId)
        break
      case 'check_suite':
        await handleCheckSuite(payload, workspaceId)
        break
      // pull_request_review — future
    }
  } catch (err) {
    console.error(`[webhook/github] error handling ${event}:`, err)
    // Return 200 to prevent GitHub retrying indefinitely
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v node_modules
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/webhooks/github/
git commit -m "feat: add GitHub webhook receiver with pull_request and check_suite handlers"
```

---

## Task 8: Add pullRequests to GET /api/tasks/:id + ApiPullRequest Type

**Files:**

- Modify: `app/api/tasks/[id]/route.ts`
- Modify: `app/workspace/[workspaceUrl]/types.ts`

- [ ] **Step 1: Add ApiPullRequest to types.ts**

Open `app/workspace/[workspaceUrl]/types.ts`. After the `ApiTask` interface add:

```typescript
export interface ApiPullRequest {
  id: string
  number: number
  title: string
  url: string
  state: string // "open" | "closed" | "merged"
  authorLogin: string
  headBranch: string
  ciStatus: string | null // "pending" | "success" | "failure" | null
  mergedAt: string | null
  createdAt: string
}
```

Then extend `TaskDetail` by adding an optional field:

```typescript
export interface TaskDetail {
  // ...existing fields...
  pullRequests?: ApiPullRequest[]
}
```

- [ ] **Step 2: Include pullRequests in GET /api/tasks/:id**

In `app/api/tasks/[id]/route.ts`, update the `prisma.task.findUnique` call in the GET handler to include:

```typescript
const task = await prisma.task.findUnique({
  where: { id },
  include: {
    project: {
      select: {
        id: true,
        name: true,
        workspaceId: true,
        defaultReviewerId: true,
      },
    },
    team: { select: { identifier: true } },
    assignee: { select: { id: true, clerkId: true } },
    pullRequests: {
      select: {
        id: true,
        number: true,
        title: true,
        url: true,
        state: true,
        authorLogin: true,
        headBranch: true,
        ciStatus: true,
        mergedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    },
  },
})
```

The return statement is already `{ task: { ...task, teamIdentifier: task.team.identifier } }` — `pullRequests` is included automatically via the spread.

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v node_modules
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/tasks/[id]/route.ts app/workspace/[workspaceUrl]/types.ts
git commit -m "feat: include linked pull requests in GET /api/tasks/:id response"
```

---

## Task 9: Linked PRs UI on TaskDetailPage + TaskDetailPanel

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx`

The PR section renders below the Description area (or in the metadata right column). Use the same visual language as the rest of the detail page.

- [ ] **Step 1: Add PullRequestList component inline in TaskDetailPage.tsx**

First, read `TaskDetailPage.tsx` to find where the metadata sidebar renders (look for the Assignee/Reviewer/Project fields section). Add `ApiPullRequest` to the imports from `../../types`.

Then add a `PullRequestList` helper component at the top of the file (before the main component export):

```typescript
function PrStateBadge({ state }: { state: string }) {
  if (state === 'merged') {
    return (
      <span className='inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'>
        Merged
      </span>
    )
  }
  if (state === 'closed') {
    return (
      <span className='inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'>
        Closed
      </span>
    )
  }
  return (
    <span className='inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'>
      Open
    </span>
  )
}

function CiIcon({ status }: { status: string | null }) {
  if (status === 'success')
    return <CheckCircle2 size={13} className='text-emerald-500 shrink-0' />
  if (status === 'failure')
    return <XCircle size={13} className='text-red-500 shrink-0' />
  if (status === 'pending')
    return <Loader2 size={13} className='text-zinc-400 shrink-0 animate-spin' />
  return null
}
```

Import `CheckCircle2, XCircle, Loader2, GitPullRequest` from `lucide-react` (add to existing import if not there).

- [ ] **Step 2: Render PRs in the metadata section of TaskDetailPage**

In the metadata sidebar section (where Assignee, Reviewer, Project rows are rendered), add after the last field row:

```tsx
{
  task.pullRequests && task.pullRequests.length > 0 && (
    <div className='pt-3 border-t border-zinc-100 dark:border-zinc-800'>
      <p className='text-xs font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5'>
        <GitPullRequest size={12} />
        Pull Requests
      </p>
      <ul className='space-y-2'>
        {task.pullRequests.map(pr => (
          <li key={pr.id} className='flex items-start gap-2'>
            <CiIcon status={pr.ciStatus} />
            <div className='min-w-0 flex-1'>
              <a
                href={pr.url}
                target='_blank'
                rel='noopener noreferrer'
                className='text-xs text-zinc-700 dark:text-zinc-300 hover:underline font-medium truncate block'
              >
                #{pr.number} {pr.title}
              </a>
              <div className='flex items-center gap-1.5 mt-0.5'>
                <PrStateBadge state={pr.state} />
                <span className='text-[10px] text-zinc-400 dark:text-zinc-500 font-mono truncate'>
                  {pr.headBranch}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

Note: `task.pullRequests` is populated by the mount fetch (`GET /api/tasks/:id`). The initial `initialTask` from SSR won't have it yet — the section will appear after the fetch resolves and `setTask` is called with the fresh data (already happens at line ~192).

- [ ] **Step 3: Mirror the same changes in TaskDetailPanel.tsx**

`TaskDetailPanel` has the same metadata section layout. Read the file, find the equivalent metadata rows, and apply the same `PrStateBadge`, `CiIcon`, and PR list block. The component receives `task` as a prop — `task.pullRequests` will be available once the parent passes fresh data.

Import the same lucide icons (check what's already imported to avoid duplicates).

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v node_modules
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx \
        app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx
git commit -m "feat: show linked pull requests on task detail page and panel"
```

---

## Done

After all 9 tasks, the full GitHub webhook flow is live:

1. User connects GitHub (existing OAuth) → selects repos (PATCH /api/github/repos) → Lumo auto-creates per-repo webhooks with an HMAC secret
2. Developer opens PR with branch `lumo/ENG-123-fix-bug` → GitHub sends `pull_request.opened` to `/api/webhooks/github` → task `ENG-123` moves to **In Review** + reviewer is notified
3. CI completes → `check_suite.completed` → `ciStatus` updated on the `PullRequest` record
4. PR merged → task moves to **Done**; PR closed without merge → task moves back to **In Progress**
5. Task detail page shows linked PRs with state badge + CI icon + branch name
6. Disconnect or remove a repo → webhooks are deleted from GitHub automatically

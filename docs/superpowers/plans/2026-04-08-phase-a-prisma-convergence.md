# Phase A: Prisma Complete Convergence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move ALL Prisma access into `lib/repositories/`, so no `prisma.` import exists outside that directory. API routes become thin: auth → validate → service → respond.

**Architecture:** Create 10 new domain-aggregated repositories, 9 corresponding services, then migrate 65 API routes in 6 batches. Each batch is independently testable.

**Tech Stack:** TypeScript, Prisma, Zod, Jest

---

### Task 1: Create Notification Repository + Service

**Files:**

- Create: `lib/repositories/notification.repository.ts`
- Create: `lib/services/notification.service.ts`
- Create: `__tests__/lib/repositories/notification.repository.test.ts`
- Create: `__tests__/lib/services/notification.service.test.ts`

- [ ] **Step 1: Write notification repository tests**

```typescript
import { notificationRepository } from '@/lib/repositories/notification.repository'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    notification: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    agentClarify: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}))

describe('notificationRepository', () => {
  it('findByRecipient returns notifications for actor', async () => {
    const { prisma } = require('@/lib/prisma')
    prisma.notification.findMany.mockResolvedValue([{ id: 'n1' }])
    const result = await notificationRepository.findByRecipient(
      'actor-1',
      'ws-1'
    )
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          recipientActorId: 'actor-1',
          workspaceId: 'ws-1',
        }),
      })
    )
    expect(result).toEqual([{ id: 'n1' }])
  })

  it('markAllRead updates unread notifications', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 3 })
    await notificationRepository.markAllRead('actor-1', 'ws-1')
    expect(prisma.notification.updateMany).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern notification.repository`
Expected: FAIL — module not found

- [ ] **Step 3: Implement notification repository**

Read `app/api/notifications/route.ts` (224 lines), `app/api/notifications/[id]/route.ts` (85 lines), and `app/api/notifications/[id]/respond/route.ts` (344 lines). Extract every `prisma.notification.*` and `prisma.agentClarify.*` call into repository methods:

```typescript
// lib/repositories/notification.repository.ts
import { prisma } from '@/lib/prisma'

class NotificationRepository {
  async findByRecipient(actorId: string, workspaceId: string) {
    return prisma.notification.findMany({
      where: { recipientActorId: actorId, workspaceId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  }

  async findById(id: string) {
    return prisma.notification.findUnique({ where: { id } })
  }

  async markRead(id: string) {
    return prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    })
  }

  async markUnread(id: string) {
    return prisma.notification.update({
      where: { id },
      data: { readAt: null },
    })
  }

  async markAllRead(actorId: string, workspaceId: string) {
    return prisma.notification.updateMany({
      where: { recipientActorId: actorId, workspaceId, readAt: null },
      data: { readAt: new Date() },
    })
  }

  async markActionTaken(id: string) {
    return prisma.notification.update({
      where: { id },
      data: { actionTakenAt: new Date(), readAt: new Date() },
    })
  }

  async deleteById(id: string) {
    return prisma.notification.delete({ where: { id } })
  }

  // AgentClarify operations
  async findPendingClarify(taskId: string) {
    return prisma.agentClarify.findFirst({
      where: { taskId, repliedAt: null },
      orderBy: { createdAt: 'desc' },
    })
  }

  async findClarifyById(id: string) {
    return prisma.agentClarify.findUnique({
      where: { id },
      select: { id: true, reply: true, repliedAt: true },
    })
  }

  async createClarify(data: {
    taskId: string
    projectId: string
    question: string
    runId: string
  }) {
    return prisma.agentClarify.create({ data })
  }

  async replyClarify(id: string, reply: string) {
    return prisma.agentClarify.update({
      where: { id },
      data: { reply, repliedAt: new Date() },
    })
  }

  async batchFetchClarifyByIds(ids: string[]) {
    return prisma.agentClarify.findMany({
      where: { id: { in: ids } },
    })
  }
}

export const notificationRepository = new NotificationRepository()
```

Exact field names and query shapes must match the current code in the API routes — read each route carefully.

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern notification.repository`
Expected: PASS

- [ ] **Step 5: Write notification service**

Create `lib/services/notification.service.ts` that orchestrates business logic (e.g., respond to notification, which involves fetching notification + task + updating both). The service calls `notificationRepository` and `taskRepository` — never Prisma directly.

- [ ] **Step 6: Write service tests**

- [ ] **Step 7: Run all tests**

Run: `npm test`
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add lib/repositories/notification.repository.ts lib/services/notification.service.ts __tests__/lib/repositories/notification.repository.test.ts __tests__/lib/services/notification.service.test.ts
git commit -m "feat: add NotificationRepository + NotificationService [LUM-0]"
```

---

### Task 2: Create Agent Repository + Service

**Files:**

- Create: `lib/repositories/agent.repository.ts`
- Create: `lib/services/agent.service.ts`
- Create: `__tests__/lib/repositories/agent.repository.test.ts`
- Create: `__tests__/lib/services/agent.service.test.ts`

- [ ] **Step 1: Read agent route files**

Read these files to extract all Prisma operations:

- `app/api/agent/execute/route.ts` — prisma.task.findUnique
- `app/api/agent/status/[taskId]/route.ts` — prisma.task.findUnique, prisma.agentClarify.findFirst, prisma.pullRequest.findFirst
- `app/api/agent/confirm-spec/route.ts` — prisma.task.findUnique, prisma.task.update
- `app/api/agent/cancel/route.ts` — prisma.task.findUnique, prisma.agentRun.findFirst, prisma.agentRun.update
- `app/api/agent/retry/route.ts` — prisma.task.findUnique, prisma.task.update
- `app/api/agent/resume/route.ts` — prisma.task.findUnique
- `app/api/agent/mcp-clarify/route.ts` — prisma.agentClarify.findFirst, prisma.task.findUnique, prisma.agentClarify.create
- `app/api/agent/mcp-clarify/[id]/route.ts` — prisma.agentClarify.findUnique
- `app/api/cron/check-agent-timeouts/route.ts` — prisma.task.findMany, prisma.agentRun.findFirst, prisma.agentRun.update

- [ ] **Step 2: Write agent repository**

Encapsulate `prisma.agentRun.*` and `prisma.agentProfile.*` operations. Note: agent routes also use `prisma.task.*` — those calls should use the existing `taskRepository`. Only new `agentRun` and `agentProfile` queries go in `agent.repository.ts`.

Methods needed:

- `findActiveRun(taskId)` — findFirst where status is active
- `cancelRun(runId)` — update status to CANCELED
- `failRun(runId, error)` — update status to FAILED
- `findTimedOutTasks()` — findMany tasks with INPUT_REQUIRED > 24h

- [ ] **Step 3: Write agent repository tests**

- [ ] **Step 4: Write agent service**

Orchestrate agent operations: execute, cancel, retry, confirm-spec, resume. Each method calls `agentRepository` + `taskRepository` + `notificationRepository` as needed.

- [ ] **Step 5: Write agent service tests**

- [ ] **Step 6: Run tests, commit**

```bash
git commit -m "feat: add AgentRepository + AgentService [LUM-0]"
```

---

### Task 3: Migrate Notification + Agent API Routes

**Files:**

- Modify: `app/api/notifications/route.ts`
- Modify: `app/api/notifications/[id]/route.ts`
- Modify: `app/api/notifications/[id]/respond/route.ts`
- Modify: `app/api/agent/execute/route.ts`
- Modify: `app/api/agent/status/[taskId]/route.ts`
- Modify: `app/api/agent/confirm-spec/route.ts`
- Modify: `app/api/agent/cancel/route.ts`
- Modify: `app/api/agent/retry/route.ts`
- Modify: `app/api/agent/resume/route.ts`
- Modify: `app/api/agent/mcp-clarify/route.ts`
- Modify: `app/api/agent/mcp-clarify/[id]/route.ts`
- Modify: `app/api/cron/check-agent-timeouts/route.ts`

- [ ] **Step 1: Replace Prisma calls with service/repository calls in each route**

For each route file:

1. Remove `import { prisma } from '@/lib/prisma'`
2. Add `import { notificationService } from '@/lib/services'` or `import { agentService } from '@/lib/services'`
3. Replace each `prisma.xxx.yyy()` call with the corresponding service method
4. Routes should become: auth → validate → service call → format response

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: zero errors

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor: migrate notification + agent routes to service layer [LUM-0]"
```

---

### Task 4: Create GitHub + Slack Repositories + Services

**Files:**

- Create: `lib/repositories/github.repository.ts`
- Create: `lib/repositories/slack.repository.ts`
- Create: `lib/services/github.service.ts`
- Create: `lib/services/slack.service.ts`
- Create: tests for each

- [ ] **Step 1: Read GitHub route files**

Read `app/api/github/repos/route.ts`, `github/integration/route.ts`, `github/callback/route.ts`, `github/authorized-repos/route.ts`, `webhooks/github/handlers.ts`, `webhooks/github/route.ts`. Extract all `prisma.gitHubIntegration.*`, `prisma.gitHubWebhook.*`, `prisma.taskBranch.*` calls.

- [ ] **Step 2: Write github.repository.ts**

Methods: findIntegration, createIntegration, updateIntegration, deleteIntegration, findWebhook, createWebhook, findBranch, createBranch, etc.

- [ ] **Step 3: Read Slack route files**

Read `app/api/slack/integration/route.ts`, `slack/channels/route.ts`, `slack/channels/[id]/route.ts`, `slack/available-channels/route.ts`, `slack/create-channel/route.ts`, `slack/callback/route.ts`. Extract all `prisma.slackIntegration.*`, `prisma.slackChannel.*` calls.

- [ ] **Step 4: Write slack.repository.ts**

- [ ] **Step 5: Write services and tests for both**

- [ ] **Step 6: Run tests, commit**

```bash
git commit -m "feat: add GitHub + Slack repositories and services [LUM-0]"
```

---

### Task 5: Migrate GitHub + Slack Routes

**Files:**

- Modify: all GitHub route files (~6 files)
- Modify: all Slack route files (~6 files)

- [ ] **Step 1: Replace Prisma calls with service calls in each route**
- [ ] **Step 2: Type check + tests**
- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: migrate GitHub + Slack routes to service layer [LUM-0]"
```

---

### Task 6: Create Invite + Member + View Repositories + Services

**Files:**

- Create: `lib/repositories/invite.repository.ts`
- Create: `lib/repositories/member.repository.ts`
- Create: `lib/repositories/view.repository.ts`
- Create: `lib/services/invite.service.ts`
- Create: `lib/services/member.service.ts`
- Create: `lib/services/view.service.ts`
- Create: tests for each

- [ ] **Step 1: Read invite routes** (`app/api/invites/route.ts`, `invites/[token]/route.ts`, `invites/[token]/accept/route.ts`, `invites/[token]/resend/route.ts`)

- [ ] **Step 2: Write invite.repository.ts + invite.service.ts**

- [ ] **Step 3: Read member routes** (`app/api/workspaces/members/route.ts`, `members/[memberId]/route.ts`, `members/me/route.ts`). Note: split `prisma.workspaceMember.*` out of existing `workspace.repository.ts` into dedicated `member.repository.ts`.

- [ ] **Step 4: Write member.repository.ts + member.service.ts**

- [ ] **Step 5: Read view routes** (`app/api/views/[viewId]/task-orders/route.ts`, also `tasks/me/route.ts` for view operations)

- [ ] **Step 6: Write view.repository.ts + view.service.ts**

- [ ] **Step 7: Write tests for all**

- [ ] **Step 8: Commit**

```bash
git commit -m "feat: add invite, member, view repositories and services [LUM-0]"
```

---

### Task 7: Migrate Invite + Member + View Routes

- [ ] **Step 1: Replace Prisma calls in invite routes**
- [ ] **Step 2: Replace Prisma calls in member routes**
- [ ] **Step 3: Replace Prisma calls in view routes**
- [ ] **Step 4: Type check + tests + commit**

```bash
git commit -m "refactor: migrate invite + member + view routes to service layer [LUM-0]"
```

---

### Task 8: Create Draft + Summary + Misc Repositories

**Files:**

- Create: `lib/repositories/draft.repository.ts`
- Create: `lib/repositories/summary.repository.ts`
- Create: `lib/repositories/misc.repository.ts`
- Create: `lib/services/draft.service.ts`
- Create: `lib/services/summary.service.ts`
- Create: tests for each

- [ ] **Step 1: Read draft routes** (`app/api/drafts/route.ts`, `drafts/[id]/route.ts`)

- [ ] **Step 2: Write draft.repository.ts + draft.service.ts**

- [ ] **Step 3: Read summary routes** (`app/api/summaries/workspace/route.ts`, `summaries/project/[projectId]/route.ts`, `summaries/generate/route.ts`)

- [ ] **Step 4: Write summary.repository.ts + summary.service.ts**

- [ ] **Step 5: Read misc routes** and write misc.repository.ts for: waitlistEntry, apiKey, userPreference, priorityOverride, projectRepository, documentMention. No service — routes call repository directly.

- [ ] **Step 6: Write tests, commit**

```bash
git commit -m "feat: add draft, summary, misc repositories and services [LUM-0]"
```

---

### Task 9: Migrate Draft + Summary + Misc Routes

- [ ] **Step 1: Migrate draft routes**
- [ ] **Step 2: Migrate summary routes**
- [ ] **Step 3: Migrate misc routes** (waitlist, apiKey, userPreference, priorityOverride, projectRepository, share/[token])
- [ ] **Step 4: Migrate remaining task routes** that weren't covered by existing task.service.ts (tasks/me, tasks/check-duplicates, tasks/generate-description, tasks/suggest-priority, tasks/parse-quick-dispatch, tasks/priority-override, tasks/[id]/branch, tasks/[id]/documents, tasks/[id]/decompose, projects/[id]/tasks)
- [ ] **Step 5: Type check + tests + commit**

```bash
git commit -m "refactor: migrate remaining routes to service layer [LUM-0]"
```

---

### Task 10: Fix Service Prisma Leaks

**Files:**

- Modify: `lib/services/task.service.ts`
- Modify: `lib/services/project.service.ts`
- Modify: `lib/services/document.service.ts`

- [ ] **Step 1: Fix task.service.ts**

Move parent task, project, and actor existence validation queries into `taskRepository` and `member.repository` methods. Replace direct `prisma.task.findUnique()`, `prisma.project.findUnique()`, `prisma.actor.findUnique()` with repository calls.

- [ ] **Step 2: Fix project.service.ts**

Move reviewer validation (`prisma.workspaceMember.findUnique`) to `member.repository.findById()`.

- [ ] **Step 3: Fix document.service.ts**

Move mention sync transaction (`prisma.document.*` + `prisma.documentMention.*`) into `document.repository` method.

- [ ] **Step 4: Remove `prisma` import from all three service files**

- [ ] **Step 5: Type check + tests + commit**

```bash
git commit -m "refactor: remove Prisma leaks from service layer [LUM-0]"
```

---

### Task 11: Update Barrel Exports + Final Verification

**Files:**

- Modify: `lib/repositories/index.ts`
- Modify: `lib/services/index.ts`

- [ ] **Step 1: Add all new repositories and services to barrel exports**

- [ ] **Step 2: Verify zero Prisma imports outside repositories**

Run: `grep -rn "from '@/lib/prisma'" --include='*.ts' --include='*.tsx' | grep -v 'lib/repositories/' | grep -v '__tests__/' | grep -v 'tests/' | grep -v '.test.'`

Expected: zero results (or only `lib/prisma.ts` itself)

- [ ] **Step 3: Full type check + tests**

Run: `npx tsc --noEmit && npm test`
Expected: zero errors, all tests pass

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: complete Prisma convergence — all access via repositories [LUM-0]"
```

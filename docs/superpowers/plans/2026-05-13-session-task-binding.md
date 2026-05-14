# Session-Task Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable per-session task binding via the session-start hook, so each Claude Code Desktop conversation can independently bind to a task without relying on the global `current-task.json`.

**Architecture:** The session-start hook POST now returns a `taskBinding` payload. The CLI reads this response and writes a prompt to stdout (which Claude Code injects into conversation context). A new `POST /api/sessions/:sessionId/bind-task` API lets Claude bind the session to a task on behalf of the user. The existing `handleHookRequest` handler gains support for `afterRecord` returning data to merge into the response.

**Tech Stack:** Next.js API routes, Prisma, TypeScript, Jest

**Spec:** `docs/superpowers/specs/2026-05-13-session-task-binding-design.md`

---

## File Map

| Action | File                                                            | Responsibility                                                  |
| ------ | --------------------------------------------------------------- | --------------------------------------------------------------- |
| Modify | `app/api/hooks/_handler.ts`                                     | `afterRecord` returns optional data merged into response        |
| Modify | `app/api/hooks/session-start/route.ts`                          | Pass `afterRecord` that queries task binding                    |
| Create | `app/api/sessions/[sessionId]/bind-task/route.ts`               | New API: bind a specific session to a task                      |
| Modify | `lib/services/session.service.ts`                               | New `bindSessionToTask()` method                                |
| Modify | `lib/repositories/session.repository.ts`                        | New `findTaskBinding()` + `findByIdForMember()`                 |
| Modify | `cli/src/lib/hook-runner.ts`                                    | Read session-start response body, write stdout                  |
| Create | `__tests__/lib/repositories/session-repository-binding.test.ts` | Tests for `findTaskBinding` + `findByIdForMember`               |
| Create | `__tests__/lib/services/session-service-bind.test.ts`           | Tests for `bindSessionToTask`                                   |
| Create | `__tests__/cli/hook-runner-session-start-stdout.test.ts`        | Tests for stdout output on session-start                        |
| Modify | `__tests__/app/api/hooks/route.integration.test.ts`             | Test afterRecord data merging (if existing test covers handler) |

---

### Task 1: Repository — `findTaskBinding` + `findByIdForMember`

**Files:**

- Modify: `lib/repositories/session.repository.ts`
- Create: `__tests__/lib/repositories/session-repository-binding.test.ts`

- [ ] **Step 1: Write failing tests for `findTaskBinding`**

```ts
// __tests__/lib/repositories/session-repository-binding.test.ts
/**
 * @jest-environment node
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    session: {
      findUnique: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { sessionRepository } from '@/lib/repositories/session.repository'

const findUnique = prisma.session.findUnique as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('sessionRepository.findTaskBinding', () => {
  it('returns bound:true with identifier and title when session has a task', async () => {
    findUnique.mockResolvedValue({
      task: { identifier: 'LUM-12', title: 'Add OAuth' },
    })
    const result = await sessionRepository.findTaskBinding('sess_1')
    expect(result).toEqual({
      bound: true,
      taskIdentifier: 'LUM-12',
      taskTitle: 'Add OAuth',
    })
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'sess_1' },
      select: { task: { select: { identifier: true, title: true } } },
    })
  })

  it('returns bound:false when session has no task', async () => {
    findUnique.mockResolvedValue({ task: null })
    const result = await sessionRepository.findTaskBinding('sess_1')
    expect(result).toEqual({ bound: false })
  })

  it('returns bound:false when session does not exist', async () => {
    findUnique.mockResolvedValue(null)
    const result = await sessionRepository.findTaskBinding('sess_1')
    expect(result).toEqual({ bound: false })
  })
})

// findByIdForMember already exists and is tested in session.repository.test.ts
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/repositories/session-repository-binding.test.ts -v`
Expected: FAIL — `sessionRepository.findTaskBinding is not a function` and `sessionRepository.findByIdForMember is not a function`

- [ ] **Step 3: Implement `findTaskBinding` and `findByIdForMember`**

Add to `lib/repositories/session.repository.ts`, inside the `sessionRepository` object, after the existing `updateTaskId` method:

```ts
  async findTaskBinding(
    sessionId: string
  ): Promise<
    { bound: true; taskIdentifier: string; taskTitle: string } | { bound: false }
  > {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { task: { select: { identifier: true, title: true } } },
    })
    if (!session?.task) return { bound: false }
    return {
      bound: true,
      taskIdentifier: session.task.identifier,
      taskTitle: session.task.title,
    }
  },

  async findByIdForMember(sessionId: string, workspaceMemberId: string) {
    return prisma.session.findFirst({
      where: { id: sessionId, workspaceMemberId },
      select: { id: true, taskId: true },
    })
  },
```

Note: There is an existing `findByIdForMember(id, workspaceMemberId)` method at line 139. It returns more select fields than we need, but it works for our ownership check — we just need non-null to confirm the session belongs to the user. **Reuse the existing method. Only add `findTaskBinding`.**

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/repositories/session-repository-binding.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/session.repository.ts __tests__/lib/repositories/session-repository-binding.test.ts
git commit -m "feat: add sessionRepository.findTaskBinding for per-session task binding"
```

---

### Task 2: Service — `bindSessionToTask`

**Files:**

- Modify: `lib/services/session.service.ts`
- Create: `__tests__/lib/services/session-service-bind.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// __tests__/lib/services/session-service-bind.test.ts
/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    findByIdForMember: jest.fn(),
    updateTaskId: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: {
    bulkSetTaskIdForNullEventsInSession: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: {
    findMemberIdForHook: jest.fn(),
  },
}))
jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    resolveIdentifier: jest.fn(),
  },
}))

import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { taskService } from '@/lib/services/task.service'
import { sessionService } from '@/lib/services/session.service'

const sessRepo = sessionRepository as jest.Mocked<typeof sessionRepository>
const hookRepo = hookEventRepository as jest.Mocked<typeof hookEventRepository>
const misc = miscRepository as jest.Mocked<typeof miscRepository>
const task = taskService as jest.Mocked<typeof taskService>

const identity = {
  user: { id: 'clerk_1', email: 'a@b.c', name: 'A' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'key_1', name: 'laptop', prefix: 'lum_abc' },
}

beforeEach(() => {
  jest.clearAllMocks()
  misc.findMemberIdForHook.mockResolvedValue('wm_1')
  sessRepo.findByIdForMember.mockResolvedValue({
    id: 'sess_1',
    taskId: null,
  } as never)
  task.resolveIdentifier.mockResolvedValue({
    id: 'task_1',
    identifier: 'LUM-42',
    title: 'Fix login bug',
    status: 'TODO',
  })
  sessRepo.updateTaskId.mockResolvedValue({
    id: 'sess_1',
    taskId: 'task_1',
  } as never)
  hookRepo.bulkSetTaskIdForNullEventsInSession.mockResolvedValue({ count: 3 })
})

describe('sessionService.bindSessionToTask', () => {
  it('binds session to task and re-tags null events', async () => {
    const result = await sessionService.bindSessionToTask({
      identity,
      sessionId: 'sess_1',
      taskIdentifier: 'LUM-42',
    })

    expect(misc.findMemberIdForHook).toHaveBeenCalledWith('clerk_1', 'ws_1')
    expect(sessRepo.findByIdForMember).toHaveBeenCalledWith('sess_1', 'wm_1')
    expect(task.resolveIdentifier).toHaveBeenCalledWith('ws_1', 'LUM-42')
    expect(sessRepo.updateTaskId).toHaveBeenCalledWith('sess_1', 'task_1')
    expect(hookRepo.bulkSetTaskIdForNullEventsInSession).toHaveBeenCalledWith(
      'sess_1',
      'task_1'
    )
    expect(result).toEqual({
      taskId: 'task_1',
      taskIdentifier: 'LUM-42',
      taskTitle: 'Fix login bug',
    })
  })

  it('throws 403 when user is not a workspace member', async () => {
    misc.findMemberIdForHook.mockResolvedValue(null)
    await expect(
      sessionService.bindSessionToTask({
        identity,
        sessionId: 'sess_1',
        taskIdentifier: 'LUM-42',
      })
    ).rejects.toMatchObject({ status: 403 })
  })

  it('throws 404 when session does not exist or belong to user', async () => {
    sessRepo.findByIdForMember.mockResolvedValue(null)
    await expect(
      sessionService.bindSessionToTask({
        identity,
        sessionId: 'sess_1',
        taskIdentifier: 'LUM-42',
      })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 404 when task identifier cannot be resolved', async () => {
    task.resolveIdentifier.mockResolvedValue(null)
    await expect(
      sessionService.bindSessionToTask({
        identity,
        sessionId: 'sess_1',
        taskIdentifier: 'LUM-999',
      })
    ).rejects.toMatchObject({ status: 404 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/services/session-service-bind.test.ts -v`
Expected: FAIL — `sessionService.bindSessionToTask is not a function`

- [ ] **Step 3: Implement `bindSessionToTask`**

Add to `lib/services/session.service.ts`, inside the `sessionService` object, after the existing `attachToTask` method:

```ts
  async bindSessionToTask({
    identity,
    sessionId,
    taskIdentifier,
  }: BindSessionToTaskInput): Promise<BindSessionToTaskResult> {
    const memberId = await miscRepository.findMemberIdForHook(
      identity.user.id,
      identity.workspace.id
    )
    if (!memberId) {
      throw Object.assign(new Error('Not a workspace member'), { status: 403 })
    }

    const session = await sessionRepository.findByIdForMember(sessionId, memberId)
    if (!session) {
      throw Object.assign(new Error('Session not found'), { status: 404 })
    }

    const task = await taskService.resolveIdentifier(
      identity.workspace.id,
      taskIdentifier
    )
    if (!task) {
      throw Object.assign(
        new Error(`Task ${taskIdentifier} not found in workspace`),
        { status: 404 }
      )
    }

    await sessionRepository.updateTaskId(sessionId, task.id)
    await hookEventRepository.bulkSetTaskIdForNullEventsInSession(
      sessionId,
      task.id
    )

    return {
      taskId: task.id,
      taskIdentifier: task.identifier,
      taskTitle: task.title,
    }
  },
```

Add the interfaces at the top of the file (after existing interfaces):

```ts
interface BindSessionToTaskInput {
  identity: VerifyApiKeyResult
  sessionId: string
  taskIdentifier: string
}

interface BindSessionToTaskResult {
  taskId: string
  taskIdentifier: string
  taskTitle: string
}
```

Note: the existing `findByIdForMember` method (line 139 in session.repository.ts) takes `(id, workspaceMemberId)` and returns a larger select set. It works for our ownership check — we just need it to return non-null to confirm the session belongs to the user.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/services/session-service-bind.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/services/session.service.ts __tests__/lib/services/session-service-bind.test.ts
git commit -m "feat: add sessionService.bindSessionToTask for per-session task binding"
```

---

### Task 3: API route — `POST /api/sessions/[sessionId]/bind-task`

**Files:**

- Create: `app/api/sessions/[sessionId]/bind-task/route.ts`

- [ ] **Step 1: Create the route**

```ts
// app/api/sessions/[sessionId]/bind-task/route.ts
import { NextResponse } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { sessionService } from '@/lib/services/session.service'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

interface Body {
  taskIdentifier?: unknown
}

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })

  const { sessionId } = await context.params

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const taskIdentifier =
    typeof body.taskIdentifier === 'string' ? body.taskIdentifier.trim() : ''
  if (!taskIdentifier) {
    return NextResponse.json(
      { error: 'taskIdentifier is required (e.g. "LUM-42")' },
      { status: 400 }
    )
  }

  try {
    const result = await sessionService.bindSessionToTask({
      identity,
      sessionId,
      taskIdentifier,
    })
    return NextResponse.json(result)
  } catch (error) {
    const status = (error as { status?: number } | null)?.status
    if (status === 403 || status === 404) {
      const message = error instanceof Error ? error.message : 'Error'
      return NextResponse.json({ error: message }, { status })
    }
    console.error('POST /api/sessions/[sessionId]/bind-task error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to the new route

- [ ] **Step 3: Commit**

```bash
git add app/api/sessions/\\[sessionId\\]/bind-task/route.ts
git commit -m "feat: add POST /api/sessions/:sessionId/bind-task route"
```

---

### Task 4: `handleHookRequest` — support `afterRecord` returning data

**Files:**

- Modify: `app/api/hooks/_handler.ts`

- [ ] **Step 1: Update `afterRecord` type signature and response merging**

In `app/api/hooks/_handler.ts`, change the `afterRecord` type in `HandleHookOptions`:

From:

```ts
  afterRecord?: (ctx: AfterRecordContext, identity: VerifyApiKeyResult) => void
```

To:

```ts
  afterRecord?: (
    ctx: AfterRecordContext,
    identity: VerifyApiKeyResult
  ) => void | Record<string, unknown> | Promise<void | Record<string, unknown>>
```

Then change the `afterRecord` invocation and response construction. Replace the existing block (lines ~54-73 and the final `return`):

Find the current code block:

```ts
if (options.afterRecord) {
  try {
    options.afterRecord(
      {
        eventId: recorded.id,
        sessionId: recorded.sessionId,
        taskId: recorded.taskId,
        workspaceId: identity.workspace.id,
      },
      identity
    )
  } catch (sideEffectError) {
    console.error(`POST /api/hooks/${type} afterRecord error:`, sideEffectError)
  }
}

return NextResponse.json({ ok: true })
```

Replace with:

```ts
let extra: Record<string, unknown> | void | undefined
if (options.afterRecord) {
  try {
    extra = await options.afterRecord(
      {
        eventId: recorded.id,
        sessionId: recorded.sessionId,
        taskId: recorded.taskId,
        workspaceId: identity.workspace.id,
      },
      identity
    )
  } catch (sideEffectError) {
    console.error(`POST /api/hooks/${type} afterRecord error:`, sideEffectError)
  }
}

return NextResponse.json({ ok: true, ...extra })
```

- [ ] **Step 2: Verify existing stop/stop-failure routes still work**

The existing `afterRecord` callbacks in `stop/route.ts` and `stop-failure/route.ts` return `void` (they use `waitUntil` for fire-and-forget). The new signature accepts `void` return, so they are unaffected. `...undefined` spreads to nothing, so the response remains `{ ok: true }`.

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add app/api/hooks/_handler.ts
git commit -m "feat: handleHookRequest afterRecord can return data merged into response"
```

---

### Task 5: session-start route — return `taskBinding` in response

**Files:**

- Modify: `app/api/hooks/session-start/route.ts`

- [ ] **Step 1: Update the route to pass `afterRecord` with task binding query**

Replace the entire contents of `app/api/hooks/session-start/route.ts`:

```ts
import { handleHookRequest } from '@/app/api/hooks/_handler'
import { sessionRepository } from '@/lib/repositories/session.repository'

export async function POST(request: Request) {
  return handleHookRequest(request, 'SESSION_START', {
    afterRecord: async ctx => {
      if (!ctx.sessionId) return
      const binding = await sessionRepository.findTaskBinding(ctx.sessionId)
      return { sessionId: ctx.sessionId, taskBinding: binding }
    },
  })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add app/api/hooks/session-start/route.ts
git commit -m "feat: session-start hook returns taskBinding in response"
```

---

### Task 6: CLI hook-runner — read session-start response and write stdout

**Files:**

- Modify: `cli/src/lib/hook-runner.ts`
- Create: `__tests__/cli/hook-runner-session-start-stdout.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// __tests__/cli/hook-runner-session-start-stdout.test.ts
/**
 * @jest-environment node
 */

import { formatSessionStartOutput } from '@/cli/src/lib/hook-runner'

describe('formatSessionStartOutput', () => {
  it('returns bound message when taskBinding.bound is true', () => {
    const body = {
      sessionId: 'sess_abc',
      taskBinding: {
        bound: true,
        taskIdentifier: 'LUM-12',
        taskTitle: 'Add OAuth',
      },
    }
    expect(formatSessionStartOutput(body)).toBe(
      '[Lumo] session_id=sess_abc | 当前任务: LUM-12 - Add OAuth'
    )
  })

  it('returns unbound message when taskBinding.bound is false', () => {
    const body = {
      sessionId: 'sess_abc',
      taskBinding: { bound: false },
    }
    expect(formatSessionStartOutput(body)).toBe(
      '[Lumo] session_id=sess_abc | 当前未绑定任务。请告诉我你要处理的任务编号（如 LUM-42），或说"跳过"。'
    )
  })

  it('returns null when body has no taskBinding', () => {
    expect(formatSessionStartOutput({ ok: true })).toBeNull()
  })

  it('returns null when body has no sessionId', () => {
    const body = { taskBinding: { bound: false } }
    expect(formatSessionStartOutput(body)).toBeNull()
  })

  it('returns null for null/undefined body', () => {
    expect(formatSessionStartOutput(null)).toBeNull()
    expect(formatSessionStartOutput(undefined)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/cli/hook-runner-session-start-stdout.test.ts -v`
Expected: FAIL — `formatSessionStartOutput` is not exported

- [ ] **Step 3: Implement `formatSessionStartOutput` and integrate into `runHook`**

In `cli/src/lib/hook-runner.ts`, add a new exported function before `runHook`:

```ts
export function formatSessionStartOutput(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const sessionId = b.sessionId
  const binding = b.taskBinding
  if (typeof sessionId !== 'string' || !binding || typeof binding !== 'object')
    return null
  const tb = binding as Record<string, unknown>
  if (tb.bound === true) {
    return `[Lumo] session_id=${sessionId} | 当前任务: ${tb.taskIdentifier} - ${tb.taskTitle}`
  }
  if (tb.bound === false) {
    return `[Lumo] session_id=${sessionId} | 当前未绑定任务。请告诉我你要处理的任务编号（如 LUM-42），或说"跳过"。`
  }
  return null
}
```

Then in the `runHook` function, after the existing `if (!res.ok)` check, add handling for `session-start`:

Find this block:

```ts
if (!res.ok) {
  logHookError(`[${path}]`, `HTTP ${res.status} from ${url}`)
}
```

Replace with:

```ts
if (!res.ok) {
  logHookError(`[${path}]`, `HTTP ${res.status} from ${url}`)
} else if (path === 'session-start') {
  try {
    const body = await res.json()
    const output = formatSessionStartOutput(body)
    if (output) process.stdout.write(output + '\n')
  } catch {
    // response body parse failure is non-fatal
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/cli/hook-runner-session-start-stdout.test.ts -v`
Expected: PASS

- [ ] **Step 5: Run existing hook-runner tests to ensure no regression**

Run: `npx jest __tests__/cli/hook-runner-inject.test.ts -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add cli/src/lib/hook-runner.ts __tests__/cli/hook-runner-session-start-stdout.test.ts
git commit -m "feat: session-start hook writes task binding status to stdout"
```

---

### Task 7: Integration verification

- [ ] **Step 1: Run full test suite**

Run: `npm test 2>&1 | tail -20`
Expected: All tests pass

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 3: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix: address any test/type issues from session-task binding"
```

Only commit if there were fixups. Skip if everything passed clean.

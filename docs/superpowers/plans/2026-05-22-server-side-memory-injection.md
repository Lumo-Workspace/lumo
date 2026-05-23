# Server-side memory injection (retire LUMO.md) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire local `LUMO.md` + the entire `LumoProposal`/`lumo-sync` GitHub-PR pipeline. Replace with server-side memory injection: SessionStart hook injects via `additionalContext`; `lumo session attach` returns `memorySection` in its response body.

**Architecture:** The `Memory` table stays the sole source of truth (no changes there). A new server-side helper `taskContextService.buildMemorySectionForTask(taskId)` is extracted from the existing `getContextForIdentifier` flow and reused at two injection points: the `/api/hooks/session-start` route and the `/api/sessions/[sessionId]/bind-task` route. The Lumo CLI's hook runner emits Claude Code's `hookSpecificOutput.additionalContext` JSON on stdout when the server returns a `memorySection` field; the `session attach` CLI command prints `memorySection` as plain text after its existing bind line.

**Tech Stack:** Next.js 14 (App Router), TypeScript strict, Prisma, Jest, React Testing Library, react-intl.

**Spec:** [`docs/superpowers/specs/2026-05-22-server-side-memory-injection-design.md`](../specs/2026-05-22-server-side-memory-injection-design.md)

---

## File Structure Overview

**New files (server)**
- None — `buildMemorySectionForTask` lives inside the existing `lib/services/task-context.service.ts`.

**New files (tests)**
- `__tests__/lib/services/task-context-build-memory.test.ts` — unit test for the new helper
- `__tests__/api/hooks/session-start-memory-injection.test.ts` — integration test for hook response shape
- `__tests__/api/sessions/bind-task-memory-injection.test.ts` — integration test for bind-task response shape
- `__tests__/cli/hook-runner-additional-context.test.ts` — unit test for the CLI's `hookSpecificOutput` JSON emission

**Modified files (server)**
- `lib/services/task-context.service.ts` — extract `buildMemorySectionForTask`, refactor `getContextForIdentifier` to call it
- `lib/services/session.service.ts` — `bindSessionToTask` returns `memorySection`
- `app/api/hooks/session-start/route.ts` — return `memorySection` when bound
- `app/api/sessions/[sessionId]/bind-task/route.ts` — already pipes service result through; no logic change, but types update
- `cli/src/lib/hook-runner.ts` — emit `hookSpecificOutput` JSON when server returns `memorySection`
- `cli/src/commands/session-attach.ts` — print `memorySection` after bind line
- `lib/services/agent-run-timeline.service.ts` — drop `unsyncedMemoryCount` computation
- `prisma/schema.prisma` — drop `LumoProposal` model, `LumoProposalStatus` enum, and reverse relations on `Task` and `Member`
- `CLAUDE.md` — remove `@import LUMO.md` line
- `app/workspace/[workspaceUrl]/types.ts` — remove `unsyncedMemoryCount` field
- `app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunTab.tsx` — remove `SyncLumoBanner` import + usage
- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TimelineTabs.tsx` — remove `unsyncedMemoryCount` consumption + `memoryCount` prop pass-through
- `app/workspace/[workspaceUrl]/constants.ts` — remove `lumoSync` messages
- `.claude/settings.json` — unchanged (hook command stays `lumo hook session-start`)

**Deleted files (server)**
- `LUMO.md` (repo root)
- `lib/repositories/lumo-proposal.repository.ts`
- `lib/services/lumo-proposal/` (whole directory: `lumo-proposal.service.ts`, `lumo-md-writer.ts`, `lumo-onboarding.service.ts`)
- `lib/services/lumo-sync/` (whole directory: `lumo-sync.service.ts`, `github-tree.service.ts`)
- `lib/llm/lumo-proposal-client.ts`
- `lib/validation/lumo-proposal.schema.ts`
- `lib/api-client/lumo-sync.ts`
- `app/api/tasks/[id]/lumo-proposals/route.ts`
- `app/api/lumo-proposals/[proposalId]/dismiss/route.ts`
- `app/api/lumo-proposals/[proposalId]/sync/route.ts`
- `app/workspace/[workspaceUrl]/components/AgentRunTimeline/SyncLumoBanner.tsx`
- Tests: `__tests__/lumo-proposal-client.test.ts`, `__tests__/lumo-proposal.service.test.ts`, `__tests__/api-lumo-proposals.test.ts`, `__tests__/api-lumo-sync.test.ts`, `__tests__/lumo-proposal.repository.test.ts`, `__tests__/lumo-sync.service.test.ts`, `__tests__/lumo-md-writer.test.ts`, `__tests__/lumo-onboarding.service.test.ts`
- Scripts: `scripts/test-lumo-proposal.ts`, `scripts/test-lumo-apply.ts`

**New migration**
- `prisma/migrations/<timestamp>_drop_lumo_proposal/migration.sql` — drops table + enum

---

## Phase 1 — Extract `buildMemorySectionForTask` helper

Goal: pull the "fetch task + project memories → token budget → render" logic out of `getContextForIdentifier` into a standalone function that takes a `taskId` and returns markdown. This is the renderer used by both injection sites later.

### Task 1.1: Add failing unit test for `buildMemorySectionForTask`

**Files:**
- Create: `__tests__/lib/services/task-context-build-memory.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/services/task-context-build-memory.test.ts
import { taskContextService } from '@/lib/services/task-context.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'

jest.mock('@/lib/repositories/task.repository')
jest.mock('@/lib/repositories/memory.repository')

describe('taskContextService.buildMemorySectionForTask', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('returns "" when task has no task-scope or project-scope memories', async () => {
    ;(taskRepository.findById as jest.Mock).mockResolvedValue({
      id: 'task-1',
      projectId: 'project-1',
    })
    ;(memoryRepository.findActiveTaskMemories as jest.Mock).mockResolvedValue([])
    ;(memoryRepository.findActiveProjectMemories as jest.Mock).mockResolvedValue([])

    const result = await taskContextService.buildMemorySectionForTask('task-1')

    expect(result).toBe('')
  })

  it('returns markdown with PROJECT-scope memories ordered before TASK-scope', async () => {
    ;(taskRepository.findById as jest.Mock).mockResolvedValue({
      id: 'task-1',
      projectId: 'project-1',
    })
    ;(memoryRepository.findActiveProjectMemories as jest.Mock).mockResolvedValue([
      {
        id: 'mem-p',
        category: 'CONVENTION',
        content: { rule: 'Use named exports', scope: 'project' },
      },
    ])
    ;(memoryRepository.findActiveTaskMemories as jest.Mock).mockResolvedValue([
      {
        id: 'mem-t',
        category: 'TRAP',
        content: { trigger: 'X', outcome: 'Y' },
      },
    ])

    const result = await taskContextService.buildMemorySectionForTask('task-1')

    expect(result).toContain('## Relevant Memory')
    expect(result).toContain('### Traps')
    expect(result).toContain('[task]')
    expect(result).toContain('### Conventions')
    expect(result).toContain('[project]')
    // Traps render before Conventions (CATEGORY_ORDER in render.ts)
    expect(result.indexOf('### Traps')).toBeLessThan(
      result.indexOf('### Conventions')
    )
  })

  it('returns "" when task does not exist', async () => {
    ;(taskRepository.findById as jest.Mock).mockResolvedValue(null)

    const result = await taskContextService.buildMemorySectionForTask('missing')

    expect(result).toBe('')
    expect(memoryRepository.findActiveTaskMemories).not.toHaveBeenCalled()
    expect(memoryRepository.findActiveProjectMemories).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/services/task-context-build-memory.test.ts`
Expected: FAIL — `taskContextService.buildMemorySectionForTask is not a function`.

- [ ] **Step 3: Commit failing test**

```bash
git add __tests__/lib/services/task-context-build-memory.test.ts
git commit -m "test: add failing spec for buildMemorySectionForTask [LUM-64]"
```

### Task 1.2: Implement `buildMemorySectionForTask` and refactor `getContextForIdentifier` to use it

**Files:**
- Modify: `lib/services/task-context.service.ts`

- [ ] **Step 1: Extract helper and update caller**

In `lib/services/task-context.service.ts`, add a new method on `taskContextService` and refactor the existing inline block (lines ~210–233 in `getContextForIdentifier`) to call it:

```ts
// Within the taskContextService object, add this method (place before getContextForIdentifier):
async buildMemorySectionForTask(taskId: string): Promise<string> {
  const task = await taskRepository.findById(taskId)
  if (!task) return ''

  const [taskMemories, projectMemories] = await Promise.all([
    memoryRepository.findActiveTaskMemories(taskId),
    memoryRepository.findActiveProjectMemories(task.projectId),
  ])

  // Project memories first (broader applicability, survive task archival),
  // then task memories. applyTokenBudget drops the tail on overflow.
  const ordered: RenderableMemory[] = [
    ...projectMemories.map(m => ({
      id: m.id,
      scope: 'PROJECT' as const,
      category: m.category,
      content: m.content,
    })),
    ...taskMemories.map(m => ({
      id: m.id,
      scope: 'TASK' as const,
      category: m.category,
      content: m.content,
    })),
  ]
  return renderMemorySection(applyTokenBudget(ordered))
},
```

Then in `getContextForIdentifier`, replace the inline memory block (lines ~210–233) with a single call:

```ts
// Before (delete this):
//   const [taskMemories, projectMemories] = await Promise.all([...])
//   const ordered: RenderableMemory[] = [...]
//   const budgeted = applyTokenBudget(ordered)
//   const memorySection = renderMemorySection(budgeted)

// After:
const memorySection = await taskContextService.buildMemorySectionForTask(full.id)
```

- [ ] **Step 2: Run new test, expect PASS**

Run: `npx jest __tests__/lib/services/task-context-build-memory.test.ts`
Expected: all 3 tests pass.

- [ ] **Step 3: Run existing task-context tests to confirm refactor didn't break anything**

Run: `npx jest __tests__/lib/services/task-context`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add lib/services/task-context.service.ts
git commit -m "refactor: extract buildMemorySectionForTask helper [LUM-64]"
```

---

## Phase 2 — Inject memory at SessionStart hook

Goal: when a session starts and is already bound to a task, the server returns `memorySection` in the hook response; the CLI hook-runner emits Claude Code's `hookSpecificOutput.additionalContext` JSON on stdout so the agent sees memory in the session's system context.

### Task 2.1: Failing test for SessionStart hook response shape

**Files:**
- Create: `__tests__/api/hooks/session-start-memory-injection.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/api/hooks/session-start-memory-injection.test.ts
import { POST } from '@/app/api/hooks/session-start/route'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { taskContextService } from '@/lib/services/task-context.service'

jest.mock('@/lib/repositories/session.repository')
jest.mock('@/lib/services/task-context.service')

// Re-use the test helper that builds a hook request with a valid signature; if
// the repo has __tests__/helpers/hook-request.ts use it. If not, this test file
// is allowed to inline the request setup.
import { buildHookRequest } from '@/__tests__/helpers/hook-request'

describe('POST /api/hooks/session-start — memory injection', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('returns memorySection when session has a bound task', async () => {
    ;(sessionRepository.findTaskBinding as jest.Mock).mockResolvedValue({
      bound: true,
      taskId: 'task-1',
      taskIdentifier: 'LUM-42',
      taskTitle: 'Test task',
    })
    ;(taskContextService.buildMemorySectionForTask as jest.Mock).mockResolvedValue(
      '## Relevant Memory\n\n### Traps\n- [task] **X** → Y\n'
    )

    const req = buildHookRequest('SESSION_START', { sessionId: 's-1' })
    const res = await POST(req)
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.memorySection).toBe(
      '## Relevant Memory\n\n### Traps\n- [task] **X** → Y\n'
    )
    expect(taskContextService.buildMemorySectionForTask).toHaveBeenCalledWith(
      'task-1'
    )
  })

  it('returns memorySection="" when session is unbound', async () => {
    ;(sessionRepository.findTaskBinding as jest.Mock).mockResolvedValue({
      bound: false,
    })

    const req = buildHookRequest('SESSION_START', { sessionId: 's-2' })
    const res = await POST(req)
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.memorySection).toBe('')
    expect(taskContextService.buildMemorySectionForTask).not.toHaveBeenCalled()
  })

  it('returns memorySection="" when bound task has no memory', async () => {
    ;(sessionRepository.findTaskBinding as jest.Mock).mockResolvedValue({
      bound: true,
      taskId: 'task-1',
      taskIdentifier: 'LUM-42',
      taskTitle: 'Test task',
    })
    ;(taskContextService.buildMemorySectionForTask as jest.Mock).mockResolvedValue('')

    const req = buildHookRequest('SESSION_START', { sessionId: 's-3' })
    const res = await POST(req)
    const body = await res.json()

    expect(body.memorySection).toBe('')
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx jest __tests__/api/hooks/session-start-memory-injection.test.ts`
Expected: FAIL — current route returns `{ ok, sessionId, taskBinding }` only, no `memorySection`.

(If `buildHookRequest` helper does not exist, search `__tests__/helpers/` for the actual helper name used by existing hook tests like `__tests__/api/hooks/*` and substitute — do NOT create a new helper.)

- [ ] **Step 3: Commit**

```bash
git add __tests__/api/hooks/session-start-memory-injection.test.ts
git commit -m "test: add failing spec for SessionStart memory injection [LUM-64]"
```

### Task 2.2: Implement memory injection in SessionStart hook route

**Files:**
- Modify: `app/api/hooks/session-start/route.ts`

- [ ] **Step 1: Update the route to render and return memorySection**

Replace the existing route body:

```ts
import { handleHookRequest } from '@/app/api/hooks/_handler'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { taskContextService } from '@/lib/services/task-context.service'

export async function POST(request: Request) {
  return handleHookRequest(request, 'SESSION_START', {
    afterRecord: async ctx => {
      if (!ctx.sessionId) return
      const binding = await sessionRepository.findTaskBinding(ctx.sessionId)
      let memorySection = ''
      if (binding && binding.bound === true && binding.taskId) {
        memorySection = await taskContextService.buildMemorySectionForTask(
          binding.taskId
        )
      }
      return {
        sessionId: ctx.sessionId,
        taskBinding: binding,
        memorySection,
      }
    },
  })
}
```

The response shape is now: `{ ok: true, sessionId, taskBinding, memorySection }` where `memorySection` is always a string (`""` when unbound or when the bound task has no memory). The CLI hook-runner is responsible for the `!== ''` check.

- [ ] **Step 2: Run the test from Task 2.1, expect PASS**

Run: `npx jest __tests__/api/hooks/session-start-memory-injection.test.ts`
Expected: all 3 tests green.

- [ ] **Step 3: Run wider session-start hook tests to confirm no regression**

Run: `npx jest __tests__/api/hooks/session-start`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add app/api/hooks/session-start/route.ts
git commit -m "feat: return memorySection in session-start hook response [LUM-64]"
```

### Task 2.3: Failing test for CLI hook-runner `hookSpecificOutput` emission

**Files:**
- Create: `__tests__/cli/hook-runner-additional-context.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/cli/hook-runner-additional-context.test.ts
//
// Tests the cli/src/lib/hook-runner.ts `formatSessionStartOutput` (or its
// equivalent emission point). The current code path writes a plain-text line
// for taskBinding; we are adding a SECOND stdout line emitting:
//   {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}
// whenever the server response contains a non-empty `memorySection`.

import { formatHookStdoutLines } from '@/cli/src/lib/hook-runner'

describe('hook-runner SessionStart stdout — additionalContext emission', () => {
  it('emits the plain-text bind line plus hookSpecificOutput JSON when memorySection present', () => {
    const responseBody = {
      ok: true,
      sessionId: 's-1',
      taskBinding: {
        bound: true,
        taskIdentifier: 'LUM-42',
        taskTitle: 'Test task',
      },
      memorySection: '## Relevant Memory\n\n### Traps\n- [task] **X** → Y\n',
    }

    const lines = formatHookStdoutLines('session-start', responseBody)

    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('LUM-42')
    expect(lines[0]).toContain('Test task')

    const parsed = JSON.parse(lines[1])
    expect(parsed).toEqual({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext:
          '## Relevant Memory\n\n### Traps\n- [task] **X** → Y\n',
      },
    })
  })

  it('emits only the plain-text bind line when memorySection missing', () => {
    const responseBody = {
      ok: true,
      sessionId: 's-1',
      taskBinding: {
        bound: true,
        taskIdentifier: 'LUM-42',
        taskTitle: 'Test task',
      },
    }

    const lines = formatHookStdoutLines('session-start', responseBody)

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('LUM-42')
  })

  it('emits only the plain-text unbound line when neither binding nor memory', () => {
    const responseBody = {
      ok: true,
      sessionId: 's-1',
      taskBinding: { bound: false },
    }

    const lines = formatHookStdoutLines('session-start', responseBody)

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('未绑定任务')
  })

  it('omits hookSpecificOutput when memorySection is empty string', () => {
    const responseBody = {
      ok: true,
      sessionId: 's-1',
      taskBinding: {
        bound: true,
        taskIdentifier: 'LUM-42',
        taskTitle: 'Test task',
      },
      memorySection: '',
    }

    const lines = formatHookStdoutLines('session-start', responseBody)

    expect(lines).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx jest __tests__/cli/hook-runner-additional-context.test.ts`
Expected: FAIL — `formatHookStdoutLines` is not exported (the current code calls `formatSessionStartOutput` inline; the test forces extracting a unified, returns-an-array function).

- [ ] **Step 3: Commit**

```bash
git add __tests__/cli/hook-runner-additional-context.test.ts
git commit -m "test: add failing spec for CLI additionalContext emission [LUM-64]"
```

### Task 2.4: Implement CLI hook-runner stdout emission

**Files:**
- Modify: `cli/src/lib/hook-runner.ts`

- [ ] **Step 1: Refactor stdout emission to `formatHookStdoutLines`**

Inside `cli/src/lib/hook-runner.ts`:

1. Replace `formatSessionStartOutput(responseBody)` (returns a single string) with `formatHookStdoutLines(path, responseBody)` which returns `string[]`. Export it.
2. The new function returns either:
   - `[bindLine]` when no memorySection or memorySection === ''
   - `[bindLine, hookSpecificOutputJSON]` when memorySection is a non-empty string

Implementation:

```ts
export function formatHookStdoutLines(
  path: string,
  responseBody: unknown
): string[] {
  if (path !== 'session-start') return []
  const body = responseBody as {
    sessionId?: string
    taskBinding?: { bound: boolean; taskIdentifier?: string; taskTitle?: string }
    memorySection?: string
  }
  const lines: string[] = []
  const sessionId = body.sessionId
  const tb = body.taskBinding
  if (tb && tb.bound === true) {
    lines.push(
      `[Lumo] session_id=${sessionId} | 当前任务: ${tb.taskIdentifier} - ${tb.taskTitle}`
    )
  } else if (tb && tb.bound === false) {
    lines.push(
      `[Lumo] session_id=${sessionId} | 当前未绑定任务。请告诉我你要处理的任务编号（如 LUM-42），或说"跳过"。`
    )
  }
  if (typeof body.memorySection === 'string' && body.memorySection !== '') {
    lines.push(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: body.memorySection,
        },
      })
    )
  }
  return lines
}
```

2. Update the call site (lines ~150–159 in the existing file) to use it:

```ts
} else if (path === 'session-start') {
  try {
    const responseBody = await res.json()
    for (const line of formatHookStdoutLines(path, responseBody)) {
      process.stdout.write(line + '\n')
    }
  } catch {
    // response body parse failure is non-fatal
  }
}
```

3. Delete the old `formatSessionStartOutput` function (lines ~83–98).

- [ ] **Step 2: Run the test from Task 2.3, expect PASS**

Run: `npx jest __tests__/cli/hook-runner-additional-context.test.ts`
Expected: all 4 tests green.

- [ ] **Step 3: Run wider CLI hook tests**

Run: `npx jest __tests__/cli/hook-runner`
Expected: all green. If any test imported `formatSessionStartOutput` (now deleted), update them to use `formatHookStdoutLines` and read the first array element.

- [ ] **Step 4: Commit**

```bash
git add cli/src/lib/hook-runner.ts __tests__/cli/
git commit -m "feat: emit hookSpecificOutput JSON when server returns memorySection [LUM-64]"
```

---

## Phase 3 — Inject memory at `session attach`

Goal: when the user runs `lumo session attach LUM-N`, the server returns `memorySection` in the bind response; the CLI prints it to stdout (where Claude Code reads it as Bash tool output).

### Task 3.1: Failing test for `bindSessionToTask` returning memorySection

**Files:**
- Create: `__tests__/api/sessions/bind-task-memory-injection.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/api/sessions/bind-task-memory-injection.test.ts
import { sessionService } from '@/lib/services/session.service'
import { taskContextService } from '@/lib/services/task-context.service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { taskService } from '@/lib/services/task.service'

jest.mock('@/lib/services/task-context.service')
jest.mock('@/lib/repositories/session.repository')
jest.mock('@/lib/services/task.service')

describe('sessionService.bindSessionToTask — memory injection', () => {
  const identity = {
    workspaceId: 'ws-1',
    userId: 'user-1',
    actor: 'user' as const,
  }

  beforeEach(() => {
    jest.resetAllMocks()
    ;(taskService.resolveIdentifier as jest.Mock).mockResolvedValue({
      id: 'task-1',
      identifier: 'LUM-42',
      title: 'Test task',
    })
    ;(sessionRepository.bindToTask as jest.Mock).mockResolvedValue({
      retaggedEventCount: 0,
    })
  })

  it('returns memorySection from buildMemorySectionForTask', async () => {
    ;(taskContextService.buildMemorySectionForTask as jest.Mock).mockResolvedValue(
      '## Relevant Memory\n\n### Traps\n- [task] **X** → Y\n'
    )

    const result = await sessionService.bindSessionToTask({
      identity,
      sessionId: 's-1',
      taskIdentifier: 'LUM-42',
    })

    expect(result.memorySection).toBe(
      '## Relevant Memory\n\n### Traps\n- [task] **X** → Y\n'
    )
    expect(taskContextService.buildMemorySectionForTask).toHaveBeenCalledWith(
      'task-1'
    )
  })

  it('returns empty string memorySection when task has no memory', async () => {
    ;(taskContextService.buildMemorySectionForTask as jest.Mock).mockResolvedValue('')

    const result = await sessionService.bindSessionToTask({
      identity,
      sessionId: 's-1',
      taskIdentifier: 'LUM-42',
    })

    expect(result.memorySection).toBe('')
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx jest __tests__/api/sessions/bind-task-memory-injection.test.ts`
Expected: FAIL — `result.memorySection is undefined` (the current service returns 4 fields, no memory).

- [ ] **Step 3: Commit**

```bash
git add __tests__/api/sessions/bind-task-memory-injection.test.ts
git commit -m "test: add failing spec for bind-task memory injection [LUM-64]"
```

### Task 3.2: Implement `memorySection` in `bindSessionToTask`

**Files:**
- Modify: `lib/services/session.service.ts`

- [ ] **Step 1: Extend the return type and call the helper**

In `lib/services/session.service.ts`, update `BindSessionToTaskResult` and the function body:

```ts
import { taskContextService } from '@/lib/services/task-context.service'

interface BindSessionToTaskResult {
  taskId: string
  taskIdentifier: string
  taskTitle: string
  retaggedEventCount: number
  memorySection: string
}

// Inside bindSessionToTask, after the existing bind logic finishes, before
// returning, call:
const memorySection = await taskContextService.buildMemorySectionForTask(
  resolved.id
)

return {
  taskId: resolved.id,
  taskIdentifier: resolved.identifier,
  taskTitle: resolved.title,
  retaggedEventCount,
  memorySection,
}
```

(`memorySection` is always a string — `""` when no memory.)

- [ ] **Step 2: Run test from Task 3.1, expect PASS**

Run: `npx jest __tests__/api/sessions/bind-task-memory-injection.test.ts`
Expected: both tests green.

- [ ] **Step 3: Run wider session-service tests**

Run: `npx jest __tests__/lib/services/session`
Expected: all green. The route handler at `app/api/sessions/[sessionId]/bind-task/route.ts` already does `return NextResponse.json(result)` — no route change needed.

- [ ] **Step 4: Commit**

```bash
git add lib/services/session.service.ts
git commit -m "feat: return memorySection from bindSessionToTask [LUM-64]"
```

### Task 3.3: Print `memorySection` in `session attach` CLI

**Files:**
- Modify: `cli/src/commands/session-attach.ts`

- [ ] **Step 1: Update `BindResponse` and the stdout output**

```ts
// In cli/src/commands/session-attach.ts:
interface BindResponse {
  taskId: string
  taskIdentifier: string
  taskTitle: string
  retaggedEventCount: number
  memorySection: string
}

// Replace the existing two console.log lines (currently lines ~89–96) with:
console.log(
  `Attached session ${sessionId} to ${result.taskIdentifier} "${result.taskTitle}"`
)
console.log(
  `Re-tagged ${result.retaggedEventCount} previously-untagged event${
    result.retaggedEventCount === 1 ? '' : 's'
  } in this session.`
)
if (result.memorySection !== '') {
  console.log('')
  console.log(result.memorySection)
}
```

(Empty memorySection prints nothing extra — per spec, no "no memory" placeholder.)

- [ ] **Step 2: Add CLI test asserting the new output**

Create `__tests__/cli/session-attach-memory-output.test.ts`:

```ts
import { runSessionAttach } from '@/cli/src/commands/session-attach'

global.fetch = jest.fn()

describe('lumo session attach — memorySection stdout', () => {
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.CLAUDE_CODE_SESSION_ID = 's-1'
  })

  it('prints memorySection on its own line when non-empty', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        taskId: 'task-1',
        taskIdentifier: 'LUM-42',
        taskTitle: 'T',
        retaggedEventCount: 0,
        memorySection: '## Relevant Memory\n\n- [task] X\n',
      }),
    })

    await runSessionAttach('LUM-42')

    const outputs = logSpy.mock.calls.map(c => String(c[0]))
    expect(outputs.some(o => o.includes('Attached session'))).toBe(true)
    expect(outputs.some(o => o.includes('## Relevant Memory'))).toBe(true)
  })

  it('does not print memory block when memorySection is empty', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        taskId: 'task-1',
        taskIdentifier: 'LUM-42',
        taskTitle: 'T',
        retaggedEventCount: 0,
        memorySection: '',
      }),
    })

    await runSessionAttach('LUM-42')

    const outputs = logSpy.mock.calls.map(c => String(c[0]))
    expect(outputs.some(o => o.includes('## Relevant Memory'))).toBe(false)
  })
})
```

(If `runSessionAttach` is not the actual exported name, open `cli/src/commands/session-attach.ts` and substitute. If the file uses a default exported function called via the CLI dispatcher, follow the existing pattern in other CLI-command tests under `__tests__/cli/`.)

- [ ] **Step 3: Run the test, expect PASS**

Run: `npx jest __tests__/cli/session-attach-memory-output.test.ts`
Expected: both tests green.

- [ ] **Step 4: Commit**

```bash
git add cli/src/commands/session-attach.ts __tests__/cli/session-attach-memory-output.test.ts
git commit -m "feat: print memorySection after session attach [LUM-64]"
```

---

## Phase 4 — Remove the LumoProposal pipeline

Goal: delete every line of code that references `LumoProposal`, `lumo-sync`, `LumoProposalStatus`, the GitHub-PR mirror flow, and the frontend banner/dialog. Run all tests after each deletion group to catch unintended imports.

### Task 4.1: Drop frontend `SyncLumoBanner` and its callers

**Files:**
- Delete: `app/workspace/[workspaceUrl]/components/AgentRunTimeline/SyncLumoBanner.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunTab.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TimelineTabs.tsx`
- Modify: `app/workspace/[workspaceUrl]/constants.ts`
- Modify: `app/workspace/[workspaceUrl]/types.ts`
- Modify: `lib/i18n/*.json` (grep for keys before editing — see Step 2)

- [ ] **Step 1: Delete the banner component file**

```bash
rm app/workspace/[workspaceUrl]/components/AgentRunTimeline/SyncLumoBanner.tsx
```

- [ ] **Step 2: Find i18n keys to remove**

```bash
grep -r "lumoSync\|syncLumo\|unsyncedMemoryCount" lib/i18n/
```

For every locale file matched (typically `lib/i18n/en.json`, `lib/i18n/zh-CN.json`, plus any other locales), remove the lumoSync-related keys. Per CLAUDE.md: update **every** locale file together, not just en/zh-CN.

- [ ] **Step 3: Remove banner import + usage from AgentRunTab**

In `app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunTab.tsx`:
- Delete line ~7: `import { SyncLumoBanner } from './SyncLumoBanner'`
- Delete line ~63 (the `<SyncLumoBanner ... />` JSX usage)

- [ ] **Step 4: Remove unsyncedMemoryCount consumption from TimelineTabs**

In `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TimelineTabs.tsx`:
- Delete line ~53: `const unsyncedMemoryCount = agentRuns.data?.unsyncedMemoryCount ?? 0`
- Delete the conditional render around line 100 and the message template at line 104 that reference it
- Delete line ~139: the `memoryCount` prop pass-through (its consumer SyncLumoBanner is gone)

- [ ] **Step 5: Remove constants.ts lumoSync messages**

In `app/workspace/[workspaceUrl]/constants.ts`, delete the `lumoSync: { ... }` object at line ~138.

- [ ] **Step 6: Remove `unsyncedMemoryCount: number` from types.ts**

In `app/workspace/[workspaceUrl]/types.ts`, delete the field at line ~553.

- [ ] **Step 7: Run frontend type check + Jest**

```bash
npx tsc --noEmit
npx jest app/workspace
```

Expected: no TypeScript errors; all frontend tests pass.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: remove SyncLumoBanner and unsyncedMemoryCount UI [LUM-64]"
```

### Task 4.2: Drop API routes

**Files:**
- Delete: `app/api/tasks/[id]/lumo-proposals/route.ts`
- Delete: `app/api/lumo-proposals/[proposalId]/dismiss/route.ts`
- Delete: `app/api/lumo-proposals/[proposalId]/sync/route.ts`
- Delete: `lib/api-client/lumo-sync.ts`

- [ ] **Step 1: Delete the four files**

```bash
rm app/api/tasks/[id]/lumo-proposals/route.ts
rm app/api/lumo-proposals/[proposalId]/dismiss/route.ts
rm app/api/lumo-proposals/[proposalId]/sync/route.ts
rm lib/api-client/lumo-sync.ts
```

- [ ] **Step 2: Delete now-empty directories if any**

```bash
rmdir app/api/lumo-proposals/[proposalId]/dismiss 2>/dev/null
rmdir app/api/lumo-proposals/[proposalId]/sync 2>/dev/null
rmdir app/api/lumo-proposals/[proposalId] 2>/dev/null
rmdir app/api/lumo-proposals 2>/dev/null
rmdir app/api/tasks/[id]/lumo-proposals 2>/dev/null
```

- [ ] **Step 3: Delete corresponding API tests**

```bash
rm __tests__/api-lumo-proposals.test.ts
rm __tests__/api-lumo-sync.test.ts
```

- [ ] **Step 4: Run tsc and Jest**

```bash
npx tsc --noEmit
npx jest
```

Expected: no TS errors; only the failures from services that still reference `lumoProposalRepository` (handled in next task). If failures are elsewhere, stop and investigate.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove lumo-proposals API routes and api-client [LUM-64]"
```

### Task 4.3: Drop services, repository, LLM client, validation schema

**Files:**
- Delete: `lib/services/lumo-proposal/` (whole directory)
- Delete: `lib/services/lumo-sync/` (whole directory)
- Delete: `lib/repositories/lumo-proposal.repository.ts`
- Delete: `lib/llm/lumo-proposal-client.ts`
- Delete: `lib/validation/lumo-proposal.schema.ts`
- Delete: `scripts/test-lumo-proposal.ts`, `scripts/test-lumo-apply.ts`
- Modify: `lib/services/agent-run-timeline.service.ts` — drop `lumoProposalRepository` import + `unsyncedMemoryCount` calculation
- Delete: `__tests__/lumo-proposal-client.test.ts`, `__tests__/lumo-proposal.service.test.ts`, `__tests__/lumo-proposal.repository.test.ts`, `__tests__/lumo-sync.service.test.ts`, `__tests__/lumo-md-writer.test.ts`, `__tests__/lumo-onboarding.service.test.ts`

- [ ] **Step 1: Delete the directories and standalone files**

```bash
rm -rf lib/services/lumo-proposal/
rm -rf lib/services/lumo-sync/
rm lib/repositories/lumo-proposal.repository.ts
rm lib/llm/lumo-proposal-client.ts
rm lib/validation/lumo-proposal.schema.ts
rm scripts/test-lumo-proposal.ts
rm scripts/test-lumo-apply.ts
rm __tests__/lumo-proposal-client.test.ts
rm __tests__/lumo-proposal.service.test.ts
rm __tests__/lumo-proposal.repository.test.ts
rm __tests__/lumo-sync.service.test.ts
rm __tests__/lumo-md-writer.test.ts
rm __tests__/lumo-onboarding.service.test.ts
```

- [ ] **Step 2: Edit `agent-run-timeline.service.ts`**

In `lib/services/agent-run-timeline.service.ts`:

1. Remove line 4: `import { lumoProposalRepository } from '@/lib/repositories/lumo-proposal.repository'`
2. Remove `unsyncedMemoryCount: number` from the `AgentRunTimelineResult` interface (line 46)
3. Remove the call `await lumoProposalRepository.findLatestAppliedForTask(taskId)` at line 65 (and any local variable assigned from it)
4. Remove the filter/computation block at lines 166–169 that produces `unsyncedMemoryCount`
5. Remove `unsyncedMemoryCount` from the returned object

- [ ] **Step 3: Run tsc and Jest**

```bash
npx tsc --noEmit
npx jest
```

Expected: no TS errors. Any test still importing a deleted module must be deleted too — search:

```bash
grep -rln "lumo-proposal\|lumo-sync\|LumoProposal\|lumoProposalRepository\|lumoSyncService\|lumoProposalService" --include="*.ts" --include="*.tsx"
```

For each remaining hit (excluding `prisma/schema.prisma` which we handle next, and the worktree's `.worktrees/`/`docs/` if any), delete the file or remove the offending lines.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove lumo-proposal/lumo-sync services and tests [LUM-64]"
```

### Task 4.4: Drop Prisma model + enum + reverse relations; write migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_drop_lumo_proposal/migration.sql`

- [ ] **Step 1: Edit schema.prisma**

In `prisma/schema.prisma`:
1. Delete the line `lumoProposals LumoProposal[]` from the `Task` model (around line 358)
2. Delete the line `lumoProposals LumoProposal[]` from the `Member` model (around line 430)
3. Delete the entire `enum LumoProposalStatus { PENDING APPLIED DISMISSED }` block (around line 1296)
4. Delete the entire `model LumoProposal { ... }` block (lines ~1303–1320)

- [ ] **Step 2: Generate migration**

```bash
npx prisma migrate dev --name drop_lumo_proposal --create-only
```

This generates `prisma/migrations/<timestamp>_drop_lumo_proposal/migration.sql`. Open it and verify it contains:

```sql
DROP TABLE "LumoProposal";
DROP TYPE "LumoProposalStatus";
```

If migration generation hits checksum drift (P3008/P3012), follow CLAUDE.md's "Database Migrations / Dev" workaround — hand-write the SQL into the migration file, then:

```bash
npx prisma db execute --file prisma/migrations/<timestamp>_drop_lumo_proposal/migration.sql
npx prisma migrate resolve --applied <timestamp>_drop_lumo_proposal
```

- [ ] **Step 3: Apply migration locally**

```bash
npx prisma migrate dev
npx prisma generate
```

- [ ] **Step 4: Run full test suite**

```bash
npx tsc --noEmit
npx jest
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "chore: drop LumoProposal table and enum [LUM-64]"
```

---

## Phase 5 — Remove local LUMO.md and `@import`

### Task 5.1: Delete LUMO.md and the @import line in CLAUDE.md

**Files:**
- Delete: `LUMO.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Delete the file**

```bash
rm LUMO.md
```

- [ ] **Step 2: Remove `@import LUMO.md` from CLAUDE.md**

The directive appears at the end of CLAUDE.md (line ~132). Remove the entire line.

If the line is on a trailing position with no surrounding context, just delete that one line. If it follows a section header without other content, also remove any trailing whitespace.

- [ ] **Step 3: Run tsc + Jest one more time**

```bash
npx tsc --noEmit
npx jest
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add LUMO.md CLAUDE.md
git commit -m "chore: remove LUMO.md and @import directive [LUM-64]"
```

---

## Phase 6 — Final verification

### Task 6.1: Full check

- [ ] **Step 1: TypeScript**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 2: Lint**

```bash
npm run lint 2>&1 | tail -20
```

Expected: clean (or only pre-existing warnings unrelated to this change).

- [ ] **Step 3: Full test suite**

```bash
npx jest
```

Expected: all green.

- [ ] **Step 4: Grep for any remaining references**

```bash
grep -rln "LumoProposal\|lumo-proposal\|lumo-sync\|lumoSyncService\|lumoProposalService\|lumoProposalRepository\|unsyncedMemoryCount\|@import LUMO.md\|LUMO\\.md" \
  --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" \
  . 2>/dev/null | grep -v "^./docs/superpowers/" | grep -v "^./node_modules/" | grep -v "^./.worktrees/"
```

Expected: zero hits outside docs/. Any hit in `lib/`, `app/`, `cli/`, `prisma/`, `__tests__/`, `scripts/`, or `CLAUDE.md` is a leak that must be fixed before opening the PR.

- [ ] **Step 5: Sanity-check the new injection paths against a real session**

Note: this step is for the executing agent / user to verify behavior, not an automated test.

1. Start a fresh `claude code` session in this worktree.
2. Run `lumo session attach LUM-64`. Confirm the CLI prints "Attached ..." and (if LUM-64 has any memory yet) prints the memory markdown below it.
3. Quit and restart `claude code`. Confirm the SessionStart hook stdout contains a line like `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}` (visible in `~/.lumo/hook.log` if log level high enough, or by adding a temporary `echo` in the hook script).
4. In the conversation, ask Claude what memory it has loaded — it should reference the LUM-64 memory section.

If the conversation does not show the memory, check `~/.lumo/hook.log` for emission errors and verify the JSON shape matches Claude Code's documented format (`hookSpecificOutput.hookEventName` must be exactly `"SessionStart"`).

- [ ] **Step 6: Final commit if any fix-up needed**

```bash
git status
# If clean, skip. Otherwise:
git add -A
git commit -m "chore: post-verification fixups [LUM-64]"
```

### Task 6.2: Open PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin lumo/LUM-64-server-side-memory-injection
```

- [ ] **Step 2: Open PR with required notes**

```bash
gh pr create --title "feat: server-side memory injection (retire LUMO.md) [LUM-64]" --body "$(cat <<'EOF'
## Summary
- Memory now reaches the agent via SessionStart hook `additionalContext` (cold-start) and `lumo session attach` stdout (bind-time)
- `LUMO.md`, the `@import LUMO.md` line in CLAUDE.md, and the entire LumoProposal/lumo-sync GitHub-PR pipeline are removed
- `Memory` table remains the sole source of truth; no data migration

## Deploy notes
- **Requires `prisma migrate deploy` on next deploy.** The migration drops the `LumoProposal` table and `LumoProposalStatus` enum. Drop is destructive — proposal history is not preserved. Verify the migration applied on prod after deploy.

## Test plan
- [ ] CI green (tsc + Jest)
- [ ] After deploy: confirm `prisma migrate status` shows the drop applied on prod
- [ ] After deploy: open a Claude Code session bound to any task with ≥1 Memory row; confirm `additionalContext` reaches the system prompt
- [ ] After deploy: run `lumo session attach <task>` on a task with memory; confirm memorySection prints to stdout
- [ ] After deploy: confirm the task-detail Timeline tab no longer shows the "unsynced memory" banner

Spec: docs/superpowers/specs/2026-05-22-server-side-memory-injection-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Verify PR URL printed**

The `gh pr create` output ends with the PR URL — copy it to whichever tracking surface is in use.

---

## Self-review checklist (post-write)

This was checked against the spec after writing; no gaps found. If a future executor finds drift, fix inline and continue.

- ✓ Every spec section maps to a phase:
  - "Architecture / two-channel injection" → Phase 2 (hook) + Phase 3 (attach)
  - "Removed surface" → Phase 4 (services/routes/UI/Prisma) + Phase 5 (LUMO.md + @import)
  - "Renderer contract" → Phase 1 (extraction of `buildMemorySectionForTask`)
  - "Data migration / drop table" → Task 4.4
  - "Behavior contract (what agents see)" — encoded as test expectations across Phases 1–3
- ✓ TDD discipline: every new behavior has a failing test BEFORE implementation
- ✓ Frequent commits: every task ends with a commit
- ✓ All file paths absolute within the worktree; no placeholders
- ✓ Function signatures consistent: `buildMemorySectionForTask(taskId): Promise<string>` matches across Phase 1, 2, and 3
- ✓ CLAUDE.md compliance: layered architecture (helper in service, route stays thin); locale files updated together (Task 4.1 Step 2); migration via `prisma migrate dev` then deploy on prod

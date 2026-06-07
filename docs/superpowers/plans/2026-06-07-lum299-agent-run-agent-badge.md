# Per-run agent badge on the "Agent 运行" tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show which coding agent (Claude Code / Codex / Cursor / Gemini CLI / GitHub Copilot / Windsurf) produced each run on the task detail page's "Agent 运行" tab, as an icon+label badge.

**Architecture:** The tab renders one card per `Session` (not `AgentRun`). `Session.agent` already exists in the DB. This is pure pass-through + reuse: select the field in the repo, thread it through the timeline service's `AgentRunSession` wire-type and the frontend type, then render the existing `<AgentBadge>` component in the run header row. The orphan/"Unlinked" bucket (events with no linked session) falls back to `CLAUDE_CODE`. No schema change, no migration, no new i18n keys.

**Tech Stack:** TypeScript (strict), Next.js App Router, Prisma, Jest, react-intl, `@lobehub/icons` (via existing `AgentBadge`).

**Worktree:** `.worktrees/LUM-299-agent-badge` (branch `lumo/LUM-299-agent-badge`, off origin/main). Run all `git`, `jest`, `tsc` commands **from inside the worktree** (cd in first — the `cli/` haste collision silently runs the wrong tests otherwise). The generated Prisma client is shared via the `node_modules` symlink; this plan changes **no** schema, so **do not run `prisma generate`**.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `lib/repositories/session.repository.ts` | Prisma access for sessions | Add `agent: true` to `listForTask`'s `select` |
| `lib/services/agent-run-timeline.service.ts` | Build the run timeline wire-format | Add `agent` to `AgentRunSession`; populate from session; `CLAUDE_CODE` for orphan bucket |
| `app/workspace/[workspaceUrl]/types.ts` | Client copy of the wire-format | Add matching `agent` field to `AgentRunSession` |
| `app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunCard.tsx` | Render one run row | Render `<AgentBadge agent={run.agent} />` after the `Run #N` pill |
| `__tests__/lib/services/agent-run-timeline.service.test.ts` | Unit test (new) | Assert agent pass-through + orphan fallback |

There are two intentionally-separate `AgentRunSession` declarations (server wire-type in the service file, client copy in `types.ts`). **Both** must gain the `agent` field to stay in sync.

---

## Task 1: Select `agent` in the session repository

**Files:**
- Modify: `lib/repositories/session.repository.ts` (the `listForTask` method, around lines 345-360)

This is an additive `select` field. It has no consumer yet, so it is safe and tsc-neutral on its own; Task 2 depends on it (the service's `s.agent` access only type-checks once this field is selected, because Prisma's `select` narrows the return type).

- [ ] **Step 1: Add `agent: true` to the select**

In `lib/repositories/session.repository.ts`, the `listForTask` method currently reads:

```ts
  async listForTask(taskId: string, limit = 20) {
    return prisma.session.findMany({
      where: { taskId },
      orderBy: { lastActivityAt: 'desc' },
      take: limit,
      select: {
        id: true,
        startedAt: true,
        lastActivityAt: true,
        eventCount: true,
        summary: true,
        summaryType: true,
        summaryGeneratedAt: true,
      },
    })
  },
```

Add `agent: true` to the `select` (placed right after `id: true` to keep identity fields together):

```ts
  async listForTask(taskId: string, limit = 20) {
    return prisma.session.findMany({
      where: { taskId },
      orderBy: { lastActivityAt: 'desc' },
      take: limit,
      select: {
        id: true,
        agent: true,
        startedAt: true,
        lastActivityAt: true,
        eventCount: true,
        summary: true,
        summaryType: true,
        summaryGeneratedAt: true,
      },
    })
  },
```

- [ ] **Step 2: Verify existing repo tests still pass**

Run (from inside the worktree):

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-299-agent-badge
npx jest __tests__/lib/repositories/session.repository.test.ts
```

Expected: PASS (no test asserts `listForTask`'s exact select shape, so adding a field does not break anything).

- [ ] **Step 3: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-299-agent-badge add lib/repositories/session.repository.ts
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-299-agent-badge commit -m "feat: select Session.agent in listForTask [LUM-299]"
```

---

## Task 2: Thread `agent` through the timeline service + types (TDD)

**Files:**
- Create: `__tests__/lib/services/agent-run-timeline.service.test.ts`
- Modify: `lib/services/agent-run-timeline.service.ts` (interface ~line 36-46; session map ~line 108-132; orphan bucket ~line 142-158)
- Modify: `app/workspace/[workspaceUrl]/types.ts` (the `AgentRunSession` interface, lines 571-581)

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/services/agent-run-timeline.service.test.ts` with exactly this content. It mocks the three repositories the service reads and asserts the agent is passed through for a linked session and defaults to `CLAUDE_CODE` for the orphan bucket:

```ts
/**
 * @jest-environment node
 */

jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    listForTask: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: {
    findByTaskId: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findByTaskIdWithSession: jest.fn(),
  },
}))

import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { agentRunTimelineService } from '@/lib/services/agent-run-timeline.service'

const mockListSessions = sessionRepository.listForTask as jest.Mock
const mockFindEvents = hookEventRepository.findByTaskId as jest.Mock
const mockFindMemories =
  memoryRepository.findByTaskIdWithSession as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('agentRunTimelineService.getTimeline — agent identity', () => {
  it('passes the session agent through, and defaults the orphan bucket to CLAUDE_CODE', async () => {
    mockListSessions.mockResolvedValue([
      {
        id: 's1',
        agent: 'CODEX',
        startedAt: new Date('2026-01-01T10:00:00Z'),
        lastActivityAt: new Date('2026-01-01T10:30:00Z'),
        eventCount: 1,
        summary: null,
        summaryType: null,
        summaryGeneratedAt: null,
      },
    ])
    mockFindEvents.mockResolvedValue([
      // linked to s1 -> keeps the s1 run (toolCallCount > 0)
      {
        id: 'e1',
        sessionId: 's1',
        type: 'PRE_TOOL_USE',
        toolName: 'Bash',
        payload: {},
        turnSummary: null,
        createdAt: new Date('2026-01-01T10:05:00Z'),
      },
      // sessionId never matches a Session row -> orphan bucket, survives filter
      {
        id: 'e2',
        sessionId: 'no-such-session',
        type: 'PRE_TOOL_USE',
        toolName: 'Read',
        payload: {},
        turnSummary: null,
        createdAt: new Date('2026-01-01T09:00:00Z'),
      },
    ])
    mockFindMemories.mockResolvedValue([])

    const { runs } = await agentRunTimelineService.getTimeline('task-1')

    const linked = runs.find(r => r.sessionId === 's1')
    expect(linked).toBeDefined()
    expect(linked!.agent).toBe('CODEX')

    const orphan = runs.find(r => r.sessionId === null)
    expect(orphan).toBeDefined()
    expect(orphan!.agent).toBe('CLAUDE_CODE')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-299-agent-badge
npx jest __tests__/lib/services/agent-run-timeline.service.test.ts
```

Expected: FAIL — `linked.agent` is `undefined` (the service does not yet copy `agent`), so `expect(...).toBe('CODEX')` fails.

- [ ] **Step 3: Add `agent` to the service wire-type and both build sites**

In `lib/services/agent-run-timeline.service.ts`:

(a) Add `agent` to the `AgentRunSession` interface (it currently lacks it). `TaskArtifactAgent` is already imported at the top of the file:

```ts
export interface AgentRunSession {
  sessionId: string | null
  agent: TaskArtifactAgent
  runNumber: number
  startedAt: string
  lastActivityAt: string
  durationMs: number
  toolCallCount: number
  eventCount: number
  memoryCount: number
  items: AgentRunItem[]
}
```

(b) In the linked-session map (the `orderedSessions.map(...)` return object), add `agent: s.agent` next to `sessionId`:

```ts
      return {
        sessionId: s.id,
        agent: s.agent,
        runNumber: i + 1,
        startedAt: s.startedAt.toISOString(),
        lastActivityAt: s.lastActivityAt.toISOString(),
        durationMs: Math.max(
          0,
          s.lastActivityAt.getTime() - s.startedAt.getTime()
        ),
        toolCallCount,
        eventCount: sessionEvents.length,
        memoryCount: sessionMemories.length,
        items,
      }
```

(c) In the orphan bucket (the `runs.push({ sessionId: null, ... })` call), add `agent: 'CLAUDE_CODE'` — the orphan bucket has no Session row, and `CLAUDE_CODE` is the accurate default today since only Claude Code emits hooks:

```ts
      runs.push({
        sessionId: null,
        agent: 'CLAUDE_CODE',
        runNumber: runs.length + 1,
        startedAt: first,
        lastActivityAt: last,
        durationMs: new Date(last).getTime() - new Date(first).getTime(),
        toolCallCount: orphanEvents.filter(e => e.type === 'PRE_TOOL_USE')
          .length,
        eventCount: orphanEvents.length,
        memoryCount: orphanMemories.length,
        items,
      })
```

- [ ] **Step 4: Mirror the field in the frontend type**

In `app/workspace/[workspaceUrl]/types.ts`, the `AgentRunSession` interface (lines 571-581) must match the service's wire-type. `TaskArtifactAgent` is already imported at line 1 of this file. Add the `agent` field:

```ts
export interface AgentRunSession {
  sessionId: string | null
  agent: TaskArtifactAgent
  runNumber: number
  startedAt: string
  lastActivityAt: string
  durationMs: number
  toolCallCount: number
  eventCount: number
  memoryCount: number
  items: AgentRunItem[]
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-299-agent-badge
npx jest __tests__/lib/services/agent-run-timeline.service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Type-check (this is where the repo `select` from Task 1 is verified)**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-299-agent-badge
npx tsc --noEmit
```

Expected: PASS. If you see `Property 'agent' does not exist on type ...` at the `agent: s.agent` line, Task 1's `select` change is missing — go back and add `agent: true` to `listForTask`.

- [ ] **Step 7: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-299-agent-badge add lib/services/agent-run-timeline.service.ts "app/workspace/[workspaceUrl]/types.ts" __tests__/lib/services/agent-run-timeline.service.test.ts
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-299-agent-badge commit -m "feat: pass agent through agent-run timeline service [LUM-299]"
```

---

## Task 3: Render the badge in the run header row

**Files:**
- Modify: `app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunCard.tsx`

The existing `AgentBadge` component (`app/workspace/[workspaceUrl]/components/AgentBadge.tsx`) already renders the brand icon + localized label and has a `safeAgent` guard, so no new styling or i18n is needed. Per the spec's placement decision (Variant A), the badge goes immediately after the `Run #N` pill, before the start-time label.

No component unit test is added: per the spec, the component render is not load-bearing logic, and a jsdom test would require an `IntlProvider` + `@lobehub/icons` harness for no real assertion value. `tsc --noEmit` (Task 4) is the gate that the prop is wired correctly.

- [ ] **Step 1: Import `AgentBadge`**

In `AgentRunCard.tsx`, add the import next to the existing component imports (the file already imports `segmentIntoTurns` and `TurnCard` from sibling paths). `AgentBadge` lives one directory up from the `AgentRunTimeline/` folder:

```ts
import { AgentBadge } from '../AgentBadge'
```

- [ ] **Step 2: Render the badge after the `Run #N` pill**

The run header currently has, in order: chevron, the `Run #N` pill `<span>`, then the start-time `<span class="...">{startLabel}</span>`. Insert `<AgentBadge>` between the pill and the start label. The pill `<span>` ends with `</span>` right before the start-time span — add the badge there:

```tsx
        <span className='flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 text-xs font-semibold shrink-0'>
          <Bot className='size-3' />
          {intl.formatMessage(
            { id: 'agentRun.runNumber', defaultMessage: 'Run #{n}' },
            { n: run.runNumber }
          )}
        </span>
        <AgentBadge agent={run.agent} />
        <span className='text-xs text-muted-foreground shrink-0'>
          {startLabel}
        </span>
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-299-agent-badge
npx tsc --noEmit
```

Expected: PASS. (`run.agent` is now typed as `TaskArtifactAgent` from Task 2, which is exactly `AgentBadge`'s prop type.)

- [ ] **Step 4: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-299-agent-badge add "app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunCard.tsx"
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-299-agent-badge commit -m "feat: show agent badge on each run row [LUM-299]"
```

---

## Task 4: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full type-check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-299-agent-badge
npx tsc --noEmit
```

Expected: PASS (no errors).

- [ ] **Step 2: Run the new service test + the touched repo test**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-299-agent-badge
npx jest __tests__/lib/services/agent-run-timeline.service.test.ts __tests__/lib/repositories/session.repository.test.ts
```

Expected: PASS.

- [ ] **Step 3: Confirm no new i18n keys are required**

The `taskArtifact.agent.*` labels used by `AgentBadge` already exist across all 16 locales (the component ships today). Confirm nothing drifted:

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-299-agent-badge
npm run i18n:check
```

Expected: PASS / clean (no missing keys reported). If it reports drift, it is pre-existing and unrelated — do not add keys for this feature.

- [ ] **Step 4: Push and open PR**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-299-agent-badge push -u origin lumo/LUM-299-agent-badge
```

Then open a PR titled `feat: show producing agent badge on each Agent 运行 run [LUM-299]`. Body should note: no schema change / no migration / no new i18n keys; and the known limitation that every row reads `Claude Code` today until other CLIs report hooks.

---

## Self-Review

**Spec coverage:**
- Repo select (`agent: true`) → Task 1. ✔
- Service interface + populate + orphan `CLAUDE_CODE` fallback → Task 2 (Step 3). ✔
- Frontend type sync → Task 2 (Step 4). ✔
- Component renders `AgentBadge`, Variant A placement (after `Run #N` pill) → Task 3. ✔
- Service unit test (pass-through + orphan fallback) → Task 2 (Step 1). ✔
- "No new i18n keys" / "no schema / no migration" → Task 4 (Step 3) + PR body. ✔
- Known limitation (all `CLAUDE_CODE` today) → PR body (Task 4 Step 4). ✔

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✔

**Type consistency:** `agent: TaskArtifactAgent` is identical in both `AgentRunSession` declarations; orphan literal `'CLAUDE_CODE'` is a valid member of `TaskArtifactAgent`; `AgentBadge`'s prop is `agent: TaskArtifactAgent`, matching `run.agent`. ✔

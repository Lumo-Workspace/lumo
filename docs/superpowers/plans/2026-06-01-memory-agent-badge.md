# Memory agent badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sedimented memories display the producing agent's brand icon + name via the same `AgentBadge` component artifacts use, instead of the generic "由 Claude 沉淀" / "沉淀记忆" labels.

**Architecture:** Add a real `agent` column (reusing the existing `TaskArtifactAgent` enum) to the `Memory` model, default `CLAUDE_CODE` so existing rows backfill correctly. Plumb it through repository → service → API → api-client type and the agent-run timeline. The frontend renders the shared `AgentBadge` for auto-sedimented memories; human-created memories keep their "由 X 添加" text. The CLI `memory add` commands gain an optional `--agent`.

**Tech Stack:** Next.js 14 App Router, TypeScript (strict), Prisma + Neon Postgres, Zod, react-intl, Jest + jsdom, Commander-based CLI, @lobehub/icons.

---

## File Structure

- `prisma/schema.prisma` — add `agent` field to `Memory` (Task 1)
- `prisma/migrations/<ts>_add_memory_agent/migration.sql` — generated (Task 1)
- `lib/repositories/memory.repository.ts` — select + create input + timeline select (Task 2)
- `lib/services/memory-management.service.ts` — create inputs carry `agent` (Task 3)
- `lib/validation/memory.ts` — `agent` in create body schema (Task 4)
- `app/api/tasks/[id]/memories/route.ts`, `app/api/projects/[id]/memories/route.ts` — pass `agent` (Task 4)
- `lib/api-client/memories.ts` — `MemoryRow.agent` (Task 5)
- `lib/services/agent-run-timeline.service.ts` + `app/workspace/[workspaceUrl]/types.ts` — `AgentRunMemoryItem.agent` (Task 6)
- `app/workspace/[workspaceUrl]/components/AgentBadge.tsx` — unknown-agent fallback (Task 7)
- `app/workspace/[workspaceUrl]/components/memory/MemoryCard.tsx` — `item.agent` + default branch badge (Task 8)
- `app/workspace/[workspaceUrl]/components/memory/MemoryListItem.tsx` — auto → AgentBadge source (Task 9)
- `lib/i18n/*.json` (17 files) — remove `memory.source.auto` (Task 10)
- `cli/src/commands/memory-task-add.ts`, `cli/src/commands/memory-project-add.ts`, `cli/src/index.ts`, `.claude/skills/lumo/SKILL.md` — `--agent` flag + docs (Task 11)

---

## Task 1: Prisma — add `agent` to Memory

**Files:**

- Modify: `prisma/schema.prisma:1347-1369` (the `Memory` model)
- Create: `prisma/migrations/<timestamp>_add_memory_agent/migration.sql` (generated)

- [ ] **Step 1: Add the field to the Memory model**

In `prisma/schema.prisma`, inside `model Memory`, add the `agent` line right after `category`:

```prisma
model Memory {
  id                String         @id @default(cuid())
  workspaceId       String
  projectId         String
  taskId            String?
  scope             MemoryScope
  category          MemoryCategory
  agent             TaskArtifactAgent @default(CLAUDE_CODE)
  content           Json
  sourceSessionId   String?
  createdByMemberId String?
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt
```

The `TaskArtifactAgent` enum already exists at `prisma/schema.prisma:1437` — reuse it, do **not** declare a new enum.

- [ ] **Step 2: Generate the migration**

Run: `npx prisma migrate dev --name add_memory_agent`
Expected: a new folder `prisma/migrations/<timestamp>_add_memory_agent/migration.sql` whose body is exactly:

```sql
-- AlterTable
ALTER TABLE "memories" ADD COLUMN "agent" "TaskArtifactAgent" NOT NULL DEFAULT 'CLAUDE_CODE';
```

(No `CREATE TYPE` — the enum already exists.) If `migrate dev` fails with checksum drift (P3008/P3012) on a _previously-applied_ migration, use the hand-write-SQL workaround documented in CLAUDE.md (write the SQL above into the migration folder, `npx prisma db execute --file <path>`, `npx prisma migrate resolve --applied add_memory_agent`). **Never** `prisma migrate reset`.

- [ ] **Step 3: Regenerate the client**

Run: `npx prisma generate`
Expected: success. (This refreshes the generated `MemoryUncheckedCreateInput` etc. so later `tsc` sees `agent`.)

- [ ] **Step 4: Verify the schema compiles**

Run: `npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid 🚀"

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add agent column to Memory [LUM-136]"
```

---

## Task 2: Repository — select + create + timeline select

**Files:**

- Modify: `lib/repositories/memory.repository.ts`
- Test: `__tests__/memory.repository.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `__tests__/memory.repository.test.ts`. Mirror the existing mocking style in that file (it mocks `@/lib/db/prisma`). Add a test asserting `create` forwards `agent` and that `MEMORY_ROW_SELECT`-based reads request `agent`:

```ts
it('create() forwards an explicit agent', async () => {
  ;(prisma.memory.create as jest.Mock).mockResolvedValue({ id: 'm1' })
  await memoryRepository.create({
    workspaceId: 'w1',
    projectId: 'p1',
    taskId: 't1',
    scope: 'TASK',
    category: 'TRAP',
    content: { trigger: 'x', outcome: 'y' },
    sourceSessionId: null,
    createdByMemberId: null,
    agent: 'CODEX',
  })
  expect(prisma.memory.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ agent: 'CODEX' }),
    })
  )
})

it('create() omits agent when not provided (DB default applies)', async () => {
  ;(prisma.memory.create as jest.Mock).mockResolvedValue({ id: 'm2' })
  await memoryRepository.create({
    workspaceId: 'w1',
    projectId: 'p1',
    taskId: 't1',
    scope: 'TASK',
    category: 'TRAP',
    content: { trigger: 'x', outcome: 'y' },
    sourceSessionId: null,
    createdByMemberId: null,
  })
  const callArg = (prisma.memory.create as jest.Mock).mock.calls[0][0]
  expect(callArg.data).not.toHaveProperty('agent')
})

it('listForTask selects agent', async () => {
  ;(prisma.memory.findMany as jest.Mock).mockResolvedValue([])
  await memoryRepository.listForTask('t1')
  expect(prisma.memory.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      select: expect.objectContaining({ agent: true }),
    })
  )
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- memory.repository`
Expected: FAIL — `agent` not in select / not forwarded.

- [ ] **Step 3: Add `agent` to the select constant, create input, and create() + timeline select**

In `lib/repositories/memory.repository.ts`:

(a) Import the enum type — change line 2:

```ts
import type {
  MemoryCategory,
  MemoryScope,
  Prisma,
  TaskArtifactAgent,
} from '@prisma/client'
```

(b) Add `agent` to `MEMORY_ROW_SELECT` (after `category`):

```ts
const MEMORY_ROW_SELECT = {
  id: true,
  scope: true,
  category: true,
  agent: true,
  content: true,
  taskId: true,
  createdByMemberId: true,
  createdAt: true,
  updatedAt: true,
} as const
```

(c) Add optional `agent` to `CreateMemoryInput`:

```ts
interface CreateMemoryInput {
  workspaceId: string
  projectId: string
  taskId: string | null
  scope: MemoryScope
  category: MemoryCategory
  content: Prisma.InputJsonValue
  sourceSessionId: string | null
  createdByMemberId: string | null
  agent?: TaskArtifactAgent
}
```

(d) Forward `agent` in `create()` — spread it only when defined so the DB default still applies:

```ts
  async create(input: CreateMemoryInput, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.memory.create({
      data: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        taskId: input.taskId,
        scope: input.scope,
        category: input.category,
        content: input.content,
        sourceSessionId: input.sourceSessionId,
        createdByMemberId: input.createdByMemberId,
        ...(input.agent !== undefined ? { agent: input.agent } : {}),
      },
      select: { id: true },
    })
  },
```

(e) Add `agent: true` to the `findByTaskIdWithSession` select (the Agent Run timeline source), after `category: true`:

```ts
  async findByTaskIdWithSession(taskId: string) {
    return prisma.memory.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        category: true,
        agent: true,
        content: true,
        sourceSessionId: true,
        createdAt: true,
      },
    })
  },
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- memory.repository`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/memory.repository.ts __tests__/memory.repository.test.ts
git commit -m "feat: select + persist memory agent in repository [LUM-136]"
```

---

## Task 3: Service — create inputs carry `agent`

**Files:**

- Modify: `lib/services/memory-management.service.ts`
- Test: `__tests__/memory-management.service.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `__tests__/memory-management.service.test.ts` (it mocks `memoryRepository`). Assert the agent is passed through for both create paths:

```ts
it('createForTask forwards agent to the repository', () => {
  memoryManagementService.createForTask({
    taskId: 't1',
    projectId: 'p1',
    workspaceId: 'w1',
    category: 'TRAP',
    content: { trigger: 'x', outcome: 'y' },
    actorMemberId: 'mem1',
    agent: 'CURSOR',
  })
  expect(memoryRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({ agent: 'CURSOR' })
  )
})

it('createForProject without agent leaves it undefined (DB default applies)', () => {
  memoryManagementService.createForProject({
    projectId: 'p1',
    workspaceId: 'w1',
    category: 'TRAP',
    content: { trigger: 'x', outcome: 'y' },
    actorMemberId: 'mem1',
  })
  expect(memoryRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({ agent: undefined })
  )
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- memory-management.service`
Expected: FAIL — `agent` not on input type / not forwarded.

- [ ] **Step 3: Add optional `agent` to both inputs and forward it**

In `lib/services/memory-management.service.ts`:

(a) Import the enum type — change line 2:

```ts
import type { MemoryCategory, TaskArtifactAgent } from '@prisma/client'
```

(b) Add `agent?: TaskArtifactAgent` to both `CreateForProjectInput` and `CreateForTaskInput`:

```ts
interface CreateForProjectInput {
  projectId: string
  workspaceId: string
  category: MemoryCategory
  content: MemoryContent
  actorMemberId: string
  agent?: TaskArtifactAgent
}

interface CreateForTaskInput {
  taskId: string
  projectId: string
  workspaceId: string
  category: MemoryCategory
  content: MemoryContent
  actorMemberId: string
  agent?: TaskArtifactAgent
}
```

(c) Forward `agent` in both `createForProject` and `createForTask` repository calls — add `agent: input.agent,` next to `createdByMemberId`:

```ts
  createForProject(input: CreateForProjectInput) {
    return memoryRepository.create({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: null,
      scope: 'PROJECT',
      category: input.category,
      content: input.content as Prisma.InputJsonValue,
      sourceSessionId: null,
      createdByMemberId: input.actorMemberId,
      agent: input.agent,
    })
  },

  createForTask(input: CreateForTaskInput) {
    return memoryRepository.create({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: input.taskId,
      scope: 'TASK',
      category: input.category,
      content: input.content as Prisma.InputJsonValue,
      sourceSessionId: null,
      createdByMemberId: input.actorMemberId,
      agent: input.agent,
    })
  },
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- memory-management.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/memory-management.service.ts __tests__/memory-management.service.test.ts
git commit -m "feat: thread agent through memory management service [LUM-136]"
```

---

## Task 4: Validation + API routes — accept `agent`

**Files:**

- Modify: `lib/validation/memory.ts`
- Modify: `app/api/tasks/[id]/memories/route.ts:36-43`
- Modify: `app/api/projects/[id]/memories/route.ts:36-42`
- Test: `__tests__/api/memories-task-create.test.ts`, `__tests__/api/memories-project-create.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `__tests__/api/memories-task-create.test.ts` (follow its existing harness for mocking auth + service). Assert a valid agent reaches the service and an invalid one is rejected:

```ts
it('passes a valid agent through to the service', async () => {
  // ...arrange auth + task lookup mocks as the file already does...
  const res = await POST(
    makeReq({
      category: 'TRAP',
      content: { trigger: 'x', outcome: 'y' },
      agent: 'CODEX',
    }),
    ctx
  )
  expect(res.status).toBe(201)
  expect(memoryManagementService.createForTask).toHaveBeenCalledWith(
    expect.objectContaining({ agent: 'CODEX' })
  )
})

it('rejects an invalid agent with 400', async () => {
  const res = await POST(
    makeReq({
      category: 'TRAP',
      content: { trigger: 'x', outcome: 'y' },
      agent: 'not-an-agent',
    }),
    ctx
  )
  expect(res.status).toBe(400)
})
```

(Use the same `makeReq` / `ctx` helpers already present in the test file; if absent, mirror `memories-project-create.test.ts`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- memories-task-create`
Expected: FAIL — `agent` neither validated nor forwarded.

- [ ] **Step 3: Add `agent` to the create body schema**

In `lib/validation/memory.ts`, import the enum and add an optional `agent`:

```ts
import { z } from 'zod'
import { MemoryCategory, TaskArtifactAgent } from '@prisma/client'

export const createMemoryBodySchema = z.object({
  category: z.nativeEnum(MemoryCategory),
  content: z.unknown().refine(v => v !== undefined, { message: 'Required' }),
  agent: z.nativeEnum(TaskArtifactAgent).optional(),
})
```

- [ ] **Step 4: Forward `agent` from both routes to the service**

In `app/api/tasks/[id]/memories/route.ts`, add `agent` to the `createForTask` call:

```ts
const memory = await memoryManagementService.createForTask({
  taskId: id,
  projectId: task.projectId,
  workspaceId: identity.workspaceId,
  category: parsed.data.category,
  content,
  actorMemberId: identity.memberId,
  agent: parsed.data.agent,
})
```

In `app/api/projects/[id]/memories/route.ts`, add `agent` to the `createForProject` call:

```ts
const memory = await memoryManagementService.createForProject({
  projectId: id,
  workspaceId: identity.workspaceId,
  category: parsed.data.category,
  content,
  actorMemberId: identity.memberId,
  agent: parsed.data.agent,
})
```

- [ ] **Step 5: Run both tests to verify they pass**

Run: `npm test -- memories-task-create memories-project-create`
Expected: PASS. (Add the same two assertions to `memories-project-create.test.ts` adapted to `createForProject` before this step if not already.)

- [ ] **Step 6: Commit**

```bash
git add lib/validation/memory.ts app/api/tasks/[id]/memories/route.ts app/api/projects/[id]/memories/route.ts __tests__/api/memories-task-create.test.ts __tests__/api/memories-project-create.test.ts
git commit -m "feat: accept optional agent on memory create API [LUM-136]"
```

---

## Task 5: API client — `MemoryRow.agent`

**Files:**

- Modify: `lib/api-client/memories.ts`

- [ ] **Step 1: Add `agent` to the `MemoryRow` type**

In `lib/api-client/memories.ts`, change the import and the interface:

```ts
import { apiFetch } from './base'
import type {
  MemoryScope,
  MemoryCategory,
  TaskArtifactAgent,
} from '@prisma/client'

export interface MemoryRow {
  id: string
  scope: MemoryScope
  category: MemoryCategory
  agent: TaskArtifactAgent
  content: unknown
  taskId: string | null
  createdByMemberId: string | null
  createdAt: string
  updatedAt: string
}
```

(No behavior change — the field already flows through `apiFetch` JSON now that the repository select returns it. This just types it.)

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no new errors. (Existing consumers of `MemoryRow` don't break — `agent` is additive.)

- [ ] **Step 3: Commit**

```bash
git add lib/api-client/memories.ts
git commit -m "feat: expose agent on MemoryRow client type [LUM-136]"
```

---

## Task 6: Agent-run timeline — `AgentRunMemoryItem.agent`

**Files:**

- Modify: `lib/services/agent-run-timeline.service.ts:21-27,86-92`
- Modify: `app/workspace/[workspaceUrl]/types.ts:553-559`

- [ ] **Step 1: Add `agent` to the service interface and the mapping**

In `lib/services/agent-run-timeline.service.ts`:

(a) Ensure `TaskArtifactAgent` is imported (it imports `MemoryCategory` from `@prisma/client` already — add the enum to that import).

(b) Add `agent` to the `AgentRunMemoryItem` interface (after `category`):

```ts
export interface AgentRunMemoryItem {
  id: string
  kind: 'memory'
  category: MemoryCategory
  agent: TaskArtifactAgent
  content: unknown
  createdAt: string
}
```

(c) Add `agent: m.agent` to the push in the `memoriesBySession` loop:

```ts
list.push({
  id: m.id,
  kind: 'memory',
  category: m.category,
  agent: m.agent,
  content: m.content,
  createdAt: m.createdAt.toISOString(),
})
```

- [ ] **Step 2: Mirror the field on the frontend type**

In `app/workspace/[workspaceUrl]/types.ts`, add `agent` to `AgentRunMemoryItem` (line 553). Import `TaskArtifactAgent` from `@prisma/client` at the top of the file if not already imported:

```ts
export interface AgentRunMemoryItem {
  id: string
  kind: 'memory'
  category: AgentRunMemoryCategory
  agent: TaskArtifactAgent
  content: unknown
  createdAt: string
}
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add lib/services/agent-run-timeline.service.ts "app/workspace/[workspaceUrl]/types.ts"
git commit -m "feat: carry agent on agent-run timeline memory items [LUM-136]"
```

---

## Task 7: AgentBadge — unknown-agent fallback

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/AgentBadge.tsx`
- Test: `__tests__/components/AgentBadge.test.tsx`

This hardens the shared component so a missing/unknown agent (deploy race before the column exists, or dirty data) renders as Claude Code instead of crashing on `AGENT_META[undefined]`.

- [ ] **Step 1: Write the failing test**

Add to `__tests__/components/AgentBadge.test.tsx` (renders inside an `IntlProvider` like the others):

```ts
it('falls back to Claude Code for an unknown agent value', () => {
  // @ts-expect-error — intentionally passing a value outside the enum
  render(<IntlWrap><AgentBadge agent={'BOGUS'} /></IntlWrap>)
  expect(screen.getByText('Claude Code')).toBeInTheDocument()
})
```

(Use the same `IntlWrap`/render helper the file already defines.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- AgentBadge`
Expected: FAIL — throws or renders an empty/`taskArtifact.agent.BOGUS` label.

- [ ] **Step 3: Normalize the agent inside the shared component**

In `app/workspace/[workspaceUrl]/components/AgentBadge.tsx`, add a guard helper and use it in both `useAgentLabel` and the two render functions:

```ts
/** Coerce any value to a known agent, defaulting to Claude Code. Guards
 *  against deploy-race rows read before the column exists and dirty data. */
function safeAgent(agent: TaskArtifactAgent): TaskArtifactAgent {
  return agent in AGENT_META ? agent : TaskArtifactAgent.CLAUDE_CODE
}

export function useAgentLabel(agent: TaskArtifactAgent): string {
  const intl = useIntl()
  return intl.formatMessage({ id: `taskArtifact.agent.${safeAgent(agent)}` })
}

export function AgentBadge({ agent }: { agent: TaskArtifactAgent }) {
  const a = safeAgent(agent)
  const { Icon, color } = AGENT_META[a]
  const label = useAgentLabel(a)
  // ...unchanged JSX...
}

export function AgentAvatar({ agent }: { agent: TaskArtifactAgent }) {
  const { Icon, color } = AGENT_META[safeAgent(agent)]
  // ...unchanged JSX...
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- AgentBadge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/AgentBadge.tsx" "__tests__/components/AgentBadge.test.tsx"
git commit -m "feat: AgentBadge falls back to Claude Code for unknown agent [LUM-136]"
```

---

## Task 8: MemoryCard — render agent badge in the default branch

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/memory/MemoryCard.tsx`
- Test: `__tests__/components/MemoryTab.test.tsx` (covers MemoryCard via the tab) — add a focused MemoryCard render if a dedicated file is cleaner; the existing `MemoryTab.test.tsx` already renders cards.

This replaces the `Sparkles` + "沉淀记忆" default-branch label with `<AgentBadge>`, covering the Agent Run timeline (`InlineMemoryCard`) path.

- [ ] **Step 1: Write the failing test**

Add a test that renders `MemoryCard` with no `source` and `showSedimentedLabel` defaulting true, asserting the agent name shows and the old sparkles label does not. Create `__tests__/components/MemoryCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import en from '@/lib/i18n/en.json'
import { MemoryCard } from '@/app/workspace/[workspaceUrl]/components/memory/MemoryCard'

function wrap(node: React.ReactNode) {
  return (
    <IntlProvider locale='en' messages={en}>
      {node}
    </IntlProvider>
  )
}

it('renders the agent badge in the default (sedimented) branch', () => {
  render(
    wrap(
      <MemoryCard
        item={{
          id: 'm1',
          category: 'TRAP',
          agent: 'CLAUDE_CODE',
          content: { trigger: 't', outcome: 'o' },
        }}
      />
    )
  )
  expect(screen.getByText('Claude Code')).toBeInTheDocument()
  expect(screen.queryByText('沉淀记忆')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- MemoryCard`
Expected: FAIL — `item.agent` not a valid prop (type) / badge not rendered.

- [ ] **Step 3: Add `agent` to `MemoryCardItem` and swap the default branch**

In `app/workspace/[workspaceUrl]/components/memory/MemoryCard.tsx`:

(a) Add imports at the top:

```ts
import type { MemoryCategory, TaskArtifactAgent } from '@prisma/client'
import { AgentBadge } from '../AgentBadge'
```

Remove the now-unused `Sparkles` import (`import { Sparkles } from 'lucide-react'`).

(b) Add `agent` to `MemoryCardItem`:

```ts
interface MemoryCardItem {
  id: string
  category: MemoryCategory
  agent: TaskArtifactAgent
  content: unknown
}
```

(c) Replace the `showSedimentedLabel` branch (current lines 102-110) so it renders the badge instead of sparkles + "沉淀记忆":

```tsx
{
  source ? (
    <span className='shrink-0 transition-opacity group-hover:opacity-0'>
      {source}
    </span>
  ) : showSedimentedLabel ? (
    <span className='shrink-0'>
      <AgentBadge agent={item.agent} />
    </span>
  ) : null
}
```

Note: the `source` wrapper drops its `text-[10px] text-zinc-400` typography so an `<AgentBadge>` passed as `source` (Task 9) keeps its own styling; a plain string source (the "由 X 添加" case) still inherits the card's text size, which is fine. Keep the `group-hover:opacity-0` so the hover action menu can take the corner.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- MemoryCard`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/memory/MemoryCard.tsx" "__tests__/components/MemoryCard.test.tsx"
git commit -m "feat: MemoryCard renders agent badge instead of sedimented label [LUM-136]"
```

---

## Task 9: MemoryListItem — auto memories show the agent badge

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/memory/MemoryListItem.tsx`
- Test: `__tests__/components/MemoryListItem.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `__tests__/components/MemoryListItem.test.tsx`:

```tsx
it('shows the agent badge for an auto-sedimented memory', () => {
  renderItem({ createdByMemberId: null, agent: 'CLAUDE_CODE' })
  expect(screen.getByText('Claude Code')).toBeInTheDocument()
  expect(screen.queryByText('由 Claude 沉淀')).not.toBeInTheDocument()
})

it('shows "由 X 添加" for a human-created memory', () => {
  renderItem(
    { createdByMemberId: 'mem1', agent: 'CLAUDE_CODE' },
    { memberName: 'Alice' }
  )
  expect(screen.getByText('由 Alice 添加')).toBeInTheDocument()
})
```

(Adapt `renderItem` to the file's existing helper — it builds a `MemoryRow` and renders `<MemoryListItem>` in an `IntlProvider` with `zh-CN` messages. Ensure the built row includes `agent`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- MemoryListItem`
Expected: FAIL — auto branch still renders "由 Claude 沉淀" string.

- [ ] **Step 3: Render `<AgentBadge>` for auto memories**

In `app/workspace/[workspaceUrl]/components/memory/MemoryListItem.tsx`:

(a) Add the import:

```ts
import { AgentBadge } from '../AgentBadge'
```

(b) Replace the `source` computation (current lines 47-52) and the `MemoryCard` item construction (lines 56-64):

```tsx
  const source = memory.createdByMemberId
    ? intl.formatMessage(
        { id: 'memory.source.byMember' },
        { name: memberName ?? '—' }
      )
    : undefined

  return (
    <div className='relative group'>
      <MemoryCard
        item={{
          id: memory.id,
          category: memory.category,
          agent: memory.agent,
          content: memory.content,
        }}
        source={
          source ?? <AgentBadge agent={memory.agent} />
        }
        showSedimentedLabel={false}
      />
```

Both branches now flow through the `source` slot (which fades on hover for the action menu): human → the localized string, auto → the badge.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- MemoryListItem`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/memory/MemoryListItem.tsx" "__tests__/components/MemoryListItem.test.tsx"
git commit -m "feat: memory tab shows producing agent badge [LUM-136]"
```

---

## Task 10: i18n — remove the now-unused `memory.source.auto`

**Files:**

- Modify: all 17 locale files in `lib/i18n/` (`de, en, en-AU, en-GB, es, es-419, fr, hi, id, ja, ko, ms, ru, vi, zh-CN, zh-TW` + `en.json`)

`memory.source.auto` ("由 Claude 沉淀" / "Sedimented by Claude") loses its only caller in Task 9. The `agentRun.memorySedimented` key is still referenced elsewhere (sparkles removed from MemoryCard, but verify in Step 1) — only remove `memory.source.auto`. Keep `memory.source.byMember`.

- [ ] **Step 1: Confirm there are no remaining references**

Run: `grep -rn "memory.source.auto\|memorySedimented" --include="*.ts" --include="*.tsx" app lib components | grep -v ".json"`
Expected: no `memory.source.auto` hits in code. If `agentRun.memorySedimented` still has a code reference, **leave that key**; if it has none either, remove it too in this task (search the same way). Document which keys you remove.

- [ ] **Step 2: Remove the `memory.source.auto` key from every locale file**

For each file in `lib/i18n/*.json`, delete the `"memory.source.auto": "..."` line. Per CLAUDE.md, update **every** locale file, not just en/zh-CN.

- [ ] **Step 3: Verify locale files are still valid JSON and keys are consistent**

Run: `for f in lib/i18n/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || echo "BAD: $f"; done`
Expected: no "BAD" lines.

Run: `grep -rl "memory.source.auto" lib/i18n/`
Expected: no output (key gone everywhere).

- [ ] **Step 4: Commit**

```bash
git add lib/i18n
git commit -m "chore: drop unused memory.source.auto i18n key [LUM-136]"
```

---

## Task 11: CLI — optional `--agent` on `memory add` + SKILL.md

**Files:**

- Modify: `cli/src/commands/memory-task-add.ts`
- Modify: `cli/src/commands/memory-project-add.ts`
- Modify: `cli/src/index.ts:384-413` (task memory add) and `:531-555` (project memory add)
- Modify: `.claude/skills/lumo/SKILL.md` (Memory management section)
- Test: `__tests__/cli/memory-add-action.test.ts`

The CLI reuses `normalizeAgent` / `VALID_AGENT_TOKENS` from `cli/src/lib/agent.ts` (already used by `task-artifact-add`). `--agent` is **optional**; when omitted the CLI sends no `agent` and the server/DB default (`CLAUDE_CODE`) applies. An explicit invalid value errors before the network call.

- [ ] **Step 1: Write the failing test**

Add to `__tests__/cli/memory-add-action.test.ts` (it stubs `fetch` and `readCredentials`). Assert the body carries the normalized agent, alias resolution works, and an invalid value errors without POSTing:

```ts
it('includes a normalized agent in the POST body', async () => {
  // arrange: mock resolve → taskId, then capture the memories POST body
  await memoryTaskAdd('LUM-1', {
    category: 'trap',
    trigger: 't',
    outcome: 'o',
    agent: 'codex',
  })
  const body = JSON.parse(lastPostBody())
  expect(body.agent).toBe('CODEX')
})

it('resolves the gemini alias to GEMINI_CLI', async () => {
  await memoryTaskAdd('LUM-1', {
    category: 'trap',
    trigger: 't',
    outcome: 'o',
    agent: 'gemini',
  })
  expect(JSON.parse(lastPostBody()).agent).toBe('GEMINI_CLI')
})

it('omits agent from the body when --agent is not given', async () => {
  await memoryTaskAdd('LUM-1', { category: 'trap', trigger: 't', outcome: 'o' })
  expect(JSON.parse(lastPostBody())).not.toHaveProperty('agent')
})

it('rejects an invalid agent before POSTing', async () => {
  const code = await memoryTaskAdd('LUM-1', {
    category: 'trap',
    trigger: 't',
    outcome: 'o',
    agent: 'bogus',
  })
  expect(code).toBe(1)
  expect(postCalled()).toBe(false)
})
```

(Use the file's existing fetch-capture helpers; if it lacks `lastPostBody`/`postCalled`, adapt to how it currently inspects `fetch.mock.calls`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- memory-add-action`
Expected: FAIL — `agent` not on options / never sent.

- [ ] **Step 3: Parse + send `agent` in `memory-task-add.ts`**

In `cli/src/commands/memory-task-add.ts`:

(a) Add the import:

```ts
import { normalizeAgent, VALID_AGENT_TOKENS } from '../lib/agent'
```

(b) Extend the options interface:

```ts
interface AddOptions extends MemoryFlags {
  category?: string
  agent?: string
}
```

(c) After the `buildMemoryContent` guard (after line 22), resolve the agent:

```ts
let agent: string | undefined
const agentRaw = options.agent?.trim()
if (agentRaw) {
  const normalized = normalizeAgent(agentRaw)
  if (!normalized) {
    console.error(
      `Error: invalid --agent "${agentRaw}". Valid values: ${VALID_AGENT_TOKENS.join(', ')}.`
    )
    return 1
  }
  agent = normalized
}
```

(d) Include `agent` in the POST body only when set (current line 61):

```ts
      body: JSON.stringify({
        category: built.category,
        content: built.content,
        ...(agent ? { agent } : {}),
      }),
```

- [ ] **Step 4: Mirror the change in `memory-project-add.ts`**

Apply the identical four edits to `cli/src/commands/memory-project-add.ts` (import, `AddOptions` gains `agent?: string`, resolve block after the `buildMemoryContent` guard on line 16, and spread `...(agent ? { agent } : {})` into the POST body on line 42).

- [ ] **Step 5: Register the `--agent` option on both commands**

In `cli/src/index.ts`, add this option to the `taskMemory ... .command('add [task]')` chain (after the `--step` option, before `.action`, ~line 405):

```ts
  .option(
    '--agent <agent>',
    'Producing agent: claude-code | codex | cursor | gemini-cli | github-copilot | windsurf (default claude-code)'
  )
```

Add the same `.option(...)` to the `projectMemory ... .command('add [project]')` chain (after its `--step` option, ~line 550).

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- memory-add-action`
Expected: PASS.

- [ ] **Step 7: Build the CLI and verify the flag is wired**

Run: `cd cli && npm run build && node dist/index.js task memory add --help | grep -- --agent; cd ..`
Expected: the `--agent` line appears in help output.

- [ ] **Step 8: Update SKILL.md**

In `.claude/skills/lumo/SKILL.md`, Memory management section: add `[--agent <agent>]` to the `task memory add` and `project memory add` usage blocks, and add a sentence noting the optional flag mirrors `task artifact add` agents (`claude-code | codex | cursor | gemini-cli | github-copilot | windsurf`, aliases `gemini`/`copilot`, default `claude-code`) and that omitting it records the memory as Claude Code. This is required by the CLI/Skills sync rule in CLAUDE.md.

- [ ] **Step 9: Commit**

```bash
git add cli/src/commands/memory-task-add.ts cli/src/commands/memory-project-add.ts cli/src/index.ts .claude/skills/lumo/SKILL.md __tests__/cli/memory-add-action.test.ts
git commit -m "feat: optional --agent on lumo memory add [LUM-136]"
```

---

## Final Verification

- [ ] **Full type check:** `npx tsc --noEmit` → no errors.
- [ ] **Full test suite:** `npm test` → all green.
- [ ] **Token lint:** `npm run lint:tokens` → no new violations (the AgentBadge brand colors are already baselined; no new inline hex is introduced).
- [ ] **Manual sanity (optional, jsdom-only env):** preview browser can't reach the local dev server in this setup (known constraint) — rely on the jsdom component tests above for UI proof rather than a live screenshot.

## PR notes (for the PR description, per CLAUDE.md)

- Schema change: adds `memories.agent` (`TaskArtifactAgent`, `NOT NULL DEFAULT 'CLAUDE_CODE'`). **Requires `prisma migrate deploy` on next deploy.** Non-destructive, no data backfill (default covers existing rows). Frontend tolerates a missing/unknown value via the `AgentBadge` fallback, so a brief deploy race is safe.
- No new npm packages.
- CLI change: `lumo task memory add` / `lumo project memory add` gain optional `--agent`; `.claude/skills/lumo/SKILL.md` updated to match.

## Self-Review notes

- **Spec coverage:** data model (T1), write paths CLI/API/service/layer-default (T11/T4/T3 + DB default for layer1/2), read paths (T2/T5/T6), rendering reuse of AgentBadge with fallback (T7/T8/T9), i18n removal (T10), tests (each task), PR migrate-deploy note (above) — all covered.
- **Type consistency:** `agent` is `TaskArtifactAgent` everywhere; optional (`agent?`) on create inputs and validation; required on read types (`MemoryRow`, both `AgentRunMemoryItem`s) and `MemoryCardItem`. `safeAgent` is the single fallback point.
- **One-component rule:** no memory-specific badge; `AgentBadge` is reused unchanged except the shared fallback.

# LUMO.md Proposal System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Given a task's memories, generate structured proposals to update a project-level LUMO.md knowledge file, then apply those proposals to the local filesystem.

**Architecture:** Single `generateObject()` LLM call with Zod-constrained output. Service reads task memories from DB + LUMO.md content as input, produces structured operations (add/modify/supersede bullets). Day 2 adds file-writing apply logic and onboarding flow.

**Tech Stack:** Prisma (new model), Vercel AI SDK (`generateObject` + `@ai-sdk/gateway`), Zod, Node.js `fs` for file ops.

**Spec:** `docs/superpowers/specs/2026-05-12-lumo-md-proposal-design.md`

---

## File Structure

```
prisma/schema.prisma                          — Add LumoProposal model + enum + relations
lib/validation/lumo-proposal.schema.ts        — Zod schemas for proposal operations
lib/repositories/lumo-proposal.repository.ts  — LumoProposal CRUD
lib/llm/lumo-proposal-client.ts               — System prompt + generateObject call
lib/services/lumo-proposal/lumo-proposal.service.ts  — Business orchestration
lib/services/lumo-proposal/lumo-md-writer.ts  — Apply operations to LUMO.md string (Day 2)
lib/services/lumo-proposal/lumo-onboarding.service.ts — Onboarding check + perform (Day 2)
scripts/test-lumo-proposal.ts                 — Day 1 manual test script
scripts/test-lumo-apply.ts                    — Day 2 manual test script
__tests__/lumo-proposal-client.test.ts        — Prompt builder unit tests
__tests__/lumo-proposal.service.test.ts       — Service orchestration tests
__tests__/lumo-md-writer.test.ts              — Apply logic unit tests (Day 2)
__tests__/lumo-onboarding.service.test.ts     — Onboarding logic unit tests (Day 2)
```

---

## Day 1: LLM Prompt + Service Skeleton

### Task 1: Prisma Model — LumoProposal

**Files:**

- Modify: `prisma/schema.prisma:347` (Project model — add relation)
- Modify: `prisma/schema.prisma:418` (Task model — add relation)
- Modify: `prisma/schema.prisma:1247` (after Memory model — add new model + enum)

- [ ] **Step 1: Add LumoProposalStatus enum and LumoProposal model to schema**

Append after the Memory model (after line 1247 of `prisma/schema.prisma`):

```prisma
// ─── LUMO.md Proposals (Layer 2 memory → knowledge file) ─────────────────────

enum LumoProposalStatus {
  PENDING
  APPLIED
  REJECTED
  SUPERSEDED
}

model LumoProposal {
  id             String              @id @default(cuid())
  projectId      String
  taskId         String
  status         LumoProposalStatus  @default(PENDING)
  operations     Json
  lumoMdSnapshot String?             @db.Text
  summary        String?
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt
  appliedAt      DateTime?

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  task    Task    @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@index([projectId])
  @@index([taskId])
  @@map("lumo_proposals")
}
```

- [ ] **Step 2: Add relation arrays to Project and Task models**

In the Project model (around line 347), add after `memories Memory[]`:

```prisma
  lumoProposals         LumoProposal[]
```

In the Task model (around line 418), add after `memories Memory[]`:

```prisma
  lumoProposals     LumoProposal[]
```

- [ ] **Step 3: Generate migration and apply**

Run:

```bash
npx prisma migrate dev --name add-lumo-proposal
```

Expected: migration file created in `prisma/migrations/`, Prisma client regenerated.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add LumoProposal model for Layer 2 memory [LUM-XX]"
```

---

### Task 2: Zod Validation Schemas

**Files:**

- Create: `lib/validation/lumo-proposal.schema.ts`

- [ ] **Step 1: Create Zod schemas**

Create `lib/validation/lumo-proposal.schema.ts`:

```typescript
import { z } from 'zod'

export const proposalOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('add'),
    section: z
      .string()
      .describe('Section heading, e.g. "Traps", "Conventions"'),
    content: z.string().describe('Bullet point text to add'),
    rationale: z.string().describe('Why this should be added to LUMO.md'),
    sourceTaskId: z.string().describe('Task ID this knowledge came from'),
  }),
  z.object({
    type: z.literal('modify'),
    section: z.string().describe('Section heading where the bullet lives'),
    oldContent: z.string().describe('Existing bullet text to find and replace'),
    newContent: z.string().describe('Updated bullet text'),
    rationale: z.string().describe('Why this entry needs updating'),
    sourceTaskId: z.string().describe('Task ID this knowledge came from'),
  }),
  z.object({
    type: z.literal('supersede'),
    section: z.string().describe('Section heading where the bullet lives'),
    content: z.string().describe('Existing bullet text to remove'),
    rationale: z.string().describe('Why this entry is no longer valid'),
    sourceTaskId: z.string().describe('Task ID this knowledge came from'),
  }),
])

export const lumoProposalOutputSchema = z.object({
  operations: z.array(proposalOperationSchema),
  summary: z.string().describe('One sentence summarizing the proposed changes'),
})

export type ProposalOperation = z.infer<typeof proposalOperationSchema>
export type LumoProposalOutput = z.infer<typeof lumoProposalOutputSchema>
```

- [ ] **Step 2: Commit**

```bash
git add lib/validation/lumo-proposal.schema.ts
git commit -m "feat: add Zod schemas for LUMO.md proposal operations [LUM-XX]"
```

---

### Task 3: LumoProposal Repository

**Files:**

- Create: `lib/repositories/lumo-proposal.repository.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lumo-proposal.repository.test.ts`:

```typescript
import { lumoProposalRepository } from '@/lib/repositories/lumo-proposal.repository'

const mockCreate = jest.fn()
const mockFindUnique = jest.fn()
const mockFindMany = jest.fn()
const mockUpdate = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    lumoProposal: {
      create: (...a: any[]) => mockCreate(...a),
      findUnique: (...a: any[]) => mockFindUnique(...a),
      findMany: (...a: any[]) => mockFindMany(...a),
      update: (...a: any[]) => mockUpdate(...a),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('lumoProposalRepository', () => {
  it('create stores proposal and returns id', async () => {
    mockCreate.mockResolvedValueOnce({ id: 'prop-1' })

    const result = await lumoProposalRepository.create({
      projectId: 'proj-1',
      taskId: 'task-1',
      operations: [
        {
          type: 'add',
          section: 'Traps',
          content: 'test',
          rationale: 'r',
          sourceTaskId: 'task-1',
        },
      ],
      lumoMdSnapshot: '# LUMO.md',
      summary: 'Added trap',
    })

    expect(result).toEqual({ id: 'prop-1' })
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        projectId: 'proj-1',
        taskId: 'task-1',
        operations: [
          {
            type: 'add',
            section: 'Traps',
            content: 'test',
            rationale: 'r',
            sourceTaskId: 'task-1',
          },
        ],
        lumoMdSnapshot: '# LUMO.md',
        summary: 'Added trap',
      },
      select: { id: true },
    })
  })

  it('findById returns proposal or null', async () => {
    mockFindUnique.mockResolvedValueOnce({ id: 'prop-1', status: 'PENDING' })
    const result = await lumoProposalRepository.findById('prop-1')
    expect(result).toEqual({ id: 'prop-1', status: 'PENDING' })
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: 'prop-1' },
    })
  })

  it('findByTaskId returns proposals for a task', async () => {
    mockFindMany.mockResolvedValueOnce([{ id: 'prop-1' }])
    const result = await lumoProposalRepository.findByTaskId('task-1')
    expect(result).toEqual([{ id: 'prop-1' }])
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { taskId: 'task-1' },
      orderBy: { createdAt: 'desc' },
    })
  })

  it('updateStatus sets status and optional appliedAt', async () => {
    const now = new Date('2026-05-12')
    mockUpdate.mockResolvedValueOnce({ id: 'prop-1' })
    await lumoProposalRepository.updateStatus('prop-1', 'APPLIED', now)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'prop-1' },
      data: { status: 'APPLIED', appliedAt: now },
      select: { id: true },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lumo-proposal.repository.test.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Write the repository**

Create `lib/repositories/lumo-proposal.repository.ts`:

```typescript
import { prisma } from '@/lib/db/prisma'
import type { LumoProposalStatus, Prisma } from '@prisma/client'

interface CreateLumoProposalInput {
  projectId: string
  taskId: string
  operations: Prisma.InputJsonValue
  lumoMdSnapshot: string | null
  summary: string | null
}

export const lumoProposalRepository = {
  async create(input: CreateLumoProposalInput) {
    return prisma.lumoProposal.create({
      data: {
        projectId: input.projectId,
        taskId: input.taskId,
        operations: input.operations,
        lumoMdSnapshot: input.lumoMdSnapshot,
        summary: input.summary,
      },
      select: { id: true },
    })
  },

  async findById(id: string) {
    return prisma.lumoProposal.findUnique({
      where: { id },
    })
  },

  async findByTaskId(taskId: string) {
    return prisma.lumoProposal.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
    })
  },

  async updateStatus(id: string, status: LumoProposalStatus, appliedAt?: Date) {
    return prisma.lumoProposal.update({
      where: { id },
      data: { status, appliedAt },
      select: { id: true },
    })
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lumo-proposal.repository.test.ts --no-coverage`
Expected: PASS — all 4 tests

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/lumo-proposal.repository.ts __tests__/lumo-proposal.repository.test.ts
git commit -m "feat: add LumoProposal repository [LUM-XX]"
```

---

### Task 4: LLM Client — Prompt + generateObject

**Files:**

- Create: `lib/llm/lumo-proposal-client.ts`
- Test: `__tests__/lumo-proposal-client.test.ts`

- [ ] **Step 1: Write the failing test for prompt builder**

Create `__tests__/lumo-proposal-client.test.ts`:

```typescript
import { buildLumoProposalPrompt } from '@/lib/llm/lumo-proposal-client'

describe('buildLumoProposalPrompt', () => {
  it('includes task title, description, and memories in prompt', () => {
    const prompt = buildLumoProposalPrompt(
      {
        id: 'task-1',
        title: 'Fix auth bug',
        description: 'Users cannot login with SSO',
        taskIdentifier: 'LUM-42',
      },
      [
        {
          id: 'm1',
          category: 'TRAP',
          content: { summary: 'SSO callback URL must use HTTPS in production' },
        },
        {
          id: 'm2',
          category: 'DECISION',
          content: { summary: 'Use Clerk for all auth flows' },
        },
      ],
      '# LUMO.md\n\n## Traps\n\n## Decisions\n'
    )

    expect(prompt).toContain('LUM-42')
    expect(prompt).toContain('Fix auth bug')
    expect(prompt).toContain('Users cannot login with SSO')
    expect(prompt).toContain('SSO callback URL must use HTTPS in production')
    expect(prompt).toContain('Use Clerk for all auth flows')
    expect(prompt).toContain('TRAP')
    expect(prompt).toContain('DECISION')
    expect(prompt).toContain('# LUMO.md')
  })

  it('handles empty LUMO.md', () => {
    const prompt = buildLumoProposalPrompt(
      {
        id: 'task-1',
        title: 'Test',
        description: null,
        taskIdentifier: 'LUM-1',
      },
      [],
      ''
    )

    expect(prompt).toContain('LUM-1')
    expect(prompt).toContain('(empty — no LUMO.md exists yet)')
  })

  it('handles null description', () => {
    const prompt = buildLumoProposalPrompt(
      {
        id: 'task-1',
        title: 'Test',
        description: null,
        taskIdentifier: 'LUM-1',
      },
      [
        {
          id: 'm1',
          category: 'CONVENTION',
          content: { summary: 'Always use async/await' },
        },
      ],
      ''
    )

    expect(prompt).toContain('(no description)')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lumo-proposal-client.test.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Write the LLM client**

Create `lib/llm/lumo-proposal-client.ts`:

```typescript
import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import {
  lumoProposalOutputSchema,
  type LumoProposalOutput,
} from '@/lib/validation/lumo-proposal.schema'

// ── Types ────────────────────────────────────────────────────────────────────

interface TaskContext {
  id: string
  title: string
  description: string | null
  taskIdentifier: string
}

interface MemoryInput {
  id: string
  category: string
  content: unknown
}

// ── System Prompt ────────────────────────────────────────────────────────────

const LUMO_PROPOSAL_SYSTEM_PROMPT = `You maintain a project-level knowledge document called LUMO.md. This file is automatically imported by AI coding agents (via CLAUDE.md) so they receive accumulated project wisdom before starting work.

LUMO.md is organized into sections, each containing bullet points:
- ## Traps — pitfalls, gotchas, things that broke unexpectedly
- ## Decisions — key engineering decisions and their rationale
- ## Conventions — coding patterns, naming rules, architectural norms
- ## Procedures — step-by-step workflows, deployment processes, testing protocols

Your job: given a completed task's memories (lessons learned during that task), propose structured operations to update LUMO.md.

Rules:
1. Only propose changes with project-level value. A one-off typo fix is not worth recording. A recurring pitfall that would burn another developer IS worth recording.
2. Check existing LUMO.md content for overlap. If a similar entry already exists, either SKIP (no operation) or MODIFY to improve it. Never add a duplicate.
3. If new experience contradicts an existing entry, SUPERSEDE the old one.
4. Each bullet should be concise (1-2 sentences), stating WHAT and WHY.
5. Every operation must include a rationale explaining your reasoning.
6. If the task's memories contain nothing worth adding to project knowledge, return an empty operations array. This is perfectly fine.
7. Use the same language as the existing LUMO.md content. If LUMO.md is empty, match the language of the task memories.
8. The sourceTaskId for every operation must be the task identifier provided (e.g. "LUM-42").`

// ── Prompt Builder ───────────────────────────────────────────────────────────

export function buildLumoProposalPrompt(
  task: TaskContext,
  memories: MemoryInput[],
  currentLumoMd: string
): string {
  const descLine = task.description ?? '(no description)'

  const memoryLines =
    memories.length > 0
      ? memories
          .map((m, i) => {
            const content =
              typeof m.content === 'object' && m.content !== null
                ? JSON.stringify(m.content)
                : String(m.content)
            return `  ${i + 1}. [${m.category}] ${content}`
          })
          .join('\n')
      : '  (no memories recorded)'

  const lumoSection =
    currentLumoMd.trim() === ''
      ? '(empty — no LUMO.md exists yet)'
      : currentLumoMd

  return `Task: ${task.taskIdentifier} — ${task.title}
Description: ${descLine}

Task Memories:
${memoryLines}

Current LUMO.md:
${lumoSection}`
}

// ── LLM Call ─────────────────────────────────────────────────────────────────

export async function callLumoProposalLLM(
  task: TaskContext,
  memories: MemoryInput[],
  currentLumoMd: string
): Promise<LumoProposalOutput> {
  const prompt = buildLumoProposalPrompt(task, memories, currentLumoMd)

  const { object } = await generateObject({
    model: gateway('anthropic/claude-sonnet-4.5'),
    schema: lumoProposalOutputSchema,
    system: LUMO_PROPOSAL_SYSTEM_PROMPT,
    prompt,
  })

  return object
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lumo-proposal-client.test.ts --no-coverage`
Expected: PASS — all 3 tests

- [ ] **Step 5: Commit**

```bash
git add lib/llm/lumo-proposal-client.ts __tests__/lumo-proposal-client.test.ts
git commit -m "feat: add LLM client for LUMO.md proposal generation [LUM-XX]"
```

---

### Task 5: Proposal Service — generateProposal

**Files:**

- Create: `lib/services/lumo-proposal/lumo-proposal.service.ts`
- Test: `__tests__/lumo-proposal.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lumo-proposal.service.test.ts`:

```typescript
import { lumoProposalService } from '@/lib/services/lumo-proposal/lumo-proposal.service'

const mockFindForMemoryContext = jest.fn()
const mockFindActiveTaskMemories = jest.fn()
const mockCreateProposal = jest.fn()
const mockCallLLM = jest.fn()

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findForMemoryContext: (...a: any[]) => mockFindForMemoryContext(...a),
  },
}))

jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveTaskMemories: (...a: any[]) => mockFindActiveTaskMemories(...a),
  },
}))

jest.mock('@/lib/repositories/lumo-proposal.repository', () => ({
  lumoProposalRepository: {
    create: (...a: any[]) => mockCreateProposal(...a),
  },
}))

jest.mock('@/lib/llm/lumo-proposal-client', () => ({
  callLumoProposalLLM: (...a: any[]) => mockCallLLM(...a),
}))

beforeEach(() => jest.clearAllMocks())

const TASK = {
  id: 'task-1',
  title: 'Fix auth bug',
  description: 'SSO broken',
  projectId: 'proj-1',
  project: { workspaceId: 'ws-1' },
  team: { identifier: 'LUM' },
  number: 42,
}

const MEMORIES = [
  {
    id: 'm1',
    category: 'TRAP',
    content: { summary: 'SSO needs HTTPS' },
    createdAt: new Date(),
  },
]

describe('lumoProposalService.generateProposal', () => {
  it('happy path: reads task + memories → calls LLM → saves proposal', async () => {
    mockFindForMemoryContext.mockResolvedValueOnce(TASK)
    mockFindActiveTaskMemories.mockResolvedValueOnce(MEMORIES)
    mockCallLLM.mockResolvedValueOnce({
      operations: [
        {
          type: 'add',
          section: 'Traps',
          content: 'SSO needs HTTPS',
          rationale: 'r',
          sourceTaskId: 'LUM-42',
        },
      ],
      summary: 'Added SSO trap',
    })
    mockCreateProposal.mockResolvedValueOnce({ id: 'prop-1' })

    const result = await lumoProposalService.generateProposal(
      'task-1',
      '# LUMO.md\n'
    )

    expect(mockFindForMemoryContext).toHaveBeenCalledWith('task-1')
    expect(mockFindActiveTaskMemories).toHaveBeenCalledWith('task-1')
    expect(mockCallLLM).toHaveBeenCalledWith(
      {
        id: 'task-1',
        title: 'Fix auth bug',
        description: 'SSO broken',
        taskIdentifier: 'LUM-42',
      },
      MEMORIES,
      '# LUMO.md\n'
    )
    expect(mockCreateProposal).toHaveBeenCalledWith({
      projectId: 'proj-1',
      taskId: 'task-1',
      operations: [
        {
          type: 'add',
          section: 'Traps',
          content: 'SSO needs HTTPS',
          rationale: 'r',
          sourceTaskId: 'LUM-42',
        },
      ],
      lumoMdSnapshot: '# LUMO.md\n',
      summary: 'Added SSO trap',
    })
    expect(result).toEqual({ id: 'prop-1' })
  })

  it('throws 404 when task not found', async () => {
    mockFindForMemoryContext.mockResolvedValueOnce(null)
    await expect(
      lumoProposalService.generateProposal('missing', '')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 400 when task has no memories', async () => {
    mockFindForMemoryContext.mockResolvedValueOnce(TASK)
    mockFindActiveTaskMemories.mockResolvedValueOnce([])
    await expect(
      lumoProposalService.generateProposal('task-1', '')
    ).rejects.toMatchObject({ status: 400 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lumo-proposal.service.test.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Check taskRepository.findForMemoryContext exists**

The task repository already has `findForMemoryContext` (returns `id, title, description, projectId, project.workspaceId`). We need to add `team.identifier` and `number` to its select. Modify `lib/repositories/task.repository.ts` — find the `findForMemoryContext` method and update its select:

```typescript
  async findForMemoryContext(id: string) {
    return prisma.task.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        number: true,
        projectId: true,
        project: { select: { workspaceId: true } },
        team: { select: { identifier: true } },
      },
    })
  },
```

- [ ] **Step 4: Write the service**

Create `lib/services/lumo-proposal/lumo-proposal.service.ts`:

```typescript
import { taskRepository } from '@/lib/repositories/task.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { lumoProposalRepository } from '@/lib/repositories/lumo-proposal.repository'
import { callLumoProposalLLM } from '@/lib/llm/lumo-proposal-client'

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

export const lumoProposalService = {
  async generateProposal(taskId: string, currentLumoMd: string) {
    const task = await taskRepository.findForMemoryContext(taskId)
    if (!task) httpError(404, 'task not found')

    const memories = await memoryRepository.findActiveTaskMemories(taskId)
    if (memories.length === 0) httpError(400, 'task has no memories')

    const taskIdentifier = `${task.team.identifier}-${task.number}`

    const { operations, summary } = await callLumoProposalLLM(
      {
        id: task.id,
        title: task.title,
        description: task.description,
        taskIdentifier,
      },
      memories,
      currentLumoMd
    )

    const proposal = await lumoProposalRepository.create({
      projectId: task.projectId,
      taskId: task.id,
      operations,
      lumoMdSnapshot: currentLumoMd || null,
      summary,
    })

    return proposal
  },
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/lumo-proposal.service.test.ts --no-coverage`
Expected: PASS — all 3 tests

- [ ] **Step 6: Commit**

```bash
git add lib/services/lumo-proposal/lumo-proposal.service.ts __tests__/lumo-proposal.service.test.ts lib/repositories/task.repository.ts
git commit -m "feat: add generateProposal service for LUMO.md [LUM-XX]"
```

---

### Task 6: Test Script — Manual E2E

**Files:**

- Create: `scripts/test-lumo-proposal.ts`

- [ ] **Step 1: Create the test script**

Create `scripts/test-lumo-proposal.ts`:

```typescript
/**
 * Manual test for LUMO.md proposal generation.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/test-lumo-proposal.ts --task=<taskId>
 *
 * Reads the task's memories from DB, generates a proposal using the LLM,
 * and prints the result. Does NOT write any files.
 */
import { prisma } from '../lib/db/prisma'
import { taskRepository } from '../lib/repositories/task.repository'
import { memoryRepository } from '../lib/repositories/memory.repository'
import { callLumoProposalLLM } from '../lib/llm/lumo-proposal-client'

function parseArgs(): { taskId: string } {
  const taskFlag = process.argv.find(a => a.startsWith('--task='))
  if (!taskFlag) {
    console.error(
      'Usage: npx tsx scripts/test-lumo-proposal.ts --task=<taskId>'
    )
    process.exit(1)
  }
  return { taskId: taskFlag.slice('--task='.length) }
}

async function main() {
  const { taskId } = parseArgs()

  const task = await taskRepository.findForMemoryContext(taskId)
  if (!task) {
    console.error(`Task ${taskId} not found`)
    process.exit(1)
  }

  const memories = await memoryRepository.findActiveTaskMemories(taskId)
  console.log(`Task: ${task.title} (${task.team.identifier}-${task.number})`)
  console.log(`Memories: ${memories.length}`)

  if (memories.length === 0) {
    console.log('No memories found — nothing to propose.')
    process.exit(0)
  }

  const mockLumoMd = `# LUMO.md
<!-- Auto-maintained by Lumo. Do not edit manually. -->

## Traps

## Decisions

## Conventions

## Procedures
`

  console.log('\nCalling LLM...\n')
  const result = await callLumoProposalLLM(
    {
      id: task.id,
      title: task.title,
      description: task.description,
      taskIdentifier: `${task.team.identifier}-${task.number}`,
    },
    memories,
    mockLumoMd
  )

  console.log('Summary:', result.summary)
  console.log(`Operations (${result.operations.length}):`)
  for (const op of result.operations) {
    console.log(`  [${op.type}] ## ${op.section}`)
    if (op.type === 'modify') {
      console.log(`    old: ${op.oldContent}`)
      console.log(`    new: ${op.newContent}`)
    } else {
      console.log(`    content: ${op.content}`)
    }
    console.log(`    rationale: ${op.rationale}`)
    console.log(`    source: ${op.sourceTaskId}`)
  }

  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 2: Commit**

```bash
git add scripts/test-lumo-proposal.ts
git commit -m "chore: add test script for LUMO.md proposal generation [LUM-XX]"
```

---

## Day 2: Apply Logic + Onboarding

### Task 7: LUMO.md Writer — Apply Operations to Markdown

**Files:**

- Create: `lib/services/lumo-proposal/lumo-md-writer.ts`
- Test: `__tests__/lumo-md-writer.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lumo-md-writer.test.ts`:

```typescript
import { applyOperations } from '@/lib/services/lumo-proposal/lumo-md-writer'
import type { ProposalOperation } from '@/lib/validation/lumo-proposal.schema'

const INITIAL_LUMO_MD = `# LUMO.md
<!-- Auto-maintained by Lumo. Do not edit manually. -->

## Traps

- Never use \`router.push\` inside useEffect without deps <!-- from: LUM-12 -->

## Decisions

## Conventions

- Use async/await, never .then() <!-- from: LUM-5 -->

## Procedures
`

describe('applyOperations', () => {
  it('adds a bullet to an existing section', () => {
    const ops: ProposalOperation[] = [
      {
        type: 'add',
        section: 'Traps',
        content: 'Prisma upsert races under concurrency',
        rationale: 'r',
        sourceTaskId: 'LUM-18',
      },
    ]
    const { content, warnings } = applyOperations(INITIAL_LUMO_MD, ops)

    expect(content).toContain(
      '- Prisma upsert races under concurrency <!-- from: LUM-18 -->'
    )
    expect(content).toContain('- Never use `router.push`')
    expect(warnings).toHaveLength(0)
  })

  it('adds a bullet to a non-existent section by creating it', () => {
    const ops: ProposalOperation[] = [
      {
        type: 'add',
        section: 'New Section',
        content: 'Something new',
        rationale: 'r',
        sourceTaskId: 'LUM-99',
      },
    ]
    const { content, warnings } = applyOperations(INITIAL_LUMO_MD, ops)

    expect(content).toContain('## New Section')
    expect(content).toContain('- Something new <!-- from: LUM-99 -->')
    expect(warnings).toHaveLength(0)
  })

  it('modifies an existing bullet', () => {
    const ops: ProposalOperation[] = [
      {
        type: 'modify',
        section: 'Conventions',
        oldContent: 'Use async/await, never .then()',
        newContent:
          'Use async/await exclusively; .then() is banned in all layers',
        rationale: 'r',
        sourceTaskId: 'LUM-20',
      },
    ]
    const { content, warnings } = applyOperations(INITIAL_LUMO_MD, ops)

    expect(content).not.toContain('Use async/await, never .then()')
    expect(content).toContain(
      '- Use async/await exclusively; .then() is banned in all layers <!-- from: LUM-20 -->'
    )
    expect(warnings).toHaveLength(0)
  })

  it('warns when modify cannot find oldContent', () => {
    const ops: ProposalOperation[] = [
      {
        type: 'modify',
        section: 'Conventions',
        oldContent: 'This does not exist',
        newContent: 'Replacement',
        rationale: 'r',
        sourceTaskId: 'LUM-1',
      },
    ]
    const { content, warnings } = applyOperations(INITIAL_LUMO_MD, ops)

    expect(content).toBe(INITIAL_LUMO_MD)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Could not find')
  })

  it('supersedes (removes) an existing bullet', () => {
    const ops: ProposalOperation[] = [
      {
        type: 'supersede',
        section: 'Traps',
        content: 'Never use `router.push` inside useEffect without deps',
        rationale: 'r',
        sourceTaskId: 'LUM-30',
      },
    ]
    const { content, warnings } = applyOperations(INITIAL_LUMO_MD, ops)

    expect(content).not.toContain('router.push')
    expect(warnings).toHaveLength(0)
  })

  it('handles multiple operations in sequence', () => {
    const ops: ProposalOperation[] = [
      {
        type: 'add',
        section: 'Traps',
        content: 'New trap',
        rationale: 'r',
        sourceTaskId: 'LUM-50',
      },
      {
        type: 'supersede',
        section: 'Conventions',
        content: 'Use async/await, never .then()',
        rationale: 'r',
        sourceTaskId: 'LUM-50',
      },
      {
        type: 'add',
        section: 'Conventions',
        content: 'Prefer named exports',
        rationale: 'r',
        sourceTaskId: 'LUM-50',
      },
    ]
    const { content, warnings } = applyOperations(INITIAL_LUMO_MD, ops)

    expect(content).toContain('- New trap <!-- from: LUM-50 -->')
    expect(content).not.toContain('Use async/await, never .then()')
    expect(content).toContain('- Prefer named exports <!-- from: LUM-50 -->')
    expect(warnings).toHaveLength(0)
  })

  it('handles empty LUMO.md (creates sections as needed)', () => {
    const ops: ProposalOperation[] = [
      {
        type: 'add',
        section: 'Traps',
        content: 'Watch out',
        rationale: 'r',
        sourceTaskId: 'LUM-1',
      },
    ]
    const { content, warnings } = applyOperations('', ops)

    expect(content).toContain('## Traps')
    expect(content).toContain('- Watch out <!-- from: LUM-1 -->')
    expect(warnings).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lumo-md-writer.test.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Write the writer module**

Create `lib/services/lumo-proposal/lumo-md-writer.ts`:

```typescript
import type { ProposalOperation } from '@/lib/validation/lumo-proposal.schema'

interface ApplyResult {
  content: string
  warnings: string[]
}

export function applyOperations(
  lumoMd: string,
  operations: ProposalOperation[]
): ApplyResult {
  const warnings: string[] = []
  let lines = lumoMd.split('\n')

  for (const op of operations) {
    const sectionIdx = lines.findIndex(
      l => l.trim().toLowerCase() === `## ${op.section}`.toLowerCase()
    )

    if (op.type === 'add') {
      const bullet = `- ${op.content} <!-- from: ${op.sourceTaskId} -->`

      if (sectionIdx === -1) {
        if (lines.length > 0 && lines[lines.length - 1]!.trim() !== '') {
          lines.push('')
        }
        lines.push(`## ${op.section}`, '', bullet, '')
      } else {
        const insertIdx = findSectionEnd(lines, sectionIdx)
        lines.splice(insertIdx, 0, bullet)
      }
    } else if (op.type === 'modify') {
      if (sectionIdx === -1) {
        warnings.push(
          `Could not find section "## ${op.section}" for modify operation`
        )
        continue
      }
      const { start, end } = getSectionRange(lines, sectionIdx)
      const targetIdx = findBulletContaining(lines, start, end, op.oldContent)
      if (targetIdx === -1) {
        warnings.push(
          `Could not find bullet containing "${op.oldContent}" in ## ${op.section}`
        )
        continue
      }
      lines[targetIdx] = `- ${op.newContent} <!-- from: ${op.sourceTaskId} -->`
    } else if (op.type === 'supersede') {
      if (sectionIdx === -1) {
        warnings.push(
          `Could not find section "## ${op.section}" for supersede operation`
        )
        continue
      }
      const { start, end } = getSectionRange(lines, sectionIdx)
      const targetIdx = findBulletContaining(lines, start, end, op.content)
      if (targetIdx === -1) {
        warnings.push(
          `Could not find bullet containing "${op.content}" in ## ${op.section}`
        )
        continue
      }
      lines.splice(targetIdx, 1)
    }
  }

  return { content: lines.join('\n'), warnings }
}

function findSectionEnd(lines: string[], sectionIdx: number): number {
  let i = sectionIdx + 1
  let lastBullet = -1
  while (i < lines.length) {
    if (lines[i]!.startsWith('## ')) break
    if (lines[i]!.startsWith('- ')) lastBullet = i
    i++
  }
  return lastBullet === -1 ? sectionIdx + 2 : lastBullet + 1
}

function getSectionRange(
  lines: string[],
  sectionIdx: number
): { start: number; end: number } {
  const start = sectionIdx + 1
  let end = lines.length
  for (let i = start; i < lines.length; i++) {
    if (lines[i]!.startsWith('## ')) {
      end = i
      break
    }
  }
  return { start, end }
}

function findBulletContaining(
  lines: string[],
  start: number,
  end: number,
  text: string
): number {
  for (let i = start; i < end; i++) {
    if (lines[i]!.includes(text)) return i
  }
  return -1
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lumo-md-writer.test.ts --no-coverage`
Expected: PASS — all 7 tests

- [ ] **Step 5: Commit**

```bash
git add lib/services/lumo-proposal/lumo-md-writer.ts __tests__/lumo-md-writer.test.ts
git commit -m "feat: add LUMO.md writer for applying proposal operations [LUM-XX]"
```

---

### Task 8: Onboarding Service

**Files:**

- Create: `lib/services/lumo-proposal/lumo-onboarding.service.ts`
- Test: `__tests__/lumo-onboarding.service.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lumo-onboarding.service.test.ts`:

```typescript
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { lumoOnboardingService } from '@/lib/services/lumo-proposal/lumo-onboarding.service'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumo-onboard-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('lumoOnboardingService.checkStatus', () => {
  it('returns all false when repo is empty', () => {
    const status = lumoOnboardingService.checkStatus(tmpDir)
    expect(status).toEqual({
      lumoMdExists: false,
      claudeMdImported: false,
      agentsMdExists: false,
      agentsMdImported: false,
    })
  })

  it('detects existing LUMO.md', () => {
    fs.writeFileSync(path.join(tmpDir, 'LUMO.md'), '# LUMO.md\n')
    const status = lumoOnboardingService.checkStatus(tmpDir)
    expect(status.lumoMdExists).toBe(true)
  })

  it('detects @import in CLAUDE.md', () => {
    fs.writeFileSync(path.join(tmpDir, 'LUMO.md'), '# LUMO.md\n')
    fs.writeFileSync(
      path.join(tmpDir, 'CLAUDE.md'),
      '# CLAUDE.md\n@import LUMO.md\n'
    )
    const status = lumoOnboardingService.checkStatus(tmpDir)
    expect(status.claudeMdImported).toBe(true)
  })

  it('detects AGENTS.md exists but no import', () => {
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '# AGENTS.md\n')
    const status = lumoOnboardingService.checkStatus(tmpDir)
    expect(status.agentsMdExists).toBe(true)
    expect(status.agentsMdImported).toBe(false)
  })
})

describe('lumoOnboardingService.perform', () => {
  it('creates LUMO.md with template when it does not exist', () => {
    const result = lumoOnboardingService.perform(tmpDir, ['CLAUDE.md'])
    expect(result.created).toContain('LUMO.md')
    const content = fs.readFileSync(path.join(tmpDir, 'LUMO.md'), 'utf-8')
    expect(content).toContain('## Traps')
    expect(content).toContain('## Decisions')
    expect(content).toContain('## Conventions')
    expect(content).toContain('## Procedures')
  })

  it('creates CLAUDE.md with @import when it does not exist', () => {
    const result = lumoOnboardingService.perform(tmpDir, ['CLAUDE.md'])
    expect(result.created).toContain('CLAUDE.md')
    const content = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf-8')
    expect(content).toContain('@import LUMO.md')
  })

  it('appends @import to existing CLAUDE.md', () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# My Project\n')
    const result = lumoOnboardingService.perform(tmpDir, ['CLAUDE.md'])
    expect(result.modified).toContain('CLAUDE.md')
    const content = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf-8')
    expect(content).toContain('# My Project')
    expect(content).toContain('@import LUMO.md')
  })

  it('skips CLAUDE.md if already imported', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'CLAUDE.md'),
      '# Project\n@import LUMO.md\n'
    )
    fs.writeFileSync(path.join(tmpDir, 'LUMO.md'), '# LUMO.md\n')
    const result = lumoOnboardingService.perform(tmpDir, ['CLAUDE.md'])
    expect(result.skipped).toContain('CLAUDE.md')
    expect(result.skipped).toContain('LUMO.md')
  })

  it('handles both targets', () => {
    const result = lumoOnboardingService.perform(tmpDir, [
      'CLAUDE.md',
      'AGENTS.md',
    ])
    expect(result.created).toContain('LUMO.md')
    expect(result.created).toContain('CLAUDE.md')
    expect(result.created).toContain('AGENTS.md')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lumo-onboarding.service.test.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Write the onboarding service**

Create `lib/services/lumo-proposal/lumo-onboarding.service.ts`:

```typescript
import * as fs from 'fs'
import * as path from 'path'

interface OnboardingStatus {
  lumoMdExists: boolean
  claudeMdImported: boolean
  agentsMdExists: boolean
  agentsMdImported: boolean
}

interface OnboardingResult {
  created: string[]
  modified: string[]
  skipped: string[]
}

type ImportTarget = 'CLAUDE.md' | 'AGENTS.md'

const LUMO_MD_TEMPLATE = `# LUMO.md
<!-- Auto-maintained by Lumo. Do not edit manually. -->

## Traps

## Decisions

## Conventions

## Procedures
`

function fileContainsImport(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false
  const content = fs.readFileSync(filePath, 'utf-8')
  return content.includes('@import LUMO.md')
}

export const lumoOnboardingService = {
  checkStatus(repoPath: string): OnboardingStatus {
    const lumoPath = path.join(repoPath, 'LUMO.md')
    const claudePath = path.join(repoPath, 'CLAUDE.md')
    const agentsPath = path.join(repoPath, 'AGENTS.md')

    return {
      lumoMdExists: fs.existsSync(lumoPath),
      claudeMdImported: fileContainsImport(claudePath),
      agentsMdExists: fs.existsSync(agentsPath),
      agentsMdImported: fileContainsImport(agentsPath),
    }
  },

  perform(repoPath: string, targets: ImportTarget[]): OnboardingResult {
    const created: string[] = []
    const modified: string[] = []
    const skipped: string[] = []

    const lumoPath = path.join(repoPath, 'LUMO.md')
    if (!fs.existsSync(lumoPath)) {
      fs.writeFileSync(lumoPath, LUMO_MD_TEMPLATE, 'utf-8')
      created.push('LUMO.md')
    } else {
      skipped.push('LUMO.md')
    }

    for (const target of targets) {
      const targetPath = path.join(repoPath, target)

      if (!fs.existsSync(targetPath)) {
        fs.writeFileSync(targetPath, `@import LUMO.md\n`, 'utf-8')
        created.push(target)
      } else if (!fileContainsImport(targetPath)) {
        const existing = fs.readFileSync(targetPath, 'utf-8')
        const separator = existing.endsWith('\n') ? '' : '\n'
        fs.writeFileSync(
          targetPath,
          existing + separator + '@import LUMO.md\n',
          'utf-8'
        )
        modified.push(target)
      } else {
        skipped.push(target)
      }
    }

    return { created, modified, skipped }
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lumo-onboarding.service.test.ts --no-coverage`
Expected: PASS — all tests

- [ ] **Step 5: Commit**

```bash
git add lib/services/lumo-proposal/lumo-onboarding.service.ts __tests__/lumo-onboarding.service.test.ts
git commit -m "feat: add LUMO.md onboarding service [LUM-XX]"
```

---

### Task 9: Extend Service — applyProposal

**Files:**

- Modify: `lib/services/lumo-proposal/lumo-proposal.service.ts`
- Modify: `__tests__/lumo-proposal.service.test.ts`

- [ ] **Step 1: Add applyProposal tests**

Append to `__tests__/lumo-proposal.service.test.ts`:

```typescript
const mockFindById = jest.fn()
const mockUpdateStatus = jest.fn()

// Update the lumo-proposal.repository mock to include findById and updateStatus:
jest.mock('@/lib/repositories/lumo-proposal.repository', () => ({
  lumoProposalRepository: {
    create: (...a: any[]) => mockCreateProposal(...a),
    findById: (...a: any[]) => mockFindById(...a),
    updateStatus: (...a: any[]) => mockUpdateStatus(...a),
  },
}))

// Add fs mock at top level
const mockReadFileSync = jest.fn()
const mockWriteFileSync = jest.fn()
const mockExistsSync = jest.fn()

jest.mock('fs', () => ({
  readFileSync: (...a: any[]) => mockReadFileSync(...a),
  writeFileSync: (...a: any[]) => mockWriteFileSync(...a),
  existsSync: (...a: any[]) => mockExistsSync(...a),
}))

describe('lumoProposalService.applyProposal', () => {
  it('reads file, applies operations, writes back, updates status', async () => {
    const proposal = {
      id: 'prop-1',
      status: 'PENDING',
      operations: [
        {
          type: 'add',
          section: 'Traps',
          content: 'Watch out',
          rationale: 'r',
          sourceTaskId: 'LUM-1',
        },
      ],
    }
    mockFindById.mockResolvedValueOnce(proposal)
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('# LUMO.md\n\n## Traps\n\n## Decisions\n')
    mockUpdateStatus.mockResolvedValueOnce({ id: 'prop-1' })

    const result = await lumoProposalService.applyProposal(
      'prop-1',
      '/repo/LUMO.md'
    )

    expect(mockReadFileSync).toHaveBeenCalledWith('/repo/LUMO.md', 'utf-8')
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/repo/LUMO.md',
      expect.stringContaining('Watch out'),
      'utf-8'
    )
    expect(mockUpdateStatus).toHaveBeenCalledWith(
      'prop-1',
      'APPLIED',
      expect.any(Date)
    )
    expect(result.warnings).toHaveLength(0)
  })

  it('throws 404 when proposal not found', async () => {
    mockFindById.mockResolvedValueOnce(null)
    await expect(
      lumoProposalService.applyProposal('missing', '/repo/LUMO.md')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 400 when proposal is not PENDING', async () => {
    mockFindById.mockResolvedValueOnce({
      id: 'prop-1',
      status: 'APPLIED',
      operations: [],
    })
    await expect(
      lumoProposalService.applyProposal('prop-1', '/repo/LUMO.md')
    ).rejects.toMatchObject({ status: 400 })
  })
})
```

Note: The test file needs restructuring — the `jest.mock` calls for `lumo-proposal.repository` and `fs` must be at the top level alongside the existing mocks. Move the existing `mockCreateProposal` mock into the expanded mock, and add the `fs` mock. The full final mock section at the top of the file should be:

```typescript
const mockCreateProposal = jest.fn()
const mockFindById = jest.fn()
const mockUpdateStatus = jest.fn()

jest.mock('@/lib/repositories/lumo-proposal.repository', () => ({
  lumoProposalRepository: {
    create: (...a: any[]) => mockCreateProposal(...a),
    findById: (...a: any[]) => mockFindById(...a),
    updateStatus: (...a: any[]) => mockUpdateStatus(...a),
  },
}))

const mockReadFileSync = jest.fn()
const mockWriteFileSync = jest.fn()
const mockExistsSync = jest.fn()

jest.mock('fs', () => ({
  readFileSync: (...a: any[]) => mockReadFileSync(...a),
  writeFileSync: (...a: any[]) => mockWriteFileSync(...a),
  existsSync: (...a: any[]) => mockExistsSync(...a),
}))
```

- [ ] **Step 2: Run test to verify new tests fail**

Run: `npx jest __tests__/lumo-proposal.service.test.ts --no-coverage`
Expected: FAIL — `applyProposal` not found on service

- [ ] **Step 3: Add applyProposal to the service**

Add to `lib/services/lumo-proposal/lumo-proposal.service.ts`:

```typescript
import * as fs from 'fs'
import { applyOperations } from './lumo-md-writer'
// ... (add these imports at the top)

export const lumoProposalService = {
  // ... existing generateProposal ...

  async applyProposal(proposalId: string, lumoMdPath: string) {
    const proposal = await lumoProposalRepository.findById(proposalId)
    if (!proposal) httpError(404, 'proposal not found')
    if (proposal.status !== 'PENDING')
      httpError(400, 'proposal is not in PENDING status')

    const currentContent = fs.readFileSync(lumoMdPath, 'utf-8')
    const operations = proposal.operations as ProposalOperation[]
    const { content: newContent, warnings } = applyOperations(
      currentContent,
      operations
    )

    fs.writeFileSync(lumoMdPath, newContent, 'utf-8')
    await lumoProposalRepository.updateStatus(proposalId, 'APPLIED', new Date())

    return { newContent, warnings }
  },
}
```

Add the import at the top:

```typescript
import type { ProposalOperation } from '@/lib/validation/lumo-proposal.schema'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lumo-proposal.service.test.ts --no-coverage`
Expected: PASS — all 6 tests (3 old + 3 new)

- [ ] **Step 5: Commit**

```bash
git add lib/services/lumo-proposal/lumo-proposal.service.ts __tests__/lumo-proposal.service.test.ts
git commit -m "feat: add applyProposal to LUMO.md service [LUM-XX]"
```

---

### Task 10: Day 2 Test Script

**Files:**

- Create: `scripts/test-lumo-apply.ts`

- [ ] **Step 1: Create the test script**

Create `scripts/test-lumo-apply.ts`:

```typescript
/**
 * End-to-end test for LUMO.md proposal → apply flow.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/test-lumo-apply.ts --task=<taskId> --repo=<repoPath>
 *
 * Generates a proposal from the task's memories, then applies it to LUMO.md
 * in the specified repo path. Runs onboarding if needed.
 */
import * as fs from 'fs'
import * as path from 'path'
import { prisma } from '../lib/db/prisma'
import { lumoProposalService } from '../lib/services/lumo-proposal/lumo-proposal.service'
import { lumoOnboardingService } from '../lib/services/lumo-proposal/lumo-onboarding.service'

function parseArgs(): { taskId: string; repoPath: string } {
  const taskFlag = process.argv.find(a => a.startsWith('--task='))
  const repoFlag = process.argv.find(a => a.startsWith('--repo='))
  if (!taskFlag || !repoFlag) {
    console.error(
      'Usage: npx tsx scripts/test-lumo-apply.ts --task=<taskId> --repo=<repoPath>'
    )
    process.exit(1)
  }
  return {
    taskId: taskFlag.slice('--task='.length),
    repoPath: repoFlag.slice('--repo='.length),
  }
}

async function main() {
  const { taskId, repoPath } = parseArgs()
  const lumoMdPath = path.join(repoPath, 'LUMO.md')

  // Step 1: Onboarding check
  const status = lumoOnboardingService.checkStatus(repoPath)
  console.log('Onboarding status:', status)

  if (!status.lumoMdExists || !status.claudeMdImported) {
    console.log('Running onboarding...')
    const result = lumoOnboardingService.perform(repoPath, ['CLAUDE.md'])
    console.log('Onboarding result:', result)
  }

  // Step 2: Read current LUMO.md
  const currentLumoMd = fs.readFileSync(lumoMdPath, 'utf-8')
  console.log('\n--- Current LUMO.md ---')
  console.log(currentLumoMd)

  // Step 3: Generate proposal
  console.log('Generating proposal...')
  const proposal = await lumoProposalService.generateProposal(
    taskId,
    currentLumoMd
  )
  console.log('Proposal created:', proposal.id)

  // Step 4: Apply proposal
  console.log('Applying proposal...')
  const { newContent, warnings } = await lumoProposalService.applyProposal(
    proposal.id,
    lumoMdPath
  )

  if (warnings.length > 0) {
    console.log('\nWarnings:')
    for (const w of warnings) console.log(`  ⚠ ${w}`)
  }

  console.log('\n--- Updated LUMO.md ---')
  console.log(newContent)

  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 2: Commit**

```bash
git add scripts/test-lumo-apply.ts
git commit -m "chore: add end-to-end test script for LUMO.md apply flow [LUM-XX]"
```

---

### Task 11: Run All Tests

- [ ] **Step 1: Run the full test suite**

Run: `npm test -- --no-coverage`
Expected: All tests pass, no regressions.

- [ ] **Step 2: Run TypeScript type check**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address test/type issues from LUMO.md proposal implementation [LUM-XX]"
```

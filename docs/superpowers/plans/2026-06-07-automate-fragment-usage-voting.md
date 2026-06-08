# Automated Fragment-Usage Voting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the lineage `used` signal flow automatically and honestly — when a task reaches DONE, a server-side evidence-gated LLM judge votes `used=true` only on fragments it can trace to a concrete action in the session's event log, leaving the rest NULL (never `false`).

**Architecture:** Background side effect of task→DONE (same seam as outcome-stamping + Layer-2 consolidation), plus an hourly cron backstop. Per task: enumerate its not-yet-voted sessions → resolve each fragment's content from the DB → compact the session's event log → judge → write an additive true-only vote. Validation is surfaced via `lumo task lineage --signal`. No web UI, no schema migration.

**Tech Stack:** TypeScript (strict), Prisma/Neon, Next.js App Router route handlers, Vercel `waitUntil`, AI SDK (`generateObject` via `@ai-sdk/gateway`, Haiku 4.5), Jest.

---

## Architecture notes (read before starting)

- **Layered architecture** (CLAUDE.md): Repository (Prisma only) → Service (logic) → API Route (thin) → CLI. Keep each task on its layer.
- **The `@ai-sdk/gateway` jest trap** (memory `project_ai_sdk_gateway_jest_trap`): any module that *statically* imports `ai`/`@ai-sdk/gateway` crashes Jest via `TransformStream`. Therefore `usage-judge.ts` (which statically imports `ai`) must only ever be reached by **dynamic `await import()`** from the audit service — never a static import. This mirrors how `lineage.service.ts:162` dynamic-imports `taskService` and `task-state.service.ts` dynamic-imports `layer2Service`.
- **No schema migration.** We deliberately avoid a per-session claim column. Idempotency comes from the *already-voted guard*: a session with any `usedAt`-stamped edge is skipped. The additive write is itself idempotent. The only cost of a rare concurrent double-fire is a duplicate (cheap) Haiku call, never data corruption. (This refines the design doc's "per-session claim" line — see the doc's idempotency section, which Task 11 updates to match.)
- **Worktree discipline** (memory `project_worktree_dev_loop`): run Jest from **inside** this worktree (`cd` first). Do NOT run `prisma generate` mid-plan (shared client via node_modules symlink); do `prisma generate` + `tsc` atomically once at the end (Task 11). Trust Jest during the plan.
- **Run a single test file** with: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-314-automate-fragment-usage-voting && npx jest <path> --no-coverage`.

## File structure

**New files**
- `lib/services/lineage/usage-judge.ts` — pure prompt builder + Zod schema + the (statically-AI-importing) `judgeFragmentUsage` model call.
- `lib/services/lineage/fragment-usage-audit.service.ts` — orchestrator: `auditForTask`, `auditDoneTaskSessions` (cron backstop). Dynamic-imports the judge.
- `lib/services/lineage/usage-signal.service.ts` — `getUsageSignalHealth(workspaceId)` → validation DTO.
- `app/api/lineage/signal/route.ts` — thin GET returning the signal-health DTO for the caller's workspace.
- `types/lineage-usage.ts` — shared DTO types (`UsageSignalHealth`) imported by both service and CLI-side response typing.
- Test files under `__tests__/` mirroring each.

**Modified files**
- `lib/repositories/lineage-edge.repository.ts` — `applyUsageVote` gains an options arg with `mode: 'replace' | 'additive'`; add `findVotedSessionIds`, `listUnvotedSessionIdsForDoneTasks`, and `usageSignalAggregates`.
- `lib/repositories/lineage-source.repository.ts` — add `contentByType` (richer per-type text for the judge), mirroring `labelsByType`.
- `lib/services/lineage.service.ts` — add `used` to `LineageFragmentEntry` and select it.
- `lib/services/task-state.service.ts` — fire `auditForTask` in the DONE branch.
- `app/api/cron/backfill-lineage-outcomes/route.ts` — also run the audit backstop.
- `cli/src/commands/task-lineage.ts` — usage marker per fragment + `--signal` flag.
- `.claude/skills/lumo/SKILL.md` — note auto-audit; `--used` remains manual override.
- `docs/superpowers/specs/2026-06-07-automate-fragment-usage-voting-design.md` — align idempotency note.

---

## Task 1: Additive (true-only) mode for `applyUsageVote`

**Files:**
- Modify: `lib/repositories/lineage-edge.repository.ts:286-313`
- Test: `__tests__/lib/repositories/lineage-edge-apply-usage-vote.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: { lineageEdge: { updateMany: jest.fn() } },
}))

const updateMany = prisma.lineageEdge.updateMany as jest.Mock

describe('applyUsageVote', () => {
  beforeEach(() => updateMany.mockReset().mockResolvedValue({ count: 1 }))

  const ref = { fragmentType: 'MEMORY' as const, fragmentId: 'm1' }

  it('replace mode (default) stamps true on voted and false on the rest', async () => {
    await lineageEdgeRepository.applyUsageVote('s1', [ref])
    // true write + false write = 2 calls
    expect(updateMany).toHaveBeenCalledTimes(2)
    const falseCall = updateMany.mock.calls.find(
      c => c[0].data.used === false
    )
    expect(falseCall).toBeTruthy()
    expect(falseCall![0].where).toMatchObject({ sessionId: 's1', NOT: expect.anything() })
  })

  it('additive mode stamps true on voted and NEVER writes false', async () => {
    await lineageEdgeRepository.applyUsageVote('s1', [ref], { mode: 'additive' })
    expect(updateMany).toHaveBeenCalledTimes(1)
    const call = updateMany.mock.calls[0]![0]
    expect(call.data).toEqual({ used: true, usedAt: expect.any(Date) })
    expect(call.where).toMatchObject({ sessionId: 's1', OR: [ref] })
  })

  it('additive mode with empty refs is a no-op (no writes at all)', async () => {
    const r = await lineageEdgeRepository.applyUsageVote('s1', [], { mode: 'additive' })
    expect(updateMany).not.toHaveBeenCalled()
    expect(r).toEqual({ used: 0, unused: 0 })
  })

  it('replace mode with empty refs stamps everything false (unchanged behavior)', async () => {
    updateMany.mockResolvedValue({ count: 3 })
    const r = await lineageEdgeRepository.applyUsageVote('s1', [])
    expect(updateMany).toHaveBeenCalledTimes(1)
    expect(updateMany.mock.calls[0]![0].data).toEqual({ used: false, usedAt: expect.any(Date) })
    expect(r).toEqual({ used: 0, unused: 3 })
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest __tests__/lib/repositories/lineage-edge-apply-usage-vote.test.ts --no-coverage`
Expected: FAIL — `applyUsageVote` doesn't accept an options arg; additive cases fail.

- [ ] **Step 3: Implement**

Replace the method at `lib/repositories/lineage-edge.repository.ts:286-313` with:

```ts
  /**
   * Record a usage vote over a session's edges.
   *
   * - `mode: 'replace'` (default, the manual `session wrap --used` path): voted
   *   refs → used=true, every OTHER edge of the session → used=false, all
   *   stamped usedAt=now. Last write wins.
   * - `mode: 'additive'` (the automatic LUM-314 judge): voted refs → used=true
   *   ONLY; every other edge is left untouched (stays NULL). Empty refs is a
   *   no-op. This guarantees the automatic path NEVER asserts used=false — an
   *   unproven "not used" is left honestly NULL.
   */
  async applyUsageVote(
    sessionId: string,
    usedRefs: FragmentRef[],
    opts: { mode?: 'replace' | 'additive'; tx?: Prisma.TransactionClient } = {}
  ): Promise<{ used: number; unused: number }> {
    const mode = opts.mode ?? 'replace'
    const client = opts.tx ?? prisma
    const now = new Date()

    if (usedRefs.length === 0) {
      if (mode === 'additive') return { used: 0, unused: 0 }
      const r = await client.lineageEdge.updateMany({
        where: { sessionId },
        data: { used: false, usedAt: now },
      })
      return { used: 0, unused: r.count }
    }

    const or = usedRefs.map(r => ({
      fragmentType: r.fragmentType,
      fragmentId: r.fragmentId,
    }))
    const usedRes = await client.lineageEdge.updateMany({
      where: { sessionId, OR: or },
      data: { used: true, usedAt: now },
    })
    if (mode === 'additive') return { used: usedRes.count, unused: 0 }

    const unusedRes = await client.lineageEdge.updateMany({
      where: { sessionId, NOT: { OR: or } },
      data: { used: false, usedAt: now },
    })
    return { used: usedRes.count, unused: unusedRes.count }
  },
```

- [ ] **Step 4: Update the one existing caller** (no behavior change — it relies on default replace mode). Confirm `lib/services/session.service.ts` calls `applyUsageVote(sessionId, usedRefs)` with no third arg; it stays valid. No edit needed. Grep to confirm:

Run: `grep -rn "applyUsageVote(" lib/ app/ cli/`
Expected: only `session.service.ts` calls it, with two args. If any call passed a `tx` positionally as the 3rd arg, change it to `{ tx }`. (Per the repo read, none do.)

- [ ] **Step 5: Run tests, verify pass**

Run: `npx jest __tests__/lib/repositories/lineage-edge-apply-usage-vote.test.ts --no-coverage`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/repositories/lineage-edge.repository.ts __tests__/lib/repositories/lineage-edge-apply-usage-vote.test.ts
git commit -m "feat: additive true-only mode for applyUsageVote [LUM-314]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Fragment content resolver (`contentByType`)

The judge needs each fragment's text to find evidence. Mirror `labelsByType` but return richer, less-truncated content. For MEMORY use the existing manifest line (carries scope + headline, enough to match against actions); for PR_REVIEW_TODO use the full comment body; for the rest use title/name fields.

**Files:**
- Modify: `lib/repositories/lineage-source.repository.ts` (add `contentByType` after `labelsByType`)
- Test: `__tests__/lib/repositories/lineage-source-content.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { lineageSourceRepository } from '@/lib/repositories/lineage-source.repository'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    memory: { findMany: jest.fn().mockResolvedValue([]) },
    taskSlackContext: { findMany: jest.fn().mockResolvedValue([]) },
    taskWebLink: { findMany: jest.fn().mockResolvedValue([]) },
    taskFigmaLink: { findMany: jest.fn().mockResolvedValue([]) },
    pullRequest: { findMany: jest.fn().mockResolvedValue([]) },
    prCommentMirror: { findMany: jest.fn().mockResolvedValue([]) },
    session: { findMany: jest.fn().mockResolvedValue([]) },
  },
}))

describe('contentByType', () => {
  it('returns full (untruncated) PR_REVIEW_TODO comment body', async () => {
    ;(prisma.prCommentMirror.findMany as jest.Mock).mockResolvedValue([
      { id: 't1', filePath: 'lib/x.ts', comment: { body: 'A'.repeat(300) } },
    ])
    const out = await lineageSourceRepository.contentByType(
      new Map([['PR_REVIEW_TODO', ['t1']]])
    )
    const text = out.get('PR_REVIEW_TODO::t1')!
    expect(text).toContain('lib/x.ts')
    expect(text.length).toBeGreaterThan(250) // not truncated to 80
  })

  it('keys web links by id with title + url', async () => {
    ;(prisma.taskWebLink.findMany as jest.Mock).mockResolvedValue([
      { id: 'w1', title: 'Neon pooling', url: 'https://neon.tech/x' },
    ])
    const out = await lineageSourceRepository.contentByType(
      new Map([['WEB_LINK', ['w1']]])
    )
    expect(out.get('WEB_LINK::w1')).toBe('Neon pooling — https://neon.tech/x')
  })

  it('only queries types present in the input map', async () => {
    await lineageSourceRepository.contentByType(new Map([['MEMORY', ['m1']]]))
    expect(prisma.memory.findMany).toHaveBeenCalled()
    expect(prisma.taskWebLink.findMany).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest __tests__/lib/repositories/lineage-source-content.test.ts --no-coverage`
Expected: FAIL — `contentByType` is not a function.

- [ ] **Step 3: Implement** — add to the `lineageSourceRepository` object in `lib/repositories/lineage-source.repository.ts`, after `labelsByType`:

```ts
  /**
   * Richer per-type text for the LUM-314 usage judge — same batched per-type
   * query shape as `labelsByType`, but returns fuller content (untruncated todo
   * bodies, title+url for links) so the judge has enough to trace a fragment to
   * a concrete action. Deleted sources are simply absent from the map.
   */
  async contentByType(
    refsByType: Map<LineageFragmentType, string[]>
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    const ids = (t: LineageFragmentType): string[] => refsByType.get(t) ?? []

    const memIds = ids('MEMORY')
    if (memIds.length > 0) {
      const rows = await prisma.memory.findMany({
        where: { id: { in: memIds } },
        select: { id: true, scope: true, category: true, content: true },
      })
      for (const r of rows) {
        out.set(
          key('MEMORY', r.id),
          memoryManifestLine({
            id: r.id,
            scope: r.scope,
            category: r.category,
            content: r.content,
          }).replace(/^- /, '')
        )
      }
    }

    const slackIds = ids('SLACK_CONTEXT')
    if (slackIds.length > 0) {
      const rows = await prisma.taskSlackContext.findMany({
        where: { id: { in: slackIds } },
        select: { id: true, slackChannelName: true, permalink: true },
      })
      for (const r of rows) {
        out.set(
          key('SLACK_CONTEXT', r.id),
          r.slackChannelName ? `#${r.slackChannelName}` : r.permalink
        )
      }
    }

    const webIds = ids('WEB_LINK')
    if (webIds.length > 0) {
      const rows = await prisma.taskWebLink.findMany({
        where: { id: { in: webIds } },
        select: { id: true, title: true, url: true },
      })
      for (const r of rows) {
        out.set(
          key('WEB_LINK', r.id),
          r.title ? `${r.title} — ${r.url}` : r.url
        )
      }
    }

    const figmaIds = ids('FIGMA')
    if (figmaIds.length > 0) {
      const rows = await prisma.taskFigmaLink.findMany({
        where: { id: { in: figmaIds } },
        select: { id: true, fileName: true, frameName: true },
      })
      for (const r of rows) {
        out.set(
          key('FIGMA', r.id),
          r.frameName ? `${r.fileName} / ${r.frameName}` : r.fileName
        )
      }
    }

    const prIds = ids('PR')
    if (prIds.length > 0) {
      const rows = await prisma.pullRequest.findMany({
        where: { id: { in: prIds } },
        select: { id: true, number: true, title: true },
      })
      for (const r of rows) {
        out.set(key('PR', r.id), `#${r.number} ${r.title}`)
      }
    }

    const todoIds = ids('PR_REVIEW_TODO')
    if (todoIds.length > 0) {
      const rows = await prisma.prCommentMirror.findMany({
        where: { id: { in: todoIds } },
        select: { id: true, filePath: true, comment: { select: { body: true } } },
      })
      for (const r of rows) {
        const loc = r.filePath ? `${r.filePath}: ` : ''
        out.set('PR_REVIEW_TODO::' + r.id, loc + stripHtml(r.comment.body))
      }
    }

    const sessionIds = ids('SESSION')
    if (sessionIds.length > 0) {
      const rows = await prisma.session.findMany({
        where: { id: { in: sessionIds } },
        select: { id: true, summary: true },
      })
      for (const r of rows) {
        out.set('SESSION::' + r.id, r.summary ?? `Session ${r.id.slice(0, 8)}`)
      }
    }

    return out
  },
```

> Note: `key()`, `stripHtml()`, `memoryManifestLine` are already imported/defined at the top of the file (used by `labelsByType`). If `tsc` later flags a missing field (e.g. `Session.summary`), select the correct field name — `session.repository.ts:listForTask` selects `summary`, so it exists.

- [ ] **Step 4: Run tests, verify pass**

Run: `npx jest __tests__/lib/repositories/lineage-source-content.test.ts --no-coverage`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/lineage-source.repository.ts __tests__/lib/repositories/lineage-source-content.test.ts
git commit -m "feat: contentByType resolver for usage judge [LUM-314]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: The usage judge — prompt + schema + model call

Split into a **pure** prompt builder + Zod schema (unit-tested) and a thin `judgeFragmentUsage` that calls `generateObject` (not unit-tested, mirrors `layer1-extract`). This file statically imports `ai` — it must only be reached via dynamic import (Task 5).

**Files:**
- Create: `lib/services/lineage/usage-judge.ts`
- Test: `__tests__/lib/services/lineage/usage-judge-prompt.test.ts`

- [ ] **Step 1: Write the failing test (pure parts only)**

```ts
import {
  buildUsageJudgePrompt,
  usageJudgeSchema,
  type JudgeFragment,
} from '@/lib/services/lineage/usage-judge'

const fragments: JudgeFragment[] = [
  { fragmentType: 'MEMORY', fragmentId: 'm1', content: 'Prisma drift workaround: run db execute + migrate resolve' },
  { fragmentType: 'WEB_LINK', fragmentId: 'w1', content: 'Neon pooling docs' },
]

describe('buildUsageJudgePrompt', () => {
  it('includes every fragment with a stable handle and its content', () => {
    const { system, user } = buildUsageJudgePrompt({
      taskTitle: 'Fix drift',
      fragments,
      eventLog: 'Bash "npx prisma db execute" OK',
    })
    expect(system).toMatch(/evidence/i)
    expect(system).toMatch(/abstain|NULL|only/i)
    expect(user).toContain('MEMORY::m1')
    expect(user).toContain('Prisma drift workaround')
    expect(user).toContain('WEB_LINK::w1')
    expect(user).toContain('npx prisma db execute')
  })

  it('schema accepts confident-used refs and rejects unknown fragmentType', () => {
    const ok = usageJudgeSchema.safeParse({
      used: [{ fragmentType: 'MEMORY', fragmentId: 'm1', evidence: 'ran db execute' }],
    })
    expect(ok.success).toBe(true)
    const bad = usageJudgeSchema.safeParse({
      used: [{ fragmentType: 'NOPE', fragmentId: 'x', evidence: 'e' }],
    })
    expect(bad.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest __tests__/lib/services/lineage/usage-judge-prompt.test.ts --no-coverage`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `lib/services/lineage/usage-judge.ts`**

```ts
import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import type { LineageFragmentType } from '@prisma/client'

const MODEL_ID = 'anthropic/claude-haiku-4-5'

const FRAGMENT_TYPES = [
  'MEMORY',
  'SLACK_CONTEXT',
  'WEB_LINK',
  'FIGMA',
  'PR',
  'PR_REVIEW_TODO',
  'SESSION',
] as const

export interface JudgeFragment {
  fragmentType: LineageFragmentType
  fragmentId: string
  content: string
}

export interface JudgeInput {
  taskTitle: string
  fragments: JudgeFragment[]
  /** Compacted event log of what the agent actually did this session. */
  eventLog: string
}

export const usageJudgeSchema = z.object({
  used: z.array(
    z.object({
      fragmentType: z.enum(FRAGMENT_TYPES),
      fragmentId: z.string(),
      evidence: z.string(),
    })
  ),
})
export type UsageJudgeOutput = z.infer<typeof usageJudgeSchema>

const SYSTEM_PROMPT = `You audit whether injected context fragments were actually USED by a coding agent.

You are given (1) a list of context fragments injected at the start of the agent's session, each with a stable handle "TYPE::id", and (2) a compacted log of what the agent actually DID (files read/edited, commands run, conclusions).

For each fragment, decide it was USED **only** when the log contains concrete evidence that traces to it — e.g. the agent edited a file the fragment names, ran a command the fragment prescribes, or its stated conclusion clearly follows the fragment's content. Quote the specific log evidence.

Rules, in priority order:
- If there is NO concrete evidence, OMIT the fragment. Do not guess. Abstaining is correct and expected — most reference fragments will be omitted.
- "Looks relevant" or "could have helped" is NOT evidence. Only actions in the log are.
- Never invent evidence. The "evidence" must be a phrase that appears in or directly summarizes the log.
- Output ONLY the fragments you are confident were used. Never output a "not used" verdict.`

export function buildUsageJudgePrompt(input: JudgeInput): {
  system: string
  user: string
} {
  const fragLines = input.fragments
    .map(
      f => `- ${f.fragmentType}::${f.fragmentId}\n    ${f.content.replace(/\n+/g, ' ').slice(0, 600)}`
    )
    .join('\n')
  const user = `Task: ${input.taskTitle}

## Injected fragments
${fragLines}

## What the agent did (compacted event log)
${input.eventLog}

Return only the fragments with concrete evidence of use.`
  return { system: SYSTEM_PROMPT, user }
}

/**
 * Call the judge. Returns confident-used refs (with evidence) only — empty
 * array on any model error (best-effort: a failed audit must never throw, the
 * edges simply stay NULL). Statically imports the AI SDK, so callers MUST reach
 * this via dynamic import to avoid the @ai-sdk/gateway jest TransformStream trap.
 */
export async function judgeFragmentUsage(
  input: JudgeInput
): Promise<UsageJudgeOutput['used']> {
  if (input.fragments.length === 0) return []
  const { system, user } = buildUsageJudgePrompt(input)
  try {
    const { object } = await generateObject({
      model: gateway(MODEL_ID),
      schema: usageJudgeSchema,
      system,
      prompt: user,
    })
    // Defend against hallucinated handles: keep only refs that were offered.
    const offered = new Set(
      input.fragments.map(f => `${f.fragmentType}::${f.fragmentId}`)
    )
    return object.used.filter(u =>
      offered.has(`${u.fragmentType}::${u.fragmentId}`)
    )
  } catch (error) {
    console.error('[lineage.usageJudge] judge failed:', error)
    return []
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx jest __tests__/lib/services/lineage/usage-judge-prompt.test.ts --no-coverage`
Expected: PASS (2 tests). The test imports only the pure exports; `generateObject` is never invoked, so the gateway trap doesn't fire here.

- [ ] **Step 5: Commit**

```bash
git add lib/services/lineage/usage-judge.ts __tests__/lib/services/lineage/usage-judge-prompt.test.ts
git commit -m "feat: evidence-gated fragment usage judge [LUM-314]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Repo helpers for the audit (voted-session guard + done-task sessions)

**Files:**
- Modify: `lib/repositories/lineage-edge.repository.ts` (add two methods)
- Test: `__tests__/lib/repositories/lineage-edge-audit-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: { lineageEdge: { findMany: jest.fn(), groupBy: jest.fn() } },
}))

describe('findVotedSessionIds', () => {
  it('returns the set of session ids that already have any usedAt-stamped edge', async () => {
    ;(prisma.lineageEdge.findMany as jest.Mock).mockResolvedValue([
      { sessionId: 's1' },
      { sessionId: 's1' },
    ])
    const out = await lineageEdgeRepository.findVotedSessionIds(['s1', 's2'])
    expect(out).toEqual(new Set(['s1']))
    expect((prisma.lineageEdge.findMany as jest.Mock).mock.calls[0][0].where).toMatchObject({
      sessionId: { in: ['s1', 's2'] },
      usedAt: { not: null },
    })
  })
})

describe('listUnvotedSessionIdsForDoneTasks', () => {
  it('returns distinct session ids of DONE-task edges with no usedAt, capped by limit', async () => {
    ;(prisma.lineageEdge.groupBy as jest.Mock).mockResolvedValue([
      { sessionId: 'a' },
      { sessionId: 'b' },
    ])
    const out = await lineageEdgeRepository.listUnvotedSessionIdsForDoneTasks(50)
    expect(out).toEqual(['a', 'b'])
    const arg = (prisma.lineageEdge.groupBy as jest.Mock).mock.calls[0][0]
    expect(arg.by).toEqual(['sessionId'])
    expect(arg.where).toMatchObject({
      sessionId: { not: null },
      usedAt: null,
      task: { status: 'DONE' },
    })
    expect(arg.take).toBe(50)
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest __tests__/lib/repositories/lineage-edge-audit-helpers.test.ts --no-coverage`
Expected: FAIL — methods don't exist.

- [ ] **Step 3: Implement** — add to `lineageEdgeRepository` (after `findSessionFragmentEdges`):

```ts
  /**
   * Of the given sessions, which already carry a usage vote (any usedAt-stamped
   * edge)? The automatic audit skips these — a human vote (or a prior auto pass)
   * is authoritative. This is the LUM-314 idempotency guard.
   */
  async findVotedSessionIds(
    sessionIds: string[],
    tx?: Prisma.TransactionClient
  ): Promise<Set<string>> {
    if (sessionIds.length === 0) return new Set()
    const client = tx ?? prisma
    const rows = await client.lineageEdge.findMany({
      where: { sessionId: { in: sessionIds }, usedAt: { not: null } },
      select: { sessionId: true },
      distinct: ['sessionId'],
    })
    return new Set(rows.map(r => r.sessionId).filter((s): s is string => !!s))
  },

  /**
   * Distinct session ids that (a) belong to a DONE task and (b) have at least
   * one not-yet-voted edge (usedAt = null). The cron backstop's work-list;
   * `limit` bounds each run so the first sweeps drain the dormant backlog over a
   * few hours instead of firing thousands of judge calls at once.
   */
  async listUnvotedSessionIdsForDoneTasks(
    limit: number,
    tx?: Prisma.TransactionClient
  ): Promise<string[]> {
    const client = tx ?? prisma
    const rows = await client.lineageEdge.groupBy({
      by: ['sessionId'],
      where: { sessionId: { not: null }, usedAt: null, task: { status: 'DONE' } },
      take: limit,
    })
    return rows
      .map(r => r.sessionId)
      .filter((s): s is string => s !== null)
  },
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx jest __tests__/lib/repositories/lineage-edge-audit-helpers.test.ts --no-coverage`
Expected: PASS (2 tests).

> If `tsc` (Task 11) rejects `take` on `groupBy` without an `orderBy`, add `orderBy: { sessionId: 'asc' }` to the query.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/lineage-edge.repository.ts __tests__/lib/repositories/lineage-edge-audit-helpers.test.ts
git commit -m "feat: audit work-list + voted-session guard repo helpers [LUM-314]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: The audit orchestrator service

`auditSession(sessionId, taskId, taskTitle)` does one session: load edges → resolve content → compact the session's full event log → dynamic-import + call the judge → additive vote. `auditForTask(taskId)` enumerates the task's sessions, skips voted ones, and runs each. Best-effort: never throws.

**Files:**
- Create: `lib/services/lineage/fragment-usage-audit.service.ts`
- Test: `__tests__/lib/services/lineage/fragment-usage-audit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { fragmentUsageAuditService } from '@/lib/services/lineage/fragment-usage-audit.service'

jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { listForTask: jest.fn(), listEventsForSession: jest.fn() },
}))
jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: {
    findVotedSessionIds: jest.fn(),
    findSessionFragmentEdges: jest.fn(),
    applyUsageVote: jest.fn().mockResolvedValue({ used: 1, unused: 0 }),
  },
}))
jest.mock('@/lib/repositories/lineage-source.repository', () => ({
  lineageSourceRepository: { contentByType: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { getTitleAndStatus: jest.fn() },
}))
// Dynamic-imported judge — mock the module.
const judgeMock = jest.fn()
jest.mock('@/lib/services/lineage/usage-judge', () => ({
  judgeFragmentUsage: (...a: unknown[]) => judgeMock(...a),
}))

import { sessionRepository } from '@/lib/repositories/session.repository'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { lineageSourceRepository } from '@/lib/repositories/lineage-source.repository'
import { taskRepository } from '@/lib/repositories/task.repository'

const ref = { fragmentType: 'MEMORY' as const, fragmentId: 'm1' }

beforeEach(() => {
  jest.clearAllMocks()
  ;(taskRepository.getTitleAndStatus as jest.Mock).mockResolvedValue({
    title: 'T', status: 'DONE',
  })
  ;(sessionRepository.listForTask as jest.Mock).mockResolvedValue([{ id: 's1' }])
  ;(lineageEdgeRepository.findVotedSessionIds as jest.Mock).mockResolvedValue(new Set())
  ;(lineageEdgeRepository.findSessionFragmentEdges as jest.Mock).mockResolvedValue([
    { ...ref, used: null, usedAt: null },
  ])
  ;(lineageSourceRepository.contentByType as jest.Mock).mockResolvedValue(
    new Map([['MEMORY::m1', 'prisma drift workaround']])
  )
  ;(sessionRepository.listEventsForSession as jest.Mock).mockResolvedValue([
    { id: 'e1', type: 'PRE_TOOL_USE', toolName: 'Bash', payload: { tool_input: { command: 'prisma db execute' } }, createdAt: new Date() },
    { id: 'e2', type: 'STOP', toolName: null, payload: {}, createdAt: new Date() },
  ])
})

describe('auditForTask', () => {
  it('votes additively on judge-confirmed fragments', async () => {
    judgeMock.mockResolvedValue([{ fragmentType: 'MEMORY', fragmentId: 'm1', evidence: 'ran db execute' }])
    await fragmentUsageAuditService.auditForTask('task1')
    expect(lineageEdgeRepository.applyUsageVote).toHaveBeenCalledWith(
      's1',
      [{ fragmentType: 'MEMORY', fragmentId: 'm1' }],
      { mode: 'additive' }
    )
  })

  it('skips a session that already has a vote (guard)', async () => {
    ;(lineageEdgeRepository.findVotedSessionIds as jest.Mock).mockResolvedValue(new Set(['s1']))
    await fragmentUsageAuditService.auditForTask('task1')
    expect(judgeMock).not.toHaveBeenCalled()
    expect(lineageEdgeRepository.applyUsageVote).not.toHaveBeenCalled()
  })

  it('when the judge confirms nothing, writes no vote (edges stay NULL)', async () => {
    judgeMock.mockResolvedValue([])
    await fragmentUsageAuditService.auditForTask('task1')
    expect(lineageEdgeRepository.applyUsageVote).not.toHaveBeenCalled()
  })

  it('never throws when a repo rejects', async () => {
    ;(sessionRepository.listForTask as jest.Mock).mockRejectedValue(new Error('db down'))
    await expect(fragmentUsageAuditService.auditForTask('task1')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest __tests__/lib/services/lineage/fragment-usage-audit.test.ts --no-coverage`
Expected: FAIL — service + `taskRepository.getTitleAndStatus` don't exist.

- [ ] **Step 3a: Add `taskRepository.getTitleAndStatus`** in `lib/repositories/task.repository.ts` (near the existing `getStatus`):

```ts
  async getTitleAndStatus(taskId: string) {
    return prisma.task.findUnique({
      where: { id: taskId },
      select: { title: true, status: true },
    })
  },
```

- [ ] **Step 3b: Implement the service** `lib/services/lineage/fragment-usage-audit.service.ts`:

```ts
import { sessionRepository } from '@/lib/repositories/session.repository'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { lineageSourceRepository } from '@/lib/repositories/lineage-source.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import {
  compactEvents,
  type RawEvent,
} from '@/lib/services/session-summary/compact-events'
import { logger } from '@/lib/logger'
import type { LineageFragmentType } from '@prisma/client'
import type { JudgeFragment } from '@/lib/services/lineage/usage-judge'

/**
 * Audit one session: which injected fragments did the agent actually use?
 * Evidence-gated — the judge sees the fragments + the session's event log and
 * votes used=true ONLY with concrete evidence; everything else stays NULL.
 * Additive vote: never writes false. Best-effort, never throws.
 */
async function auditSession(
  sessionId: string,
  taskTitle: string
): Promise<void> {
  const edges = await lineageEdgeRepository.findSessionFragmentEdges(sessionId)
  if (edges.length === 0) return

  // Resolve fragment content (batched per type).
  const refsByType = new Map<LineageFragmentType, string[]>()
  for (const e of edges) {
    const arr = refsByType.get(e.fragmentType) ?? []
    arr.push(e.fragmentId)
    refsByType.set(e.fragmentType, arr)
  }
  const contentMap = await lineageSourceRepository.contentByType(refsByType)
  const fragments: JudgeFragment[] = edges.map(e => ({
    fragmentType: e.fragmentType,
    fragmentId: e.fragmentId,
    content: contentMap.get(`${e.fragmentType}::${e.fragmentId}`) ?? e.fragmentId,
  }))

  // Compact the WHOLE session's event log as the evidence base.
  const events = await sessionRepository.listEventsForSession(sessionId)
  const eventLog = compactEvents(events as unknown as RawEvent[], {
    maxToolCalls: 200,
  }).text
  if (eventLog.trim().length === 0) return

  // Dynamic import keeps the @ai-sdk/gateway static graph out of this service's
  // (and its callers') jest path — see project_ai_sdk_gateway_jest_trap.
  const { judgeFragmentUsage } = await import(
    '@/lib/services/lineage/usage-judge'
  )
  const confirmed = await judgeFragmentUsage({ taskTitle, fragments, eventLog })
  if (confirmed.length === 0) return

  await lineageEdgeRepository.applyUsageVote(
    sessionId,
    confirmed.map(c => ({ fragmentType: c.fragmentType, fragmentId: c.fragmentId })),
    { mode: 'additive' }
  )
  logger.debug(
    `[lineage.usageAudit] session=${sessionId} voted used=${confirmed.length}/${edges.length}`
  )
}

export const fragmentUsageAuditService = {
  /**
   * Audit every not-yet-voted session of a task. Fired from task→DONE (and the
   * cron backstop). Idempotent via the voted-session guard. Best-effort.
   */
  async auditForTask(taskId: string): Promise<void> {
    try {
      const task = await taskRepository.getTitleAndStatus(taskId)
      if (!task) return
      const sessions = await sessionRepository.listForTask(taskId)
      const ids = sessions.map(s => s.id)
      if (ids.length === 0) return
      const voted = await lineageEdgeRepository.findVotedSessionIds(ids)
      for (const id of ids) {
        if (voted.has(id)) continue
        try {
          await auditSession(id, task.title)
        } catch (err) {
          logger.error(`[lineage.usageAudit] session=${id} failed`, err)
        }
      }
    } catch (err) {
      logger.error(`[lineage.usageAudit] task=${taskId} failed`, err)
    }
  },

  /**
   * Cron backstop: audit up to `limit` not-yet-voted sessions of DONE tasks.
   * Returns how many sessions it processed and how many remain (logged, never
   * silently truncated). Drains the dormant production backlog over time.
   */
  async auditDoneTaskSessions(
    limit: number
  ): Promise<{ processed: number; sessionIds: string[] }> {
    const sessionIds =
      await lineageEdgeRepository.listUnvotedSessionIdsForDoneTasks(limit)
    for (const id of sessionIds) {
      try {
        const edges = await lineageEdgeRepository.findSessionFragmentEdges(id)
        if (edges.length === 0) continue
        // Title via the task on any edge — fetch lazily per session.
        const task = await sessionRepository.findTaskTitleForSession(id)
        if (!task) continue
        await auditSession(id, task.title)
      } catch (err) {
        logger.error(`[lineage.usageAudit] cron session=${id} failed`, err)
      }
    }
    return { processed: sessionIds.length, sessionIds }
  },
}
```

- [ ] **Step 3c: Add `sessionRepository.findTaskTitleForSession`** in `lib/repositories/session.repository.ts`:

```ts
  async findTaskTitleForSession(sessionId: string) {
    const row = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { task: { select: { title: true } } },
    })
    return row?.task ?? null
  },
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx jest __tests__/lib/services/lineage/fragment-usage-audit.test.ts --no-coverage`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/lineage/fragment-usage-audit.service.ts lib/repositories/task.repository.ts lib/repositories/session.repository.ts __tests__/lib/services/lineage/fragment-usage-audit.test.ts
git commit -m "feat: fragment-usage audit orchestrator [LUM-314]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Fire the audit on task→DONE

**Files:**
- Modify: `lib/services/task-state.service.ts` (DONE branch, ~line 313, beside `stampForTaskDone`)
- Test: extend the existing task-state test if one asserts DONE side effects; otherwise a focused new test.

- [ ] **Step 1: Write the failing test** `__tests__/lib/services/task-state-usage-audit.test.ts`

```ts
// Verify the DONE branch invokes the audit. We assert via a spy on the
// dynamically-imported service. Mock the heavy graph minimally.
const auditForTask = jest.fn().mockResolvedValue(undefined)
jest.mock('@/lib/services/lineage/fragment-usage-audit.service', () => ({
  fragmentUsageAuditService: { auditForTask: (...a: unknown[]) => auditForTask(...a) },
}))

// waitUntil should run the thunk synchronously in tests.
jest.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => p }))

import { dispatchDoneAudit } from '@/lib/services/task-state.service'

it('dispatchDoneAudit triggers the usage audit for the task', async () => {
  await dispatchDoneAudit('task1')
  expect(auditForTask).toHaveBeenCalledWith('task1')
})
```

> Rationale: `updateTaskWithSideEffects` is large and side-effect heavy. Extract the audit dispatch into a tiny exported helper `dispatchDoneAudit(taskId)` so it is unit-testable in isolation, then call it from the DONE branch. This follows the existing `stampLineageInBackground` helper pattern in the same file.

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest __tests__/lib/services/task-state-usage-audit.test.ts --no-coverage`
Expected: FAIL — `dispatchDoneAudit` is not exported.

- [ ] **Step 3: Implement** — in `lib/services/task-state.service.ts`, add the helper near `stampLineageInBackground`:

```ts
/**
 * Fire the LUM-314 fragment-usage audit for a just-completed task. Dynamic
 * import keeps the judge's @ai-sdk/gateway graph out of this module's static
 * graph (jest trap). Best-effort — the service swallows its own errors.
 */
export function dispatchDoneAudit(taskId: string): void {
  waitUntil(
    (async () => {
      const { fragmentUsageAuditService } = await import(
        '@/lib/services/lineage/fragment-usage-audit.service'
      )
      await fragmentUsageAuditService.auditForTask(taskId)
    })()
  )
}
```

Then in the DONE branch (right after `stampLineageInBackground(s => s.stampForTaskDone(taskId))`):

```ts
    // LUM-314: evidence-gated fragment-usage audit (used + outcome land together).
    dispatchDoneAudit(taskId)
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx jest __tests__/lib/services/task-state-usage-audit.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/task-state.service.ts __tests__/lib/services/task-state-usage-audit.test.ts
git commit -m "feat: trigger fragment-usage audit on task completion [LUM-314]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Cron backstop

**Files:**
- Modify: `app/api/cron/backfill-lineage-outcomes/route.ts`
- Test: `__tests__/app/api/cron/backfill-lineage-usage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
const sweepDoneTaskEdges = jest.fn().mockResolvedValue({ count: 2 })
const auditDoneTaskSessions = jest.fn().mockResolvedValue({ processed: 3, sessionIds: ['a','b','c'] })
jest.mock('@/lib/services/lineage-outcome.service', () => ({
  lineageOutcomeService: { sweepDoneTaskEdges: () => sweepDoneTaskEdges() },
}))
jest.mock('@/lib/services/lineage/fragment-usage-audit.service', () => ({
  fragmentUsageAuditService: { auditDoneTaskSessions: (n: number) => auditDoneTaskSessions(n) },
}))

import { GET } from '@/app/api/cron/backfill-lineage-outcomes/route'

it('rejects without the cron secret', async () => {
  const res = await GET(new Request('http://x', { headers: {} }) as never)
  expect(res.status).toBe(401)
})

it('runs both the outcome sweep and the usage audit batch', async () => {
  process.env.CRON_SECRET = 'sek'
  const res = await GET(
    new Request('http://x', { headers: { authorization: 'Bearer sek' } }) as never
  )
  expect(sweepDoneTaskEdges).toHaveBeenCalled()
  expect(auditDoneTaskSessions).toHaveBeenCalledWith(expect.any(Number))
  const body = await res.json()
  expect(body.usage.processed).toBe(3)
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest __tests__/app/api/cron/backfill-lineage-usage.test.ts --no-coverage`
Expected: FAIL — route doesn't call the audit; body has no `usage`.

- [ ] **Step 3: Implement** — replace `app/api/cron/backfill-lineage-outcomes/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { lineageOutcomeService } from '@/lib/services/lineage-outcome.service'
import { fragmentUsageAuditService } from '@/lib/services/lineage/fragment-usage-audit.service'

/** Per-run cap on usage audits — bounds the LLM burst so the first sweeps drain
 *  the dormant backlog over a few hours, not all at once. */
const USAGE_AUDIT_BATCH = 25

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const outcomes = await lineageOutcomeService.sweepDoneTaskEdges()
  const usage =
    await fragmentUsageAuditService.auditDoneTaskSessions(USAGE_AUDIT_BATCH)
  return NextResponse.json({ outcomes, usage: { processed: usage.processed } })
}
```

> Note: `fragmentUsageAuditService` statically imports only repos + dynamic-imports the judge, so importing it here does not drag the gateway into the route's static graph. Confirm the cron test passes (it would crash on import if the trap fired).

- [ ] **Step 4: Run tests, verify pass**

Run: `npx jest __tests__/app/api/cron/backfill-lineage-usage.test.ts --no-coverage`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/backfill-lineage-outcomes/route.ts __tests__/app/api/cron/backfill-lineage-usage.test.ts
git commit -m "feat: cron backstop audits dormant DONE-task sessions [LUM-314]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Signal-health (validation) — types + repo aggregate + service

`getUsageSignalHealth(workspaceId)` returns: distribution (true/false/null), per-session variance of `used/total-injected` (NON-trivial because additive voting never writes false — variance over voted-fraction-of-all-injected, not voted-fraction-of-voted), and used vs base merge rate (discrimination).

**Files:**
- Create: `types/lineage-usage.ts`
- Modify: `lib/repositories/lineage-edge.repository.ts` (add `usageSignalAggregates`)
- Create: `lib/services/lineage/usage-signal.service.ts`
- Test: `__tests__/lib/services/lineage/usage-signal.test.ts`

- [ ] **Step 1: Create the shared type** `types/lineage-usage.ts`:

```ts
export interface UsageSignalHealth {
  distribution: { used: number; unused: number; abstained: number }
  /** Population variance of per-session (used / injected) across sessions that
   *  carry ≥1 vote. ~0 means the judge is acting like a constant. */
  perSessionVariance: number
  votedSessions: number
  /** Task-deduped merge rate among used=true edges vs the base resolved rate.
   *  usedMergeRate meaningfully above baseMergeRate ⇒ the signal discriminates. */
  usedMergeRate: number | null
  baseMergeRate: number | null
  usedResolvedTasks: number
  baseResolvedTasks: number
}
```

- [ ] **Step 2: Write the failing service test**

```ts
import { usageSignalService } from '@/lib/services/lineage/usage-signal.service'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'

jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: { usageSignalAggregates: jest.fn() },
}))

it('computes distribution, variance, and discrimination', async () => {
  ;(lineageEdgeRepository.usageSignalAggregates as jest.Mock).mockResolvedValue({
    distribution: { used: 6, unused: 0, abstained: 4 },
    // two sessions: s1 used 3/3, s2 used 3/7 → fractions 1.0 and 0.4286
    perSession: [
      { sessionId: 's1', injected: 3, used: 3 },
      { sessionId: 's2', injected: 7, used: 3 },
    ],
    usedTasks: [
      { taskId: 't1', resolved: true, merged: true },
      { taskId: 't2', resolved: true, merged: false },
    ],
    baseTasks: [
      { taskId: 't1', resolved: true, merged: true },
      { taskId: 't2', resolved: true, merged: false },
      { taskId: 't3', resolved: true, merged: false },
      { taskId: 't4', resolved: true, merged: false },
    ],
  })
  const h = await usageSignalService.getUsageSignalHealth('ws1')
  expect(h.distribution).toEqual({ used: 6, unused: 0, abstained: 4 })
  expect(h.votedSessions).toBe(2)
  expect(h.perSessionVariance).toBeGreaterThan(0) // not a constant
  expect(h.usedMergeRate).toBeCloseTo(0.5) // 1/2
  expect(h.baseMergeRate).toBeCloseTo(0.25) // 1/4
})

it('returns null merge rates when there are no resolved tasks', async () => {
  ;(lineageEdgeRepository.usageSignalAggregates as jest.Mock).mockResolvedValue({
    distribution: { used: 0, unused: 0, abstained: 0 },
    perSession: [],
    usedTasks: [],
    baseTasks: [],
  })
  const h = await usageSignalService.getUsageSignalHealth('ws1')
  expect(h.usedMergeRate).toBeNull()
  expect(h.baseMergeRate).toBeNull()
  expect(h.perSessionVariance).toBe(0)
})
```

- [ ] **Step 3: Run it, verify it fails**

Run: `npx jest __tests__/lib/services/lineage/usage-signal.test.ts --no-coverage`
Expected: FAIL — service + repo method don't exist.

- [ ] **Step 4a: Implement the repo aggregate** — add to `lineageEdgeRepository`:

```ts
  /**
   * Raw aggregates backing the LUM-314 signal-health view, workspace-scoped.
   * The service derives variance + merge-rate percentages. Four cheap groupBys.
   */
  async usageSignalAggregates(workspaceId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma

    const distRows = await client.lineageEdge.groupBy({
      by: ['used'],
      where: { workspaceId },
      _count: { _all: true },
    })
    const distribution = { used: 0, unused: 0, abstained: 0 }
    for (const r of distRows) {
      const n = r._count._all
      if (r.used === true) distribution.used += n
      else if (r.used === false) distribution.unused += n
      else distribution.abstained += n
    }

    // Per-session injected total + used count (sessions with ≥1 vote).
    const perSessionRows = await client.lineageEdge.groupBy({
      by: ['sessionId', 'used'],
      where: { workspaceId, sessionId: { not: null } },
      _count: { _all: true },
    })
    const bySession = new Map<string, { injected: number; used: number; voted: boolean }>()
    for (const r of perSessionRows) {
      if (!r.sessionId) continue
      const acc = bySession.get(r.sessionId) ?? { injected: 0, used: 0, voted: false }
      acc.injected += r._count._all
      if (r.used === true) acc.used += r._count._all
      if (r.used !== null) acc.voted = true
      bySession.set(r.sessionId, acc)
    }
    const perSession = [...bySession.entries()]
      .filter(([, v]) => v.voted)
      .map(([sessionId, v]) => ({ sessionId, injected: v.injected, used: v.used }))

    const usedTasks = await taskMergeRows(client, { workspaceId, used: true })
    const baseTasks = await taskMergeRows(client, {
      workspaceId,
      outcome: { not: 'UNKNOWN' as const },
    })

    return { distribution, perSession, usedTasks, baseTasks }
  },
```

And a module-private helper at the bottom of the file (outside the exported object):

```ts
async function taskMergeRows(
  client: Prisma.TransactionClient | typeof prisma,
  where: Prisma.LineageEdgeWhereInput
): Promise<{ taskId: string; resolved: boolean; merged: boolean }[]> {
  const rows = await client.lineageEdge.groupBy({
    by: ['taskId', 'outcome'],
    where,
  })
  const byTask = new Map<string, { resolved: boolean; merged: boolean }>()
  for (const r of rows) {
    const acc = byTask.get(r.taskId) ?? { resolved: false, merged: false }
    if (r.outcome !== 'UNKNOWN') acc.resolved = true
    if (r.outcome === 'MERGED') acc.merged = true
    byTask.set(r.taskId, acc)
  }
  return [...byTask.entries()].map(([taskId, v]) => ({ taskId, ...v }))
}
```

- [ ] **Step 4b: Implement the service** `lib/services/lineage/usage-signal.service.ts`:

```ts
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import type { UsageSignalHealth } from '@/types/lineage-usage'

function mergeRate(
  tasks: { resolved: boolean; merged: boolean }[]
): { rate: number | null; resolved: number } {
  const resolved = tasks.filter(t => t.resolved).length
  if (resolved === 0) return { rate: null, resolved: 0 }
  const merged = tasks.filter(t => t.merged).length
  return { rate: merged / resolved, resolved }
}

function populationVariance(xs: number[]): number {
  if (xs.length === 0) return 0
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  return xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length
}

export const usageSignalService = {
  async getUsageSignalHealth(workspaceId: string): Promise<UsageSignalHealth> {
    const agg = await lineageEdgeRepository.usageSignalAggregates(workspaceId)
    const fractions = agg.perSession
      .filter(s => s.injected > 0)
      .map(s => s.used / s.injected)
    const used = mergeRate(agg.usedTasks)
    const base = mergeRate(agg.baseTasks)
    return {
      distribution: agg.distribution,
      perSessionVariance: populationVariance(fractions),
      votedSessions: agg.perSession.length,
      usedMergeRate: used.rate,
      baseMergeRate: base.rate,
      usedResolvedTasks: used.resolved,
      baseResolvedTasks: base.resolved,
    }
  },
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npx jest __tests__/lib/services/lineage/usage-signal.test.ts --no-coverage`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add types/lineage-usage.ts lib/repositories/lineage-edge.repository.ts lib/services/lineage/usage-signal.service.ts __tests__/lib/services/lineage/usage-signal.test.ts
git commit -m "feat: usage signal-health validation (distribution/variance/discrimination) [LUM-314]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Signal-health API endpoint

**Files:**
- Create: `app/api/lineage/signal/route.ts`
- Test: `__tests__/app/api/lineage-signal.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
const getUsageSignalHealth = jest.fn()
jest.mock('@/lib/services/lineage/usage-signal.service', () => ({
  usageSignalService: { getUsageSignalHealth: (ws: string) => getUsageSignalHealth(ws) },
}))
jest.mock('@/lib/auth/identity', () => ({
  requireIdentity: jest.fn(),
}))
import { requireIdentity } from '@/lib/auth/identity'
import { GET } from '@/app/api/lineage/signal/route'

it('returns the signal-health DTO for the caller workspace', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue({ workspaceId: 'ws1', memberId: 'm1' })
  getUsageSignalHealth.mockResolvedValue({ distribution: { used: 1, unused: 0, abstained: 2 } })
  const res = await GET(new Request('http://x'))
  expect(getUsageSignalHealth).toHaveBeenCalledWith('ws1')
  expect((await res.json()).distribution.used).toBe(1)
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest __tests__/app/api/lineage-signal.test.ts --no-coverage`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Implement** `app/api/lineage/signal/route.ts` (mirror `app/api/tasks/lineage/[identifier]/route.ts`):

```ts
import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { usageSignalService } from '@/lib/services/lineage/usage-signal.service'

export async function GET(request: Request): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  const health = await usageSignalService.getUsageSignalHealth(
    identity.workspaceId
  )
  return NextResponse.json(health)
}
```

> Confirm the `requireIdentity` return shape (`identity.workspaceId`) against `app/api/tasks/lineage/[identifier]/route.ts`, which uses `identity.workspaceId` + `identity.memberId`.

- [ ] **Step 4: Run tests, verify pass**

Run: `npx jest __tests__/app/api/lineage-signal.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/lineage/signal/route.ts __tests__/app/api/lineage-signal.test.ts
git commit -m "feat: GET /api/lineage/signal workspace signal-health [LUM-314]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Surface `used` per fragment + CLI rendering + `--signal`

Two parts: (a) server — add `used` to `LineageFragmentEntry`; (b) CLI — render the usage marker and add the `--signal` flag.

**Files:**
- Modify: `lib/services/lineage.service.ts` (entry type + select + assignment)
- Modify: `lib/repositories/lineage-edge.repository.ts:448-476` (`listByTaskWithCost` — add `used` to the base select)
- Modify: `cli/src/commands/task-lineage.ts`
- Test: `__tests__/lib/services/lineage-service-used.test.ts`, `cli/__tests__/commands/task-lineage.test.ts` (extend if exists, else create)

- [ ] **Step 1 (server): write the failing test**

```ts
// __tests__/lib/services/lineage-service-used.test.ts
// Assert getLineageForIdentifier carries edge.used onto each fragment entry.
// (Mock taskService.resolveIdentifier + the repos as the existing lineage
//  service tests do; copy that harness from __tests__/lib/services/lineage*.)
```

> Find the existing lineage service test (`grep -rl "getLineageForIdentifier" __tests__`) and add a case asserting `groups[0].fragments[0].used === true` given an edge with `used: true`. Reuse its mock setup verbatim — do not invent a new harness.

- [ ] **Step 2: Run it, verify it fails** (the field doesn't exist yet).

- [ ] **Step 3a: add `used` to the entry type** in `lib/services/lineage.service.ts`:

```ts
export interface LineageFragmentEntry {
  fragmentType: string
  fragmentId: string
  sourceLabel: string
  outcome: LineageOutcome
  used: boolean | null
}
```

- [ ] **Step 3b: select `used`** — in `lib/repositories/lineage-edge.repository.ts`, `listByTaskWithCost` returns full rows already (`findMany` with `include`); `used` is a scalar column so it is already present. No select change needed. (If a future narrowing `select` is added, include `used: true`.)

- [ ] **Step 3c: assign it** — in `getLineageForIdentifier`, where the fragment entry is pushed (`lib/services/lineage.service.ts:293-298`):

```ts
      g.fragments.push({
        fragmentType: e.fragmentType,
        fragmentId: cid,
        sourceLabel: labelFor(e.fragmentType, cid),
        outcome: e.outcome,
        used: e.used,
      })
```

- [ ] **Step 4: Run server test, verify pass.**

- [ ] **Step 5 (CLI): write the failing formatter test** in `cli/__tests__/commands/task-lineage.test.ts`:

```ts
import { formatLineageMarkdown, formatSignalHealth } from '@/commands/task-lineage'

it('renders a usage marker per fragment', () => {
  const md = formatLineageMarkdown({
    task: { identifier: 'LUM-1', title: 'T', status: 'DONE' },
    totals: { runCount: 1, fragmentCount: 2, edgeCount: 2, tokens: { input:0,output:0,cacheRead:0,cacheCreation:0,total:0 }, loopCount: 0, outcomes: { MERGED:0,REJECTED:0,REWORKED:0,UNKNOWN:0 } },
    groups: [{
      kind: 'session', runId: null, sessionId: 's1', label: 'Session s1', includedAt: '', cost: null,
      fragments: [
        { fragmentType: 'MEMORY', fragmentId: 'm1', sourceLabel: 'drift', outcome: 'MERGED', used: true },
        { fragmentType: 'WEB_LINK', fragmentId: 'w1', sourceLabel: 'neon', outcome: 'MERGED', used: null },
      ],
    }],
  })
  expect(md).toMatch(/✓.*drift/)
  expect(md).toMatch(/·.*neon/)
})

it('renders signal health discrimination line', () => {
  const out = formatSignalHealth({
    distribution: { used: 6, unused: 0, abstained: 4 },
    perSessionVariance: 0.18, votedSessions: 2,
    usedMergeRate: 0.71, baseMergeRate: 0.46, usedResolvedTasks: 7, baseResolvedTasks: 20,
  })
  expect(out).toContain('used 6')
  expect(out).toMatch(/71%/)
  expect(out).toMatch(/46%/)
})
```

- [ ] **Step 6: Run it, verify it fails.**

- [ ] **Step 7: Implement the CLI changes** in `cli/src/commands/task-lineage.ts`:

  1. Add `used: boolean | null` to the `LineageFragmentEntry` part of the `LineageResponse` interface.
  2. In `formatLineageMarkdown`, when emitting each fragment line, prefix a marker:

```ts
function usageMarker(used: boolean | null): string {
  return used === true ? '✓' : used === false ? '✗' : '·'
}
```
     and render ``  ${usageMarker(f.used)} ${f.fragmentType}  ${sanitizeField(f.sourceLabel)}``. Add a one-line legend under the fragments header: `✓ used · · abstained · ✗ unused (manual)`.
  3. Add `formatSignalHealth(h: UsageSignalHealth): string` producing:

```ts
export function formatSignalHealth(h: UsageSignalHealth): string {
  const lines: string[] = ['', '## Signal health']
  lines.push(
    `- Distribution: used ${h.distribution.used} · null ${h.distribution.abstained} · false ${h.distribution.unused}`
  )
  lines.push(`- Per-session variance: ${h.perSessionVariance.toFixed(2)} (${h.votedSessions} voted sessions)`)
  if (h.usedMergeRate !== null && h.baseMergeRate !== null) {
    lines.push(
      `- Used × outcome: merge-rate(used) ${Math.round(h.usedMergeRate * 100)}% vs base ${Math.round(h.baseMergeRate * 100)}%`
    )
  } else {
    lines.push('- Used × outcome: insufficient resolved tasks')
  }
  return lines.join('\n')
}
```
     Copy the `UsageSignalHealth` interface into the CLI file (the CLI is a separate package and does not import from the app `types/`; define it locally, matching `types/lineage-usage.ts`).
  4. In `taskLineage`, parse a `--signal` flag (the command currently takes only `identifier`). When set, after printing the lineage markdown, fetch `${apiUrl}/api/lineage/signal` with the same auth header and append `formatSignalHealth(json)`. Use the existing fetch/error-handling style already in the file.

- [ ] **Step 8: Wire the `--signal` flag in the command registration.** Find where `task lineage` is registered (`grep -rn "lineage" cli/src/index.ts cli/src/commands/index.ts`) and add a boolean `--signal` option, threaded into `taskLineage(identifier, { signal })`. Update the `taskLineage` signature accordingly.

- [ ] **Step 9: Run CLI tests, verify pass**

Run: `npx jest cli/__tests__/commands/task-lineage.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add lib/services/lineage.service.ts cli/src/commands/task-lineage.ts cli/src/index.ts __tests__/lib/services/lineage-service-used.test.ts cli/__tests__/commands/task-lineage.test.ts
git commit -m "feat: surface fragment usage + --signal in task lineage [LUM-314]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Docs sync + atomic full verification

**Files:**
- Modify: `.claude/skills/lumo/SKILL.md`
- Modify: `docs/superpowers/specs/2026-06-07-automate-fragment-usage-voting-design.md`
- Modify: `cli/package.json` (version bump — CLI behavior changed)

- [ ] **Step 1: SKILL.md** — in the `task lineage` section, note that `lumo task lineage <id> --signal` appends workspace usage signal-health; and add a sentence near the fragment-usage/`session wrap --used` material: "Usage is now audited automatically when a task reaches DONE (evidence-gated, true-only); `session wrap --used` remains the manual override and takes precedence for a session." Add `--signal` and "auto usage audit" to the frontmatter `description` triggers.

- [ ] **Step 2: Design doc** — change the idempotency section's "lightweight per-session claim (same pattern as the Layer-2 `tryClaimLayer2Lease`)" to reflect the shipped decision: no schema column; idempotency via the already-voted guard + idempotent additive write; a rare concurrent double-fire only wastes one cheap Haiku call.

- [ ] **Step 3: CLI version bump** — bump `cli/package.json` `version` patch (memory `project_cli_publish_version_bump`: user-facing CLI changes need a bump; publish is manual, note it in the PR).

- [ ] **Step 4: i18n check** — this PR adds NO `intl.formatMessage` keys (CLI output + terminal only; no web strings). Confirm:

Run: `npx jest -t "locale parity" --no-coverage` (or `npm run i18n:check`)
Expected: PASS / no drift.

- [ ] **Step 5: Atomic prisma generate + full typecheck + full test** (do generate ONCE, here):

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-314-automate-fragment-usage-voting
npx prisma generate
npx tsc --noEmit
npx jest --no-coverage
( cd cli && npx tsc --noEmit )
```
Expected: tsc clean (app + cli), all jest green. Fix any `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` fallout (memories `project_no_unchecked_indexed_access_tsc`, `project_react_query_onmutate_context_exactoptional`) — e.g. optional fields that may be `undefined` must be typed `field?: T | undefined`.

- [ ] **Step 6: token-lint** (no raw colors expected; CLI/terminal only) — only run if any `.ts`/`.tsx` under app/components changed UI. This PR doesn't; skip unless tsc touched a styled file.

- [ ] **Step 7: Build gate** (memory `project_lumo_shared_into_next_build_needs_prebuild`: Vercel build is the only CI gate; run it before PR):

```bash
npm run build
```
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "docs: sync SKILL.md + design note; bump CLI version [LUM-314]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review (completed during planning)

- **Spec coverage**: (1) auto trigger → Task 6 + 7; (2) evidence-driven reporter → Task 3 (judge) + Task 2 (content) + Task 5 (event-log evidence); (3) additive true-only `applyUsageVote` → Task 1; (4) signal validation → Task 8 + 9 + 10 (`--signal`) + judge abstention tests (Task 3/5); (5) per-fragment usage visible → Task 10; CLI `lumo task lineage` surface → Task 10; SKILL.md sync → Task 11; no web UI / no schema migration → honored throughout.
- **Placeholder scan**: none — every code step shows full code; the two "reuse existing harness" steps (Task 10 server test, CLI flag registration) point at exact files to copy from rather than leaving code blank, because the harness/registration shape is codebase-specific and safest copied, not reinvented.
- **Type consistency**: `applyUsageVote(sessionId, refs, { mode })`, `JudgeFragment`, `UsageJudgeOutput['used']` (`{fragmentType, fragmentId, evidence}`), `UsageSignalHealth`, `LineageFragmentEntry.used` are used identically across Tasks 1/3/5/8/10.

## Known follow-ups (out of scope, do not implement here)

- Enrich `contentByType` with fuller MEMORY body if signal-health shows the judge abstaining too much (Task 8's `--signal` is how you'd detect it).
- Escalate the judge model Haiku→Sonnet only if discrimination is weak.
- Runtime trust-gating in `computeFragmentTrust` — LUM-279.
- Web Lineage-tab `used` pill — LUM-303.

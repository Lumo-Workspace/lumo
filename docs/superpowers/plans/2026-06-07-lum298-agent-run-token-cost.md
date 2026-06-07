# Per-run / per-turn token cost on the「Agent 运行」tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show per-run and per-turn token cost — split by model — on the「Agent 运行」(AgentRun) tab, capturing per-turn token deltas and per-model usage that don't exist today.

**Architecture:** Backend-first. The tab already renders Claude Code **Sessions** as "runs" (not the `AgentRun` model), and LUM-281 already captures cumulative session token totals. We (1) extend the CLI transcript reader to group usage **by model**, (2) add two nullable `usageByModel` JSON columns (`Session` cumulative + `HookEvent` per-turn delta), (3) compute the per-turn delta atomically at STOP, (4) map per-model cost into the timeline API, and (5) render it via a shared `<TokenCostBreakdown>` component reused by the existing Lineage tab (behavior-preserving). Mixed-model runs are shown grouped per model with **no cross-model total** (token prices differ).

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Prisma + Neon Postgres, Next.js App Router, React + react-intl, Jest (jsdom), Tailwind v4 design tokens.

---

## Background facts (verified — do not re-derive)

- The tab renders `AgentRunSession` built from `Session` + `HookEvent` in [`lib/services/agent-run-timeline.service.ts`](../../../lib/services/agent-run-timeline.service.ts). The `AgentRun` model is **never read** here — out of scope.
- `Session` has cumulative flat token columns + `loopCount` (LUM-281), overwritten each STOP. Keep them — they feed the Lineage tab via `getEdgeCost`. **Do not change their semantics.**
- `HookEvent` has **no** token columns. Turns are bracketed by `STOP`/`STOP_FAILURE` in [`segment-turns.ts`](../../../app/workspace/[workspaceUrl]/components/AgentRunTimeline/segment-turns.ts).
- Transcript assistant entries carry `message.model` + `message.usage`. Sessions can mix models. Skip `model === '<synthetic>'`. Keep raw model strings (incl. bare aliases `opus`/`sonnet`).
- Root jest picks up `cli/__tests__` too. Run any test with `npx jest <path>` from repo root.
- Branch already created: `lumo/LUM-298-agent-run-token-cost`. Spec: [`docs/superpowers/specs/2026-06-07-lum298-agent-run-token-cost-design.md`](../specs/2026-06-07-lum298-agent-run-token-cost-design.md).

## Shared type vocabulary (used across tasks — keep names identical)

```ts
// CLI (cli/src/lib/transcript-usage.ts)
interface SessionUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}
interface ModelUsage {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}
interface TranscriptUsage {
  total: SessionUsage
  byModel: Record<string, ModelUsage>
}

// Wire (lib/services/agent-run-timeline.service.ts + app/workspace/[workspaceUrl]/types.ts)
interface ModelCost {
  model: string
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  total: number
}
interface RunCost {
  byModel: ModelCost[]
  loopCount: number | null
} // NO cross-model total field
```

- `usageByModel` JSON (both columns) stores `Record<string, ModelUsage>` (short keys: input/output/cacheRead/cacheCreation).
- `_lumo_usage` keeps its existing flat top-level keys (`inputTokens`…) **and** gains `byModel`.

## File map

| File                                                                                                             | Change                                                              |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `cli/src/lib/transcript-usage.ts`                                                                                | return `{ total, byModel }`, skip `<synthetic>`                     |
| `cli/src/lib/hook-runner.ts`                                                                                     | fold `byModel` into `_lumo_usage`                                   |
| `prisma/schema.prisma`                                                                                           | `Session.usageByModel Json?`, `HookEvent.usageByModel Json?`        |
| `lib/repositories/session.repository.ts`                                                                         | STOP+usage → `$transaction` computing per-turn per-model delta      |
| `lib/services/hook-event.service.ts`                                                                             | parse `byModel`, forward `turnUsageByModel` to event create         |
| `lib/repositories/hook-event.repository.ts`                                                                      | `createHookEvent` accepts `usageByModel`; `findByTaskId` selects it |
| `lib/services/agent-run-timeline.service.ts`                                                                     | map per-model run/turn cost + tab totals                            |
| `app/workspace/[workspaceUrl]/types.ts`                                                                          | wire types: `RunCost`, `ModelCost`, `cost`, `turnCost`, `totals`    |
| `app/workspace/[workspaceUrl]/components/TokenCostBreakdown.tsx`                                                 | **new** shared component                                            |
| `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/LineageTab.tsx`                                      | use shared component (behavior-preserving)                          |
| `app/workspace/[workspaceUrl]/components/AgentRunTimeline/{AgentRunTab,AgentRunCard,TurnCard,segment-turns}.tsx` | render cost                                                         |
| `lib/i18n/*.json`                                                                                                | `tokenCost.*` + `agentRun.cost.*` keys (16 locales)                 |

---

## Task 1: CLI — group transcript usage by model

**Files:**

- Modify: `cli/src/lib/transcript-usage.ts`
- Test: `cli/__tests__/lib/transcript-usage.test.ts`

- [ ] **Step 1: Rewrite the failing tests** (the return shape changes from flat to `{ total, byModel }`)

Replace the body of `cli/__tests__/lib/transcript-usage.test.ts` with:

```ts
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sumTranscriptUsage } from '../../src/lib/transcript-usage'

function fixture(lines: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'lumo-transcript-'))
  const path = join(dir, 't.jsonl')
  writeFileSync(path, lines.map(l => JSON.stringify(l)).join('\n'))
  return path
}

const usage = (i: number, o: number, cr: number, cc: number) => ({
  input_tokens: i,
  output_tokens: o,
  cache_read_input_tokens: cr,
  cache_creation_input_tokens: cc,
})

describe('sumTranscriptUsage', () => {
  it('sums usage and groups it by model', () => {
    const path = fixture([
      { type: 'user', message: {} },
      {
        type: 'assistant',
        message: { model: 'claude-opus-4-8', usage: usage(100, 10, 5, 2) },
      },
      {
        type: 'assistant',
        message: { model: 'claude-opus-4-8', usage: usage(200, 20, 7, 3) },
      },
      {
        type: 'assistant',
        message: { model: 'claude-sonnet-4-6', usage: usage(50, 5, 1, 1) },
      },
    ])
    expect(sumTranscriptUsage(path)).toEqual({
      total: {
        inputTokens: 350,
        outputTokens: 35,
        cacheReadTokens: 13,
        cacheCreationTokens: 6,
      },
      byModel: {
        'claude-opus-4-8': {
          input: 300,
          output: 30,
          cacheRead: 12,
          cacheCreation: 5,
        },
        'claude-sonnet-4-6': {
          input: 50,
          output: 5,
          cacheRead: 1,
          cacheCreation: 1,
        },
      },
    })
  })

  it('skips <synthetic> model entries (no real API cost)', () => {
    const path = fixture([
      {
        type: 'assistant',
        message: { model: '<synthetic>', usage: usage(999, 999, 999, 999) },
      },
      {
        type: 'assistant',
        message: { model: 'claude-opus-4-8', usage: usage(10, 1, 0, 0) },
      },
    ])
    expect(sumTranscriptUsage(path)).toEqual({
      total: {
        inputTokens: 10,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      byModel: {
        'claude-opus-4-8': {
          input: 10,
          output: 1,
          cacheRead: 0,
          cacheCreation: 0,
        },
      },
    })
  })

  it('buckets entries with no model string under "unknown"', () => {
    const path = fixture([
      { type: 'assistant', message: { usage: usage(7, 1, 0, 0) } },
    ])
    expect(sumTranscriptUsage(path)).toEqual({
      total: {
        inputTokens: 7,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      byModel: {
        unknown: { input: 7, output: 1, cacheRead: 0, cacheCreation: 0 },
      },
    })
  })

  it('returns null when the file is missing or unreadable', () => {
    expect(sumTranscriptUsage('/no/such/transcript.jsonl')).toBeNull()
  })

  it('returns null when there are no assistant usage entries', () => {
    const path = fixture([{ type: 'user', message: {} }])
    expect(sumTranscriptUsage(path)).toBeNull()
  })

  it('returns null when the only usage is <synthetic>', () => {
    const path = fixture([
      {
        type: 'assistant',
        message: { model: '<synthetic>', usage: usage(1, 1, 1, 1) },
      },
    ])
    expect(sumTranscriptUsage(path)).toBeNull()
  })

  it('skips malformed JSON lines without throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumo-transcript-'))
    const path = join(dir, 't.jsonl')
    writeFileSync(
      path,
      'not json\n' +
        JSON.stringify({
          type: 'assistant',
          message: { model: 'm', usage: usage(9, 0, 0, 0) },
        })
    )
    expect(sumTranscriptUsage(path)).toEqual({
      total: {
        inputTokens: 9,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      byModel: { m: { input: 9, output: 0, cacheRead: 0, cacheCreation: 0 } },
    })
  })
})
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npx jest cli/__tests__/lib/transcript-usage.test.ts`
Expected: FAIL (current return is flat, no `total`/`byModel`).

- [ ] **Step 3: Rewrite `transcript-usage.ts`**

Replace the whole file with:

```ts
import { readFileSync } from 'node:fs'

export interface SessionUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

/** Per-model token usage. Short keys match the ModelCost wire type. */
export interface ModelUsage {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

export interface TranscriptUsage {
  /** Flat cumulative total across all (non-synthetic) models. */
  total: SessionUsage
  /** Cumulative usage keyed by raw model string. */
  byModel: Record<string, ModelUsage>
}

function asNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * Read a Claude Code transcript JSONL and sum `message.usage` across all
 * assistant entries, grouped by `message.model` -> cumulative session totals.
 * `<synthetic>` entries (local injections with no API cost) are skipped.
 * Entries with no model string bucket under "unknown". Best-effort: returns
 * null if the file can't be read or has no real assistant usage. Never throws.
 */
export function sumTranscriptUsage(
  transcriptPath: string
): TranscriptUsage | null {
  let text: string
  try {
    text = readFileSync(transcriptPath, 'utf8')
  } catch {
    return null
  }
  const byModel: Record<string, ModelUsage> = {}
  const total: SessionUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  }
  let seen = false
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    let obj: unknown
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (!obj || typeof obj !== 'object') continue
    const o = obj as {
      type?: unknown
      message?: { model?: unknown; usage?: Record<string, unknown> }
    }
    if (o.type !== 'assistant') continue
    const usage = o.message?.usage
    if (!usage) continue
    const model =
      typeof o.message?.model === 'string' && o.message.model.length > 0
        ? o.message.model
        : 'unknown'
    if (model === '<synthetic>') continue
    seen = true
    const input = asNumber(usage.input_tokens)
    const output = asNumber(usage.output_tokens)
    const cacheRead = asNumber(usage.cache_read_input_tokens)
    const cacheCreation = asNumber(usage.cache_creation_input_tokens)
    total.inputTokens += input
    total.outputTokens += output
    total.cacheReadTokens += cacheRead
    total.cacheCreationTokens += cacheCreation
    const m = byModel[model] ?? {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 0,
    }
    m.input += input
    m.output += output
    m.cacheRead += cacheRead
    m.cacheCreation += cacheCreation
    byModel[model] = m
  }
  return seen ? { total, byModel } : null
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `npx jest cli/__tests__/lib/transcript-usage.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/src/lib/transcript-usage.ts cli/__tests__/lib/transcript-usage.test.ts
git commit -m "feat: group transcript usage by model [LUM-298]"
```

---

## Task 2: CLI — fold `byModel` into `_lumo_usage`

**Files:**

- Modify: `cli/src/lib/hook-runner.ts` (function `augmentBodyWithUsage`, ~line 377)
- Test: `cli/__tests__/lib/hook-runner.augment.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `cli/__tests__/lib/hook-runner.augment.test.ts`:

```ts
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { augmentBodyWithUsage } from '../../src/lib/hook-runner'

function transcript(lines: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'lumo-aug-'))
  const path = join(dir, 't.jsonl')
  writeFileSync(path, lines.map(l => JSON.stringify(l)).join('\n'))
  return path
}

describe('augmentBodyWithUsage', () => {
  it('folds flat totals AND byModel into _lumo_usage on stop', () => {
    const tpath = transcript([
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-4-8',
          usage: {
            input_tokens: 100,
            output_tokens: 10,
            cache_read_input_tokens: 5,
            cache_creation_input_tokens: 2,
          },
        },
      },
    ])
    const out = JSON.parse(
      augmentBodyWithUsage('stop', JSON.stringify({ transcript_path: tpath }))
    )
    expect(out._lumo_usage).toEqual({
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 5,
      cacheCreationTokens: 2,
      byModel: {
        'claude-opus-4-8': {
          input: 100,
          output: 10,
          cacheRead: 5,
          cacheCreation: 2,
        },
      },
    })
  })

  it('returns body unchanged for non-stop paths', () => {
    const body = JSON.stringify({ transcript_path: '/x' })
    expect(augmentBodyWithUsage('pre-tool-use', body)).toBe(body)
  })

  it('returns body unchanged when transcript has no usage', () => {
    const tpath = transcript([{ type: 'user', message: {} }])
    const body = JSON.stringify({ transcript_path: tpath })
    expect(augmentBodyWithUsage('stop', body)).toBe(body)
  })
})
```

- [ ] **Step 2: Run — verify it fails**

Run: `npx jest cli/__tests__/lib/hook-runner.augment.test.ts`
Expected: FAIL (`_lumo_usage` has no `byModel`).

- [ ] **Step 3: Update `augmentBodyWithUsage`**

In `cli/src/lib/hook-runner.ts`, replace the success line of `augmentBodyWithUsage` (currently `return JSON.stringify({ ...parsed, _lumo_usage: usage })`) so it flattens `total` and attaches `byModel`:

```ts
const usage = sumTranscriptUsage(transcriptPath)
if (!usage) return body
return JSON.stringify({
  ...parsed,
  _lumo_usage: { ...usage.total, byModel: usage.byModel },
})
```

(`sumTranscriptUsage` now returns `{ total, byModel }`; `total` already has the flat `inputTokens…` keys.)

- [ ] **Step 4: Run — verify it passes**

Run: `npx jest cli/__tests__/lib/hook-runner.augment.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/lib/hook-runner.ts cli/__tests__/lib/hook-runner.augment.test.ts
git commit -m "feat: fold per-model usage into _lumo_usage [LUM-298]"
```

---

## Task 3: Schema — add `usageByModel` columns

**Files:**

- Modify: `prisma/schema.prisma` (`Session` model ~line 1467, `HookEvent` model ~line 1420)

- [ ] **Step 1: Add the columns**

In `model Session`, immediately after `loopCount Int?` (~line 1467) add:

```prisma
  /// Cumulative per-model token usage (LUM-298). JSON map keyed by raw model
  /// string -> { input, output, cacheRead, cacheCreation }. Overwritten each
  /// STOP alongside the flat columns. Null until the first STOP carrying usage.
  usageByModel Json?
```

In `model HookEvent`, immediately after `turnSummary String?` (~line 1420) add:

```prisma
  /// Per-turn per-model token delta (LUM-298) = this STOP's cumulative minus the
  /// previous STOP's. JSON map keyed by raw model string ->
  /// { input, output, cacheRead, cacheCreation }. Written only on STOP /
  /// STOP_FAILURE rows; null everywhere else and on historical rows.
  usageByModel Json?
```

- [ ] **Step 2: Generate the migration**

Run: `npx prisma migrate dev --name lum298_usage_by_model`
Expected: creates `prisma/migrations/<ts>_lum298_usage_by_model/migration.sql` with two `ALTER TABLE ... ADD COLUMN "usageByModel" JSONB` statements, applies locally, regenerates the client.
If dev DB drift blocks it (P3008/P3012), use the offline workaround in CLAUDE.md (hand-write SQL → `prisma db execute` → `migrate resolve --applied` → `prisma generate`). **Never** `migrate reset`.

- [ ] **Step 3: Verify the client regenerated**

Run: `npx prisma generate && npx tsc --noEmit`
Expected: no errors; `Session.usageByModel` / `HookEvent.usageByModel` now typed.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add usageByModel columns to Session and HookEvent [LUM-298]"
```

> PR note (carry into the PR description): requires `prisma migrate deploy` on next prod deploy. Pure additive (two nullable JSONB columns), no data loss, no backfill.

---

## Task 4: Server — per-turn per-model delta at STOP

**Files:**

- Modify: `lib/repositories/session.repository.ts`
- Test: `__tests__/lib/repositories/session.repository.test.ts`

The STOP-with-usage path must read the prior cumulative `usageByModel`, compute the per-model delta, write the new cumulative + flat columns + `loopCount++`, and return the delta. This needs a `$transaction` (Prisma `upsert` can't return the pre-update value).

- [ ] **Step 1: Update the `usage` input type + add the diff helper**

In `lib/repositories/session.repository.ts`, extend the `UpsertSessionData.usage` field and add a `ModelUsage` import-free local type. Replace the `usage?:` block (lines ~17-26) with:

```ts
  /** Cumulative session token totals from the CLI transcript (STOP only). */
  usage?:
    | {
        inputTokens: number
        outputTokens: number
        cacheReadTokens: number
        cacheCreationTokens: number
        /** Cumulative per-model map keyed by raw model string. */
        byModel: Record<string, ModelUsage>
      }
    | null
    | undefined
```

At the top of the file (after the imports) add:

```ts
export interface ModelUsage {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

/**
 * Per-turn per-model delta = next cumulative minus prior cumulative, clamped
 * to >= 0 per field (a transcript can shrink on compaction, which would make a
 * naive subtraction negative). Models present only in `next` yield their full
 * value (first turn using that model). Pure + exported for unit testing.
 */
export function diffUsageByModel(
  prior: Record<string, ModelUsage> | null | undefined,
  next: Record<string, ModelUsage>
): Record<string, ModelUsage> {
  const out: Record<string, ModelUsage> = {}
  for (const [model, n] of Object.entries(next)) {
    const p = prior?.[model]
    out[model] = {
      input: Math.max(0, n.input - (p?.input ?? 0)),
      output: Math.max(0, n.output - (p?.output ?? 0)),
      cacheRead: Math.max(0, n.cacheRead - (p?.cacheRead ?? 0)),
      cacheCreation: Math.max(0, n.cacheCreation - (p?.cacheCreation ?? 0)),
    }
  }
  return out
}
```

- [ ] **Step 2: Write the failing tests** (add to `session.repository.test.ts`)

First, the mock's `$transaction` already feeds `{ session, hookEvent }` to the callback — but the STOP path now calls `tx.session.findUnique` then `tx.session.upsert`. The mock `session` object already has both spies. Add a `diffUsageByModel` unit block and rewrite the two STOP tests. Replace the two existing tests `'OVERWRITES token columns...'` and `'includes token values and loopCount:1 in the CREATE branch...'` with:

```ts
import { diffUsageByModel } from '@/lib/repositories/session.repository'

describe('diffUsageByModel', () => {
  it('subtracts prior cumulative per field per model, clamped to >= 0', () => {
    const prior = {
      opus: { input: 100, output: 10, cacheRead: 5, cacheCreation: 2 },
    }
    const next = {
      opus: { input: 250, output: 25, cacheRead: 5, cacheCreation: 4 },
      sonnet: { input: 30, output: 3, cacheRead: 0, cacheCreation: 0 },
    }
    expect(diffUsageByModel(prior, next)).toEqual({
      opus: { input: 150, output: 15, cacheRead: 0, cacheCreation: 2 },
      sonnet: { input: 30, output: 3, cacheRead: 0, cacheCreation: 0 },
    })
  })

  it('returns full next when prior is null (first STOP)', () => {
    const next = {
      opus: { input: 100, output: 10, cacheRead: 5, cacheCreation: 2 },
    }
    expect(diffUsageByModel(null, next)).toEqual(next)
  })

  it('clamps a shrunk cumulative (compaction) to 0', () => {
    const prior = {
      opus: { input: 100, output: 10, cacheRead: 5, cacheCreation: 2 },
    }
    const next = {
      opus: { input: 80, output: 8, cacheRead: 4, cacheCreation: 1 },
    }
    expect(diffUsageByModel(prior, next)).toEqual({
      opus: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    })
  })
})

describe('sessionRepository.upsertForHookEvent — STOP with usage', () => {
  const findUnique = prisma.session.findUnique as jest.Mock
  const upsert = prisma.session.upsert as jest.Mock

  const stopArgs = {
    id: 'sess_1',
    workspaceId: 'ws_1',
    workspaceMemberId: 'wm_1',
    cwd: '/repo',
    now,
    usage: {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheCreationTokens: 100,
      byModel: {
        opus: { input: 1000, output: 500, cacheRead: 200, cacheCreation: 100 },
      },
    },
    isStop: true,
  }

  it('overwrites flat columns + usageByModel, bumps loopCount, returns the per-turn delta', async () => {
    findUnique.mockResolvedValue({
      usageByModel: {
        opus: { input: 400, output: 200, cacheRead: 50, cacheCreation: 40 },
      },
    })
    upsert.mockResolvedValue({ id: 'sess_1', taskId: 'task_42' })

    const result = await sessionRepository.upsertForHookEvent(stopArgs)

    const args = upsert.mock.calls[0][0]
    expect(args.update.inputTokens).toBe(1000)
    expect(args.update.outputTokens).toBe(500)
    expect(args.update.cacheReadTokens).toBe(200)
    expect(args.update.cacheCreationTokens).toBe(100)
    expect(args.update.loopCount).toEqual({ increment: 1 })
    expect(args.update.usageByModel).toEqual(stopArgs.usage.byModel)
    expect(result).toEqual({
      taskId: 'task_42',
      turnUsageByModel: {
        opus: { input: 600, output: 300, cacheRead: 150, cacheCreation: 60 },
      },
    })
  })

  it('on first STOP (no prior row) the delta is the full cumulative', async () => {
    findUnique.mockResolvedValue(null)
    upsert.mockResolvedValue({ id: 'sess_1', taskId: null })

    const result = await sessionRepository.upsertForHookEvent(stopArgs)

    const args = upsert.mock.calls[0][0]
    expect(args.create.usageByModel).toEqual(stopArgs.usage.byModel)
    expect(args.create.loopCount).toBe(1)
    expect(result.turnUsageByModel).toEqual(stopArgs.usage.byModel)
  })
})
```

Then update `beforeEach` so the default `upsert` resolves with a `taskId`, and the non-STOP tests still read `upsert.mock.calls[0][0]`. Change the existing `beforeEach` line `upsert.mockResolvedValue({ id: 'sess_1' })` to:

```ts
upsert.mockResolvedValue({ id: 'sess_1', taskId: null })
```

(The non-STOP assertions in the file are unaffected — they inspect call args, not the return value.)

- [ ] **Step 3: Run — verify failures**

Run: `npx jest __tests__/lib/repositories/session.repository.test.ts`
Expected: FAIL on the new STOP tests + `diffUsageByModel` (not yet wired).

- [ ] **Step 4: Implement the STOP transaction branch**

In `session.repository.ts`, replace the body of `upsertForHookEvent` (the part building `setOnUpdate` + the `prisma.session.upsert` return) with a STOP-with-usage fast path, keeping the existing non-STOP logic intact:

```ts
  async upsertForHookEvent(data: UpsertSessionData) {
    // STOP carrying usage: compute the per-turn per-model delta atomically
    // against the prior cumulative, then overwrite cumulative columns.
    if (data.isStop && data.usage) {
      const usage = data.usage
      return prisma.$transaction(async tx => {
        const prior = await tx.session.findUnique({
          where: { id: data.id },
          select: { usageByModel: true },
        })
        const turnUsageByModel = diffUsageByModel(
          (prior?.usageByModel as Record<string, ModelUsage> | null) ?? null,
          usage.byModel
        )
        const flat = {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheCreationTokens: usage.cacheCreationTokens,
          usageByModel: usage.byModel as Prisma.InputJsonValue,
        }
        const row = await tx.session.upsert({
          where: { id: data.id },
          create: {
            id: data.id,
            workspaceId: data.workspaceId,
            workspaceMemberId: data.workspaceMemberId,
            cwd: data.cwd,
            taskId: null,
            ...(data.agent !== undefined ? { agent: data.agent } : {}),
            startedAt: data.now,
            lastActivityAt: data.now,
            eventCount: 1,
            ...flat,
            loopCount: 1,
          },
          update: {
            lastActivityAt: data.now,
            eventCount: { increment: 1 },
            ...(data.cwd !== null ? { cwd: data.cwd } : {}),
            ...flat,
            loopCount: { increment: 1 },
          },
          select: { id: true, taskId: true },
        })
        return { taskId: row.taskId, turnUsageByModel }
      })
    }

    // Non-STOP (or STOP without usage): cheap single upsert, no token write.
    // A STOP without usage still bumps loopCount.
    const setOnUpdate: Prisma.SessionUpdateInput = {
      lastActivityAt: data.now,
      eventCount: { increment: 1 },
    }
    if (data.cwd !== null) setOnUpdate.cwd = data.cwd
    if (data.isStop) setOnUpdate.loopCount = { increment: 1 }

    const row = await prisma.session.upsert({
      where: { id: data.id },
      create: {
        id: data.id,
        workspaceId: data.workspaceId,
        workspaceMemberId: data.workspaceMemberId,
        cwd: data.cwd,
        taskId: null,
        ...(data.agent !== undefined ? { agent: data.agent } : {}),
        startedAt: data.now,
        lastActivityAt: data.now,
        eventCount: 1,
        ...(data.isStop ? { loopCount: 1 } : {}),
      },
      update: setOnUpdate,
      select: { id: true, taskId: true },
    })
    return { taskId: row.taskId, turnUsageByModel: null }
  },
```

> Note: the return type is now `{ taskId: string | null; turnUsageByModel: Record<string, ModelUsage> | null }` for **all** paths. Callers use `.taskId` (and Task 5 uses `.turnUsageByModel`).

- [ ] **Step 5: Run — verify passes**

Run: `npx jest __tests__/lib/repositories/session.repository.test.ts`
Expected: PASS (all blocks incl. the unchanged non-STOP tests).

- [ ] **Step 6: Commit**

```bash
git add lib/repositories/session.repository.ts __tests__/lib/repositories/session.repository.test.ts
git commit -m "feat: compute per-turn per-model token delta at STOP [LUM-298]"
```

---

## Task 5: Server — persist the per-turn delta on the HookEvent

**Files:**

- Modify: `lib/repositories/hook-event.repository.ts` (`createHookEvent`, `findByTaskId`)
- Modify: `lib/services/hook-event.service.ts`
- Test: `__tests__/lib/services/hook-event.service.test.ts`

- [ ] **Step 1: Extend the repository**

In `hook-event.repository.ts`, add `usageByModel` to `CreateHookEventData` and the create payload, and to `findByTaskId`'s select.

In `interface CreateHookEventData`, after `filePath?: string | null` add:

```ts
  /** Per-turn per-model token delta (LUM-298). Set only on STOP rows. */
  usageByModel?: Prisma.InputJsonValue | null
```

In `createHookEvent`'s `data:` object, after `payload: data.payload,` add:

```ts
        usageByModel: data.usageByModel ?? null,
```

In `findByTaskId`'s `select:`, after `turnSummary: true,` add:

```ts
        usageByModel: true,
```

- [ ] **Step 2: Write the failing service tests** (add to `hook-event.service.test.ts`)

Update the default mock and add two tests. In `beforeEach`, change the `sess.upsertForHookEvent` mock to include `turnUsageByModel`:

```ts
sess.upsertForHookEvent.mockResolvedValue({
  taskId: null,
  turnUsageByModel: null,
} as never)
```

Add:

```ts
it('parses byModel from _lumo_usage and forwards it on STOP', async () => {
  await hookEventService.recordHookEvent({
    identity,
    type: 'STOP',
    payload: {
      session_id: 'sess_abc',
      _lumo_usage: {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 200,
        cacheCreationTokens: 100,
        byModel: {
          'claude-opus-4-8': {
            input: 1000,
            output: 500,
            cacheRead: 200,
            cacheCreation: 100,
          },
        },
      },
    },
  })
  const arg = sess.upsertForHookEvent.mock.calls[0]![0]
  expect(arg.usage).toEqual({
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 200,
    cacheCreationTokens: 100,
    byModel: {
      'claude-opus-4-8': {
        input: 1000,
        output: 500,
        cacheRead: 200,
        cacheCreation: 100,
      },
    },
  })
})

it('stores the per-turn delta returned by the session upsert on the HookEvent', async () => {
  sess.upsertForHookEvent.mockResolvedValue({
    taskId: 'task_42',
    turnUsageByModel: {
      opus: { input: 600, output: 300, cacheRead: 150, cacheCreation: 60 },
    },
  } as never)
  await hookEventService.recordHookEvent({
    identity,
    type: 'STOP',
    payload: {
      session_id: 'sess_abc',
      _lumo_usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        byModel: {
          opus: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 },
        },
      },
    },
  })
  expect(repo.createHookEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      usageByModel: {
        opus: { input: 600, output: 300, cacheRead: 150, cacheCreation: 60 },
      },
    })
  )
})

it('passes usageByModel:null on non-stop events', async () => {
  await hookEventService.recordHookEvent({
    identity,
    type: 'PRE_TOOL_USE',
    payload: { session_id: 'sess_abc', tool_name: 'Read' },
  })
  expect(repo.createHookEvent).toHaveBeenCalledWith(
    expect.objectContaining({ usageByModel: null })
  )
})
```

Also update the two existing `'forwards usage + isStop:true...'` tests: their `arg.usage` now includes a `byModel` key. Add `byModel: {}` to the `payload._lumo_usage` in those two tests and to their `expect(arg.usage).toEqual({...})` (since the payload carries no byModel, the extractor defaults it to `{}` — see Step 3).

- [ ] **Step 3: Update the service**

In `hook-event.service.ts`:

Extend `InjectedUsage` and `extractInjectedUsage` to parse `byModel`:

```ts
interface ModelUsage {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

interface InjectedUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  byModel: Record<string, ModelUsage>
}

function extractInjectedUsage(payload: unknown): InjectedUsage | null {
  if (!payload || typeof payload !== 'object') return null
  const u = (payload as Record<string, unknown>)['_lumo_usage']
  if (!u || typeof u !== 'object') return null
  const o = u as Record<string, unknown>
  const num = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? v : 0
  const byModel: Record<string, ModelUsage> = {}
  const raw = o['byModel']
  if (raw && typeof raw === 'object') {
    for (const [model, mv] of Object.entries(raw as Record<string, unknown>)) {
      if (!mv || typeof mv !== 'object') continue
      const m = mv as Record<string, unknown>
      byModel[model] = {
        input: num(m.input),
        output: num(m.output),
        cacheRead: num(m.cacheRead),
        cacheCreation: num(m.cacheCreation),
      }
    }
  }
  return {
    inputTokens: num(o.inputTokens),
    outputTokens: num(o.outputTokens),
    cacheReadTokens: num(o.cacheReadTokens),
    cacheCreationTokens: num(o.cacheCreationTokens),
    byModel,
  }
}
```

Capture and forward the delta. Replace the session-upsert block + the `createHookEvent` call so they thread `turnUsageByModel`:

```ts
let taskId: string | null = null
let turnUsageByModel: Record<string, ModelUsage> | null = null
if (sessionId) {
  const session = await sessionRepository.upsertForHookEvent({
    id: sessionId,
    workspaceId: identity.workspace.id,
    workspaceMemberId: memberId,
    cwd,
    ...(agent !== undefined ? { agent } : {}),
    now: new Date(),
    usage,
    isStop,
  })
  taskId = session.taskId
  turnUsageByModel = session.turnUsageByModel
}

const toolName = extractStringField(payload, 'tool_name')
const filePath = extractFilePath(payload)
const created = await hookEventRepository.createHookEvent({
  workspaceId: identity.workspace.id,
  workspaceMemberId: memberId,
  sessionId,
  taskId,
  type,
  toolName,
  filePath,
  payload,
  usageByModel: turnUsageByModel,
})
```

- [ ] **Step 4: Run — verify passes**

Run: `npx jest __tests__/lib/services/hook-event.service.test.ts __tests__/lib/repositories/session.repository.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/hook-event.repository.ts lib/services/hook-event.service.ts __tests__/lib/services/hook-event.service.test.ts
git commit -m "feat: persist per-turn per-model token delta on HookEvent [LUM-298]"
```

---

## Task 6: Read — map per-model cost into the timeline API

**Files:**

- Create: `lib/services/model-cost.ts` (pure mapper, shared by service + tests)
- Modify: `lib/repositories/session.repository.ts` (`listForTask` select)
- Modify: `lib/services/agent-run-timeline.service.ts`
- Modify: `app/workspace/[workspaceUrl]/types.ts`
- Test: `__tests__/lib/services/model-cost.test.ts`, `__tests__/lib/services/agent-run-timeline.service.test.ts`

- [ ] **Step 1: Write the failing mapper test**

Create `__tests__/lib/services/model-cost.test.ts`:

```ts
import { toModelCosts, mergeModelCosts } from '@/lib/services/model-cost'

describe('toModelCosts', () => {
  it('returns null for null/empty maps', () => {
    expect(toModelCosts(null)).toBeNull()
    expect(toModelCosts({})).toBeNull()
  })

  it('converts a per-model map to ModelCost[] sorted by total desc', () => {
    expect(
      toModelCosts({
        sonnet: { input: 10, output: 5, cacheRead: 1, cacheCreation: 1 },
        opus: { input: 100, output: 50, cacheRead: 10, cacheCreation: 10 },
      })
    ).toEqual([
      {
        model: 'opus',
        input: 100,
        output: 50,
        cacheRead: 10,
        cacheCreation: 10,
        total: 170,
      },
      {
        model: 'sonnet',
        input: 10,
        output: 5,
        cacheRead: 1,
        cacheCreation: 1,
        total: 17,
      },
    ])
  })
})

describe('mergeModelCosts', () => {
  it('sums same-model entries across runs and re-sorts', () => {
    const a = [
      {
        model: 'opus',
        input: 10,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        total: 10,
      },
    ]
    const b = [
      {
        model: 'opus',
        input: 5,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        total: 5,
      },
      {
        model: 'sonnet',
        input: 20,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        total: 20,
      },
    ]
    expect(mergeModelCosts([a, b])).toEqual([
      {
        model: 'sonnet',
        input: 20,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        total: 20,
      },
      {
        model: 'opus',
        input: 15,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        total: 15,
      },
    ])
  })
})
```

- [ ] **Step 2: Run — verify it fails**

Run: `npx jest __tests__/lib/services/model-cost.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `lib/services/model-cost.ts`**

```ts
/** Per-model run/turn cost shapes shared by the Agent Run timeline (LUM-298). */
export interface ModelCost {
  model: string
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  total: number
}

interface ModelUsage {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

const num = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0

/**
 * Convert a stored usageByModel JSON map -> ModelCost[] sorted by total desc.
 * Returns null when there's nothing captured (historical rows / no usage), so
 * callers render nothing rather than a row of zeros.
 */
export function toModelCosts(
  byModel: Record<string, ModelUsage> | null | undefined
): ModelCost[] | null {
  if (!byModel) return null
  const out: ModelCost[] = []
  for (const [model, u] of Object.entries(byModel)) {
    const input = num(u?.input)
    const output = num(u?.output)
    const cacheRead = num(u?.cacheRead)
    const cacheCreation = num(u?.cacheCreation)
    out.push({
      model,
      input,
      output,
      cacheRead,
      cacheCreation,
      total: input + output + cacheRead + cacheCreation,
    })
  }
  if (out.length === 0) return null
  return out.sort((a, b) => b.total - a.total)
}

/** Merge several ModelCost[] (e.g. per-run -> tab total), summing same-model. */
export function mergeModelCosts(lists: (ModelCost[] | null)[]): ModelCost[] {
  const acc = new Map<string, ModelCost>()
  for (const list of lists) {
    if (!list) continue
    for (const c of list) {
      const cur = acc.get(c.model) ?? {
        model: c.model,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        total: 0,
      }
      cur.input += c.input
      cur.output += c.output
      cur.cacheRead += c.cacheRead
      cur.cacheCreation += c.cacheCreation
      cur.total += c.total
      acc.set(c.model, cur)
    }
  }
  return [...acc.values()].sort((a, b) => b.total - a.total)
}
```

- [ ] **Step 4: Run — verify passes**

Run: `npx jest __tests__/lib/services/model-cost.test.ts`
Expected: PASS.

- [ ] **Step 5: Widen the session select**

In `session.repository.ts` `listForTask`, add to `select`:

```ts
        usageByModel: true,
        loopCount: true,
```

- [ ] **Step 6: Write the failing timeline test**

Create `__tests__/lib/services/agent-run-timeline.service.test.ts`:

```ts
/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { listForTask: jest.fn() },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { findByTaskId: jest.fn() },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: { findByTaskIdWithSession: jest.fn() },
}))

import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { agentRunTimelineService } from '@/lib/services/agent-run-timeline.service'

const sessions = sessionRepository.listForTask as jest.Mock
const events = hookEventRepository.findByTaskId as jest.Mock
const memories = memoryRepository.findByTaskIdWithSession as jest.Mock

const t0 = new Date('2026-06-01T10:00:00Z')
const t1 = new Date('2026-06-01T10:05:00Z')

beforeEach(() => {
  jest.clearAllMocks()
  memories.mockResolvedValue([])
})

it('maps per-run model cost and a STOP turn delta, and aggregates tab totals', async () => {
  sessions.mockResolvedValue([
    {
      id: 'sess_1',
      startedAt: t0,
      lastActivityAt: t1,
      eventCount: 2,
      loopCount: 1,
      usageByModel: {
        opus: { input: 100, output: 50, cacheRead: 10, cacheCreation: 10 },
      },
    },
  ])
  events.mockResolvedValue([
    {
      id: 'e1',
      sessionId: 'sess_1',
      type: 'PRE_TOOL_USE',
      toolName: 'Read',
      payload: {},
      turnSummary: null,
      usageByModel: null,
      createdAt: t0,
    },
    {
      id: 'e2',
      sessionId: 'sess_1',
      type: 'STOP',
      toolName: null,
      payload: {},
      turnSummary: 'did a thing',
      usageByModel: {
        opus: { input: 100, output: 50, cacheRead: 10, cacheCreation: 10 },
      },
      createdAt: t1,
    },
  ])

  const { runs, totals } = await agentRunTimelineService.getTimeline('task_1')

  expect(runs).toHaveLength(1)
  expect(runs[0]!.cost).toEqual({
    byModel: [
      {
        model: 'opus',
        input: 100,
        output: 50,
        cacheRead: 10,
        cacheCreation: 10,
        total: 170,
      },
    ],
    loopCount: 1,
  })
  const stop = runs[0]!.items.find(
    i => i.kind === 'hook' && i.type === 'STOP'
  ) as { turnCost: unknown }
  expect(stop.turnCost).toEqual({
    byModel: [
      {
        model: 'opus',
        input: 100,
        output: 50,
        cacheRead: 10,
        cacheCreation: 10,
        total: 170,
      },
    ],
  })
  expect(totals).toEqual({
    runCount: 1,
    turnCount: 1,
    loopCount: 1,
    byModel: [
      {
        model: 'opus',
        input: 100,
        output: 50,
        cacheRead: 10,
        cacheCreation: 10,
        total: 170,
      },
    ],
  })
})

it('leaves cost null when a session captured no usage', async () => {
  sessions.mockResolvedValue([
    {
      id: 'sess_1',
      startedAt: t0,
      lastActivityAt: t1,
      eventCount: 1,
      loopCount: null,
      usageByModel: null,
    },
  ])
  events.mockResolvedValue([
    {
      id: 'e1',
      sessionId: 'sess_1',
      type: 'PRE_TOOL_USE',
      toolName: 'Read',
      payload: {},
      turnSummary: null,
      usageByModel: null,
      createdAt: t0,
    },
  ])
  const { runs } = await agentRunTimelineService.getTimeline('task_1')
  expect(runs[0]!.cost).toBeNull()
})
```

- [ ] **Step 7: Run — verify it fails**

Run: `npx jest __tests__/lib/services/agent-run-timeline.service.test.ts`
Expected: FAIL (no `cost`/`turnCost`/`totals` yet).

- [ ] **Step 8: Update `agent-run-timeline.service.ts`**

Add imports + extend the wire interfaces and the builder:

At top:

```ts
import {
  toModelCosts,
  mergeModelCosts,
  type ModelCost,
} from '@/lib/services/model-cost'
```

Extend `AgentRunHookEvent` (add `turnCost`), `AgentRunSession` (add `cost`), and the result type. After `turnSummary: string | null` in `AgentRunHookEvent`:

```ts
  /** Per-turn per-model cost (STOP rows only); null elsewhere. */
  turnCost: { byModel: ModelCost[] } | null
```

In `AgentRunSession`, after `memoryCount: number`:

```ts
  /** Per-run cost split by model; null when nothing captured. */
  cost: { byModel: ModelCost[]; loopCount: number | null } | null
```

Replace `AgentRunTimelineResult`:

```ts
export interface AgentRunTimelineResult {
  runs: AgentRunSession[]
  totals: {
    runCount: number
    turnCount: number
    loopCount: number
    byModel: ModelCost[]
  }
}
```

In the event-bucketing loop, carry `turnCost` from `usageByModel`:

```ts
list.push({
  id: ev.id,
  kind: 'hook',
  type: ev.type,
  toolName: ev.toolName,
  payload: ev.payload,
  turnSummary: ev.turnSummary,
  turnCost:
    ev.type === 'STOP' || ev.type === 'STOP_FAILURE'
      ? (() => {
          const byModel = toModelCosts(
            ev.usageByModel as Record<string, never> | null
          )
          return byModel ? { byModel } : null
        })()
      : null,
  createdAt: ev.createdAt.toISOString(),
})
```

In the `orderedSessions.map(...)` run builder, after computing `toolCallCount`, add `cost`:

```ts
const costByModel = toModelCosts(s.usageByModel as Record<string, never> | null)
```

and in the returned run object add:

```ts
        cost: costByModel ? { byModel: costByModel, loopCount: s.loopCount } : null,
```

The orphan ("Unlinked") run has no session row → `cost: null`. Add `cost: null` and `turnCost: null` (already set per-item) where needed.

Replace the final `return { runs: nonEmptyRuns.reverse() }` with totals aggregation:

```ts
const ordered = nonEmptyRuns.reverse()
const totals = {
  runCount: ordered.length,
  turnCount: ordered.reduce(
    (n, r) =>
      n +
      r.items.filter(
        i =>
          i.kind === 'hook' && (i.type === 'STOP' || i.type === 'STOP_FAILURE')
      ).length,
    0
  ),
  loopCount: ordered.reduce((n, r) => n + (r.cost?.loopCount ?? 0), 0),
  byModel: mergeModelCosts(ordered.map(r => r.cost?.byModel ?? null)),
}
return { runs: ordered, totals }
```

- [ ] **Step 9: Mirror the wire types in the client copy**

In `app/workspace/[workspaceUrl]/types.ts`, add near the `AgentRun*` block:

```ts
export interface ModelCost {
  model: string
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  total: number
}
```

Add to `AgentRunHookEventItem`: `turnCost: { byModel: ModelCost[] } | null`.
Add to `AgentRunSession`: `cost: { byModel: ModelCost[]; loopCount: number | null } | null`.
Replace `AgentRunTimelineResponse`:

```ts
export interface AgentRunTimelineResponse {
  runs: AgentRunSession[]
  totals: {
    runCount: number
    turnCount: number
    loopCount: number
    byModel: ModelCost[]
  }
}
```

- [ ] **Step 10: Run — verify passes**

Run: `npx jest __tests__/lib/services/agent-run-timeline.service.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 11: Commit**

```bash
git add lib/services/model-cost.ts lib/services/agent-run-timeline.service.ts lib/repositories/session.repository.ts app/workspace/\[workspaceUrl\]/types.ts __tests__/lib/services/model-cost.test.ts __tests__/lib/services/agent-run-timeline.service.test.ts
git commit -m "feat: expose per-model run/turn cost + tab totals from timeline API [LUM-298]"
```

---

## Task 7: Shared `<TokenCostBreakdown>` component + i18n keys

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/TokenCostBreakdown.tsx`
- Modify: `lib/i18n/en.json`, `lib/i18n/zh-CN.json`
- Test: `__tests__/components/TokenCostBreakdown.test.tsx`

- [ ] **Step 1: Add the `tokenCost.*` keys to en.json and zh-CN.json**

Add to `lib/i18n/en.json` (and the obvious Chinese equivalents to `lib/i18n/zh-CN.json`):

```jsonc
"tokenCost.unit": "tok",
"tokenCost.output": "output",
"tokenCost.input": "input",
"tokenCost.cacheCreate": "cache-create",
"tokenCost.cacheRead": "cache-read",
"tokenCost.none": "No captured cost on this trail",
"tokenCost.loops": "{n, plural, one {# loop} other {# loops}}",
"tokenCost.loopsNa": "loops n/a",
"tokenCost.mixedNoTotal": "models not price-comparable · no total"
```

zh-CN values: `"tok"`, `"output"`, `"input"`, `"cache-create"`, `"cache-read"`, `"此条线索暂无采集到的成本"`, `"{n, plural, other {# loops}}"`, `"loops n/a"`, `"跨 model 不可比 · 不合计"`.

- [ ] **Step 2: Write the failing component test**

Create `__tests__/components/TokenCostBreakdown.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { TokenCostBreakdown } from '@/app/workspace/[workspaceUrl]/components/TokenCostBreakdown'
import type { ModelCost } from '@/app/workspace/[workspaceUrl]/types'

const wrap = (ui: React.ReactNode) =>
  render(<IntlProvider locale='en'>{ui}</IntlProvider>)

const opus: ModelCost = {
  model: 'claude-opus-4-8',
  input: 95,
  output: 180,
  cacheRead: 10_900_000,
  cacheCreation: 1_200_000,
  total: 12_300_000,
}
const sonnet: ModelCost = {
  model: 'claude-sonnet-4-6',
  input: 48,
  output: 92,
  cacheRead: 2_900_000,
  cacheCreation: 410_000,
  total: 3_300_000,
}

describe('TokenCostBreakdown', () => {
  it('renders a single unnamed group with real loops (no model name when empty)', () => {
    wrap(
      <TokenCostBreakdown
        variant='full'
        models={[{ ...opus, model: '' }]}
        loopCount={18}
      />
    )
    expect(screen.getByText('18 loops')).toBeInTheDocument()
    expect(screen.queryByText('claude-opus-4-8')).not.toBeInTheDocument()
    expect(screen.queryByText('loops n/a')).not.toBeInTheDocument()
  })

  it('renders "loops n/a" when loopCount is null (lineage path)', () => {
    wrap(
      <TokenCostBreakdown
        variant='full'
        models={[{ ...opus, model: '' }]}
        loopCount={null}
      />
    )
    expect(screen.getByText('loops n/a')).toBeInTheDocument()
  })

  it('stacks per-model groups with NO cross-model total when multi-model', () => {
    wrap(
      <TokenCostBreakdown
        variant='full'
        models={[opus, sonnet]}
        loopCount={18}
      />
    )
    expect(screen.getByText('claude-opus-4-8')).toBeInTheDocument()
    expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument()
    expect(
      screen.getByText('models not price-comparable · no total')
    ).toBeInTheDocument()
  })

  it('renders the empty state when models is empty', () => {
    wrap(<TokenCostBreakdown variant='full' models={[]} loopCount={null} />)
    expect(
      screen.getByText('No captured cost on this trail')
    ).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run — verify it fails**

Run: `npx jest __tests__/components/TokenCostBreakdown.test.tsx`
Expected: FAIL (component missing).

- [ ] **Step 4: Implement `TokenCostBreakdown.tsx`**

```tsx
'use client'

import { useIntl } from 'react-intl'
import type { ModelCost } from './AgentRunTimeline/../types'

export interface CostChip {
  id: string
  defaultMessage: string
}

interface TokenCostBreakdownProps {
  models: ModelCost[]
  /** Real loop count → "N loops"; null/undefined → "loops n/a" chip. */
  loopCount?: number | null
  variant: 'full' | 'compact'
  /** Extra caliber chips (e.g. lineage's 会话级/实时). */
  chips?: CostChip[]
}

// Token breakdown segments in bar order. Static literal classes so Tailwind
// emits them; cache-read muted (~88% of count, not ~88% of spend).
const SEGMENTS: {
  key: keyof Pick<ModelCost, 'output' | 'input' | 'cacheCreation' | 'cacheRead'>
  bar: string
  dot: string
  labelId: string
  defaultLabel: string
  muted?: boolean
}[] = [
  {
    key: 'output',
    bar: 'bg-chart-1',
    dot: 'bg-chart-1',
    labelId: 'tokenCost.output',
    defaultLabel: 'output',
  },
  {
    key: 'input',
    bar: 'bg-chart-2',
    dot: 'bg-chart-2',
    labelId: 'tokenCost.input',
    defaultLabel: 'input',
  },
  {
    key: 'cacheCreation',
    bar: 'bg-chart-3',
    dot: 'bg-chart-3',
    labelId: 'tokenCost.cacheCreate',
    defaultLabel: 'cache-create',
  },
  {
    key: 'cacheRead',
    bar: 'bg-chart-4/40',
    dot: 'bg-chart-4/40',
    labelId: 'tokenCost.cacheRead',
    defaultLabel: 'cache-read',
    muted: true,
  },
]

export function TokenCostBreakdown({
  models,
  loopCount,
  variant,
  chips,
}: TokenCostBreakdownProps) {
  const intl = useIntl()
  const fmt = (n: number) =>
    intl.formatNumber(n, { notation: 'compact', maximumFractionDigits: 1 })

  if (models.length === 0) {
    return (
      <div className='text-muted-foreground'>
        {intl.formatMessage({
          id: 'tokenCost.none',
          defaultMessage: 'No captured cost on this trail',
        })}
      </div>
    )
  }

  const multi = models.length > 1
  const unit = intl.formatMessage({
    id: 'tokenCost.unit',
    defaultMessage: 'tok',
  })

  const loopChip =
    typeof loopCount === 'number'
      ? intl.formatMessage(
          {
            id: 'tokenCost.loops',
            defaultMessage: '{n, plural, one {# loop} other {# loops}}',
          },
          { n: loopCount }
        )
      : intl.formatMessage({
          id: 'tokenCost.loopsNa',
          defaultMessage: 'loops n/a',
        })

  const Group = ({ m }: { m: ModelCost }) => (
    <div className='py-2 first:pt-0 border-t border-border/60 first:border-t-0'>
      <div className='flex items-center gap-2'>
        {m.model && <span className='text-xs font-semibold'>{m.model}</span>}
        <span
          className={`${multi ? 'text-sm' : 'text-2xl'} ml-auto font-bold tabular-nums tracking-tight`}
        >
          {fmt(m.total)}{' '}
          <span className='text-[10px] font-normal text-muted-foreground/60'>
            {unit}
          </span>
        </span>
      </div>
      <div className='mt-2 flex h-2 overflow-hidden rounded-full'>
        {SEGMENTS.map(seg => {
          const value = m[seg.key]
          if (value <= 0) return null
          return (
            <div
              key={seg.key}
              className={seg.bar}
              style={{ width: `${(value / m.total) * 100}%` }}
            />
          )
        })}
      </div>
      <div className='mt-2 flex flex-col gap-0.5'>
        {SEGMENTS.map(seg => (
          <div
            key={seg.key}
            className={`flex items-center justify-between ${seg.muted ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}
          >
            <span className='flex items-center gap-1.5'>
              <span
                className={`size-1.5 rounded-full ${seg.dot}`}
                aria-hidden
              />
              {intl.formatMessage({
                id: seg.labelId,
                defaultMessage: seg.defaultLabel,
              })}
            </span>
            <span className='tabular-nums'>{fmt(m[seg.key])}</span>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className={variant === 'full' ? 'px-3 py-3' : ''}>
      <div className='text-[10px] uppercase tracking-wider text-muted-foreground/60'>
        {intl.formatMessage({
          id: 'lineage.cost.label',
          defaultMessage: 'Cost',
        })}
      </div>
      {models.map(m => (
        <Group key={m.model || 'single'} m={m} />
      ))}
      <div className='mt-2 flex flex-wrap gap-1'>
        <span className='rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground'>
          {loopChip}
        </span>
        {chips?.map(c => (
          <span
            key={c.id}
            className='rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground'
          >
            {intl.formatMessage({ id: c.id, defaultMessage: c.defaultMessage })}
          </span>
        ))}
        {multi && (
          <span className='rounded-full border border-warning-border bg-warning-subtle px-1.5 py-px text-[10px] text-foreground'>
            {intl.formatMessage({
              id: 'tokenCost.mixedNoTotal',
              defaultMessage: 'models not price-comparable · no total',
            })}
          </span>
        )}
      </div>
    </div>
  )
}
```

> The `import type { ModelCost } from './AgentRunTimeline/../types'` resolves to `app/workspace/[workspaceUrl]/types`. Prefer the clean path `'../types'` — the component sits in `components/`, so `../types` = `app/workspace/[workspaceUrl]/types`. Use `import type { ModelCost } from '../types'`.

- [ ] **Step 5: Run — verify passes**

Run: `npx jest __tests__/components/TokenCostBreakdown.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/TokenCostBreakdown.tsx __tests__/components/TokenCostBreakdown.test.tsx lib/i18n/en.json lib/i18n/zh-CN.json
git commit -m "feat: shared TokenCostBreakdown component [LUM-298]"
```

---

## Task 8: Refactor LineageTab to use the shared component (behavior-preserving)

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/LineageTab.tsx`
- Check: `__tests__/components/TaskDetailTimeline/LineageTab.test.tsx` (must stay green)

- [ ] **Step 1: Run the existing LineageTab tests to capture the baseline (green)**

Run: `npx jest __tests__/components/TaskDetailTimeline/LineageTab.test.tsx`
Expected: PASS (record the assertions — the refactor must not change them).

- [ ] **Step 2: Replace the inline cost block with the shared component**

In `LineageTab.tsx`: delete the local `TOKEN_SEGMENTS` const and the entire JSX cost block (the `{/* Cost block ... */}` `<div>` spanning the `tokens.total > 0 ? (...) : (...)` ternary, lines ~175-263). Replace with:

```tsx
{
  /* Cost block — reuses the shared breakdown. Lineage is session-level &
          flat, so pass a single unnamed model group + loopCount=null so the
          component renders identically to before (2xl total, "loops n/a"). */
}
;<div className='border-b border-border'>
  <TokenCostBreakdown
    variant='full'
    loopCount={null}
    models={
      tokens.total > 0
        ? [
            {
              model: '',
              input: tokens.input,
              output: tokens.output,
              cacheRead: tokens.cacheRead,
              cacheCreation: tokens.cacheCreation,
              total: tokens.total,
            },
          ]
        : []
    }
    chips={[
      { id: 'lineage.chip.sessionLevel', defaultMessage: '会话级' },
      { id: 'lineage.chip.live', defaultMessage: '实时' },
      { id: 'lineage.chip.notPerFragment', defaultMessage: '非每片段' },
    ]}
  />
</div>
```

Add the import: `import { TokenCostBreakdown } from '../TokenCostBreakdown'`. Remove the now-unused `chips` array and `LineageTokens` `TOKEN_SEGMENTS` usage; keep `fmt`, outcome rendering, fragments list untouched. (The old `loops n/a` chip is now emitted by the component itself.)

- [ ] **Step 3: Run the LineageTab tests — verify still green**

Run: `npx jest __tests__/components/TaskDetailTimeline/LineageTab.test.tsx`
Expected: PASS (unchanged). If a test asserted exact DOM the shared component differs on, adjust the component's markup minimally to match — the rendered output must stay equivalent. Do not change the test.

- [ ] **Step 4: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/TaskDetailTimeline/LineageTab.tsx
git commit -m "refactor: LineageTab uses shared TokenCostBreakdown [LUM-298]"
```

---

## Task 9: Render cost on AgentRunTab / AgentRunCard / TurnCard

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/AgentRunTimeline/segment-turns.ts`
- Modify: `app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunTab.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunCard.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/AgentRunTimeline/TurnCard.tsx`
- Modify: `lib/i18n/en.json`, `lib/i18n/zh-CN.json` (`agentRun.cost.*`)
- Test: `__tests__/components/AgentRunTimeline/segment-turns.test.ts`

- [ ] **Step 1: Carry per-turn cost through segmentation (failing test first)**

Create `__tests__/components/AgentRunTimeline/segment-turns.test.ts`:

```ts
import { segmentIntoTurns } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/segment-turns'
import type { AgentRunItem } from '@/app/workspace/[workspaceUrl]/types'

it('attaches the STOP item turnCost to its terminated turn', () => {
  const items: AgentRunItem[] = [
    {
      id: 'a',
      kind: 'hook',
      type: 'PRE_TOOL_USE',
      toolName: 'Read',
      payload: {},
      turnSummary: null,
      turnCost: null,
      createdAt: '2026-06-01T10:00:00.000Z',
    },
    {
      id: 'b',
      kind: 'hook',
      type: 'STOP',
      toolName: null,
      payload: {},
      turnSummary: 'done',
      turnCost: {
        byModel: [
          {
            model: 'opus',
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheCreation: 0,
            total: 2,
          },
        ],
      },
      createdAt: '2026-06-01T10:01:00.000Z',
    },
  ]
  const turns = segmentIntoTurns(items)
  expect(turns).toHaveLength(1)
  expect(turns[0]!.cost).toEqual({
    byModel: [
      {
        model: 'opus',
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheCreation: 0,
        total: 2,
      },
    ],
  })
})

it('leaves cost null for an unterminated turn', () => {
  const items: AgentRunItem[] = [
    {
      id: 'a',
      kind: 'hook',
      type: 'PRE_TOOL_USE',
      toolName: 'Read',
      payload: {},
      turnSummary: null,
      turnCost: null,
      createdAt: '2026-06-01T10:00:00.000Z',
    },
  ]
  expect(segmentIntoTurns(items)[0]!.cost).toBeNull()
})
```

Run: `npx jest __tests__/components/AgentRunTimeline/segment-turns.test.ts` → FAIL (`cost` not on `Turn`).

- [ ] **Step 2: Add `cost` to `Turn` + set it from the STOP item**

In `segment-turns.ts`, add to the `Turn` interface:

```ts
  /** Per-turn per-model cost from the terminating STOP; null if unterminated
   *  or no usage captured. */
  cost: { byModel: import('../../types').ModelCost[] } | null
```

In the terminated-turn push, set `cost: item.turnCost ?? null` and in the unterminated push set `cost: null`. (`item` is the STOP `AgentRunHookEventItem`, which now has `turnCost`.)

Run: `npx jest __tests__/components/AgentRunTimeline/segment-turns.test.ts` → PASS.

- [ ] **Step 3: Add `agentRun.cost.*` i18n keys**

Add to `en.json` (+ zh-CN.json equivalents):

```jsonc
"agentRun.summary": "{runs, plural, one {# run} other {# runs}} · {turns, plural, one {# turn} other {# turns}} · {models, plural, one {# model} other {# models}}",
"agentRun.cost.perRunTok": "{tok} tok",
"agentRun.cost.loops": "{n, plural, one {# loop} other {# loops}}"
```

zh-CN: `"{runs} runs · {turns} turns · {models} 个 model"`, `"{tok} tok"`, `"{n} loops"`.

- [ ] **Step 4: AgentRunTab — render the top summary**

In `AgentRunTab.tsx`, after computing `runs`, render the totals block above the run list. Replace the `return (<div className='space-y-3'>…)` with:

```tsx
const { totals } = data!
return (
  <div className='space-y-3'>
    {totals.byModel.length > 0 && (
      <div className='rounded-lg border border-border'>
        <div className='px-3 py-2 border-b border-border text-xs text-muted-foreground'>
          {intl.formatMessage(
            {
              id: 'agentRun.summary',
              defaultMessage:
                '{runs, plural, one {# run} other {# runs}} · {turns, plural, one {# turn} other {# turns}} · {models, plural, one {# model} other {# models}}',
            },
            {
              runs: totals.runCount,
              turns: totals.turnCount,
              models: totals.byModel.length,
            }
          )}
        </div>
        <TokenCostBreakdown
          variant='full'
          models={totals.byModel}
          loopCount={totals.loopCount}
        />
      </div>
    )}
    {runs.map((run, i) => (
      <AgentRunCard
        key={run.sessionId ?? `unlinked-${run.runNumber}`}
        run={run}
        defaultExpanded={i === 0}
      />
    ))}
  </div>
)
```

Add `import { TokenCostBreakdown } from '../TokenCostBreakdown'`.

- [ ] **Step 5: AgentRunCard — per-run cost in the header + breakdown when expanded**

In `AgentRunCard.tsx`, add a compact cost into the `runMeta` span. After the `<span>{durationLabel}</span>` group and before the memory count, insert (only when `run.cost`):

```tsx
{
  run.cost && (
    <>
      <span>·</span>
      <span className='text-foreground font-semibold tabular-nums'>
        {run.cost.byModel.length === 1
          ? intl.formatMessage(
              { id: 'agentRun.cost.perRunTok', defaultMessage: '{tok} tok' },
              { tok: fmtCompact(intl, run.cost.byModel[0]!.total) }
            )
          : run.cost.byModel
              .map(m => `${shortModel(m.model)} ${fmtCompact(intl, m.total)}`)
              .join(' · ')}
      </span>
      {typeof run.cost.loopCount === 'number' && (
        <>
          <span>·</span>
          <span>
            {intl.formatMessage(
              {
                id: 'agentRun.cost.loops',
                defaultMessage: '{n, plural, one {# loop} other {# loops}}',
              },
              { n: run.cost.loopCount }
            )}
          </span>
        </>
      )}
    </>
  )
}
```

When expanded and `run.cost` present, render the per-model breakdown above the turns:

```tsx
      {expanded && (
        <div className='border-t border-border/80 px-4 py-2'>
          {run.cost && (
            <div className="mb-2">
              <TokenCostBreakdown variant="compact" models={run.cost.byModel} loopCount={run.cost.loopCount} />
            </div>
          )}
          {/* existing turns rendering unchanged */}
```

Add helpers at the bottom of the file:

```tsx
function fmtCompact(intl: ReturnType<typeof useIntl>, n: number): string {
  return intl.formatNumber(n, { notation: 'compact', maximumFractionDigits: 1 })
}
function shortModel(model: string): string {
  return model.replace(/^claude-/, '')
}
```

Add `import { TokenCostBreakdown } from '../TokenCostBreakdown'`.

- [ ] **Step 6: TurnCard — per-turn cost on the row**

In `TurnCard.tsx`, render `turn.cost` on the right of the turn header (only when present). Use the same compact pattern:

```tsx
{
  turn.cost && (
    <span className='ml-auto shrink-0 text-right text-[11px] text-muted-foreground tabular-nums'>
      {turn.cost.byModel.length === 1
        ? `${intl.formatNumber(turn.cost.byModel[0]!.total, { notation: 'compact', maximumFractionDigits: 1 })} tok`
        : turn.cost.byModel
            .map(
              m =>
                `${m.model.replace(/^claude-/, '')} ${intl.formatNumber(m.total, { notation: 'compact', maximumFractionDigits: 1 })}`
            )
            .join(' · ')}
      {turn.cost.byModel.length === 1 && (
        <span className='block text-[9px] text-muted-foreground/60'>
          {turn.cost.byModel[0]!.model.replace(/^claude-/, '')}
        </span>
      )}
    </span>
  )
}
```

(Place inside the turn's header flex row; ensure that row is `flex items-start`. If `TurnCard` has no `useIntl`, add `const intl = useIntl()`.)

- [ ] **Step 7: Run the AgentRun UI + type checks**

Run: `npx jest __tests__/components/AgentRunTimeline/segment-turns.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 8: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/AgentRunTimeline lib/i18n/en.json lib/i18n/zh-CN.json __tests__/components/AgentRunTimeline/segment-turns.test.ts
git commit -m "feat: render per-run/per-turn token cost on Agent 运行 tab [LUM-298]"
```

---

## Task 10: i18n — fill all 16 locales

**Files:**

- Modify: `lib/i18n/*.json`

- [ ] **Step 1: Scaffold missing keys**

Run: `npm run i18n:sync`
Expected: back-fills `tokenCost.*` and `agentRun.*` into the other 14 locales with `[TODO:<locale>]` markers.

- [ ] **Step 2: Replace every `[TODO:…]` with a real translation**

Edit each of the 14 non-en/zh-CN locale files: provide a proper translation for `tokenCost.unit/output/input/cacheCreate/cacheRead/none/loops/loopsNa/mixedNoTotal` and `agentRun.summary/cost.perRunTok/cost.loops`. Keep `tok`, `output`, `input`, `cache-create`, `cache-read`, `loops n/a` as-is where they're effectively universal tech terms; translate the prose (`none`, `mixedNoTotal`, `summary`).

- [ ] **Step 3: Verify parity**

Run: `npm run i18n:check`
Expected: no drift, no `[TODO]` remaining.

- [ ] **Step 4: Commit**

```bash
git add lib/i18n
git commit -m "i18n: translations for token-cost keys (16 locales) [LUM-298]"
```

---

## Task 11: Full verification

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Full test suite**

Run: `npx jest`
Expected: all green (incl. LineageTab, session.repository, hook-event.service, timeline, component, segment-turns, transcript-usage, augment).

- [ ] **Step 3: Token lint**

Run: `npm run lint:tokens`
Expected: clean (only `bg-chart-1..4` used; no raw hex).

- [ ] **Step 4: i18n parity**

Run: `npm run i18n:check`
Expected: clean.

- [ ] **Step 5: Build (the only CI gate is Vercel build)**

Run: `npm run build`
Expected: success.

- [ ] **Step 6: Final commit if any fixups were needed, then open PR**

```bash
git push -u origin lumo/LUM-298-agent-run-token-cost
```

PR title: `feat: per-run/per-turn token cost on Agent 运行 tab [LUM-298]`
PR body must note: **requires `prisma migrate deploy` on next deploy** (adds two nullable JSONB columns; additive, no data loss, no backfill). Also note no new npm packages.

---

## Self-review

**Spec coverage:**

- Premise correction / AgentRun excluded → reflected (no AgentRun changes). ✓
- per-run cost from Session columns → Task 6 (`listForTask` select + `cost`). ✓
- per-turn delta capture (schema + STOP transaction) → Tasks 3, 4, 5. ✓
- per-model split, no cross-model total → Tasks 1, 6, 7 (`mergedNoTotal` chip, `RunCost` has no total field). ✓
- shared `<TokenCostBreakdown>`, lineage behavior-preserving → Tasks 7, 8. ✓
- B density (total + bar; run-expand 4 rows; per-turn) → Tasks 7, 9. ✓
- loops real number vs n/a → Task 7 (`loopCount` number vs null). ✓
- skip `<synthetic>`, raw model strings, every turn labeled → Tasks 1, 9. ✓
- i18n 16 locales → Task 10. ✓
- verification (tsc/jest/lint:tokens/build/i18n) → Task 11. ✓

**Placeholder scan:** No TBD/TODO in steps (the `[TODO:<locale>]` markers are i18n:sync output the engineer must replace — explicitly called out in Task 10). ✓

**Type consistency:** `ModelCost`/`ModelUsage`/`RunCost` names identical across CLI (`ModelUsage`), `model-cost.ts` (`ModelCost`), wire types, and components. `upsertForHookEvent` returns `{ taskId, turnUsageByModel }` consistently (Task 4) and consumed in Task 5. `usageByModel` column name consistent across schema/repo/service. `turnCost` (item) → `Turn.cost` (segment) consistent across Tasks 6 & 9. ✓

# Per-Run Token/Loop Cost Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture per-run token usage + loop count onto `AgentRun` (cloud sandbox agent) and `Session` (local Claude Code CLI), and expose a uniform cost shape so a `LineageEdge` can join to its run's cost.

**Architecture:** Add identical nullable cost columns to `AgentRun` and `Session`. For `AgentRun`, parse the final `result` message of `claude --output-format stream-json` (one shared TS parser in `@lumo/shared`) at run completion in both execution paths and persist in `markRunCompleted`. For `Session`, the CLI reads the Stop-hook `transcript_path`, sums `message.usage` across assistant entries, and injects cumulative totals into the forwarded hook payload; the server overwrites the Session token columns and increments a STOP-only `loopCount`. A `getEdgeCost(edge)` mapper picks run cost when `runId` is set, else session cost.

**Tech Stack:** TypeScript (strict), Prisma + Neon Postgres, Next.js App Router routes, Jest, a standalone `agent-server` package, the `@lumoai/cli` package, and Python sandbox callback scripts.

---

## File Structure

**Created:**

- `shared/src/stream-json-usage.ts` — pure parser for the stream-json `result` message → `RunUsage | null`. Shared by the main app and `agent-server`.
- `__tests__/shared/stream-json-usage.test.ts` — parser unit tests.
- `cli/src/lib/transcript-usage.ts` — pure reader: transcript JSONL path → cumulative `SessionUsage | null`.
- `cli/__tests__/lib/transcript-usage.test.ts` — transcript summation tests (mirror existing cli test location/runner).
- `lib/repositories/lineage-cost.ts` — `getEdgeCost(edge)` mapper + `RunCost` type.
- `__tests__/lib/repositories/lineage-cost.test.ts` — mapper tests.
- `prisma/migrations/<timestamp>_add_run_session_cost/migration.sql` — additive columns.

**Modified:**

- `prisma/schema.prisma` — add cost fields to `AgentRun` and `Session`.
- `shared/src/index.ts` — re-export the parser + types.
- `lib/agent/run-lifecycle.ts` — `markRunCompleted` accepts + persists usage.
- `agent-server/src/agent/execute.ts` — `markRunCompleted` accepts + persists usage; foreground reads stdout log + parses; `processAgentCompletion` threads usage.
- `lib/agent/execute.ts` — `processAgentCompletion` parses `claudeStdout` and threads usage to `markRunCompleted`.
- `lib/agent/pipeline.ts` — `send-callback.py` extracts the last stream-json result line into the callback payload.
- `app/api/agent/sandbox-done/route.ts` + `agent-server/src/routes/sandbox-done.ts` — schema accepts optional `resultLine`.
- `lib/services/hook-event.service.ts` — extract injected `_lumo_usage`; pass usage + STOP flag to the session upsert.
- `lib/repositories/session.repository.ts` — `upsertForHookEvent` overwrites cumulative token columns and increments `loopCount` on STOP.
- `cli/src/lib/hook-runner.ts` — on `stop`/`stop-failure`, augment the forwarded body with `_lumo_usage`.

---

## Conventions to follow

- TypeScript strict; `exactOptionalPropertyTypes` is on → declare optional fields as `field?: T | undefined`.
- `noUncheckedIndexedAccess` is on → `arr[i]` is `T | undefined`; guard or `?.`. Only `tsc --noEmit` catches these — run it.
- Prisma client can go stale across parallel worktrees → run `npx prisma generate` before trusting `tsc`.
- Run jest from inside the repo root: `npm test -- <path>`.
- After editing `prisma/schema.prisma`, the dev DB has parallel-branch drift; **do not** `migrate dev`/`reset`. Author the migration offline (Task 1).

---

## Task 1: Schema + offline migration

**Files:**

- Modify: `prisma/schema.prisma` (`AgentRun` @ line 868, `Session` @ line 1432)
- Create: `prisma/migrations/<timestamp>_add_run_session_cost/migration.sql`

- [ ] **Step 1: Add fields to `AgentRun`**

In `model AgentRun`, after `durationMs Int?` (line 881), add:

```prisma
  inputTokens         Int? // claude stream-json result usage.input_tokens
  outputTokens        Int? // usage.output_tokens
  cacheReadTokens     Int? // usage.cache_read_input_tokens
  cacheCreationTokens Int? // usage.cache_creation_input_tokens
  loopCount           Int? // stream-json result num_turns
```

- [ ] **Step 2: Add the same fields to `Session`**

In `model Session`, after `eventCount Int @default(0)` (line 1453), add:

```prisma
  // Per-session cost (LUM-281). Token columns hold CUMULATIVE totals summed by
  // the CLI from the Stop-hook transcript and overwritten on each STOP (not
  // incremented). loopCount counts STOP/STOP_FAILURE events = turns. All null
  // until the first STOP carrying usage; historical rows stay null (no backfill).
  inputTokens         Int?
  outputTokens        Int?
  cacheReadTokens     Int?
  cacheCreationTokens Int?
  loopCount           Int?
```

- [ ] **Step 3: Author the migration SQL offline**

The dev DB has parallel-branch drift, so author the SQL by hand (deterministic, matches the repo's drift-workaround playbook — `migrate diff` flag names drift between Prisma versions). Create `prisma/migrations/<timestamp>_add_run_session_cost/migration.sql` (timestamp newer than the latest existing migration directory) with:

```sql
ALTER TABLE "agent_runs"
  ADD COLUMN "inputTokens" INTEGER,
  ADD COLUMN "outputTokens" INTEGER,
  ADD COLUMN "cacheReadTokens" INTEGER,
  ADD COLUMN "cacheCreationTokens" INTEGER,
  ADD COLUMN "loopCount" INTEGER;

ALTER TABLE "sessions"
  ADD COLUMN "inputTokens" INTEGER,
  ADD COLUMN "outputTokens" INTEGER,
  ADD COLUMN "cacheReadTokens" INTEGER,
  ADD COLUMN "cacheCreationTokens" INTEGER,
  ADD COLUMN "loopCount" INTEGER;
```

- [ ] **Step 4: Apply locally + record + regenerate**

```bash
npx prisma db execute --file prisma/migrations/<timestamp>_add_run_session_cost/migration.sql --schema prisma/schema.prisma
npx prisma migrate resolve --applied <timestamp>_add_run_session_cost
npx prisma generate
```

(If `db execute` rejects `--schema`, drop it; the datasource comes from `prisma.config.ts`. Export `DATABASE_URL_UNPOOLED` from the main checkout `.env.local` if the URL is missing.)

- [ ] **Step 5: Verify the client typecheck sees the columns**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `inputTokens`/`loopCount` on `AgentRun`/`Session`.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add token/loop cost columns to AgentRun + Session [LUM-281]"
```

---

## Task 2: `parseStreamJsonUsage` (shared pure parser)

**Files:**

- Create: `shared/src/stream-json-usage.ts`
- Modify: `shared/src/index.ts`
- Test: `__tests__/shared/stream-json-usage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { parseStreamJsonUsage } from '@lumo/shared'

describe('parseStreamJsonUsage', () => {
  const resultLine = JSON.stringify({
    type: 'result',
    subtype: 'success',
    num_turns: 3,
    duration_ms: 1234,
    total_cost_usd: 0.0421,
    usage: {
      input_tokens: 19185,
      output_tokens: 471,
      cache_read_input_tokens: 17846,
      cache_creation_input_tokens: 17101,
    },
  })

  it('parses usage + num_turns from a stream-json result line', () => {
    expect(parseStreamJsonUsage(resultLine)).toEqual({
      inputTokens: 19185,
      outputTokens: 471,
      cacheReadTokens: 17846,
      cacheCreationTokens: 17101,
      loopCount: 3,
    })
  })

  it('finds the result line inside a multi-line stream-json log', () => {
    const log = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'assistant', message: {} }),
      resultLine,
      '', // trailing newline
    ].join('\n')
    expect(parseStreamJsonUsage(log)?.loopCount).toBe(3)
  })

  it('returns null when there is no result line (crash/timeout)', () => {
    const log = JSON.stringify({ type: 'assistant', message: {} })
    expect(parseStreamJsonUsage(log)).toBeNull()
  })

  it('returns null on empty / non-JSON input', () => {
    expect(parseStreamJsonUsage('')).toBeNull()
    expect(parseStreamJsonUsage('not json\n{bad')).toBeNull()
  })

  it('defaults missing usage sub-fields to 0', () => {
    const line = JSON.stringify({
      type: 'result',
      num_turns: 1,
      usage: { input_tokens: 5, output_tokens: 2 },
    })
    expect(parseStreamJsonUsage(line)).toEqual({
      inputTokens: 5,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      loopCount: 1,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/shared/stream-json-usage.test.ts`
Expected: FAIL — `parseStreamJsonUsage is not a function` (not exported yet).

- [ ] **Step 3: Implement the parser**

Create `shared/src/stream-json-usage.ts`:

```ts
/** Token + loop cost lifted from a `claude --output-format stream-json` run. */
export interface RunUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  loopCount: number
}

function asNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * Parse the final `type: "result"` message of a stream-json claude run.
 * Accepts either the whole stdout log or a single result line. Scans for the
 * LAST parseable line whose `type === 'result'` and lifts `usage.*` +
 * `num_turns`. Returns null when no result line is present (agent crashed or
 * timed out before emitting one) — callers leave the cost columns null.
 */
export function parseStreamJsonUsage(text: string): RunUsage | null {
  if (!text) return null
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim()
    if (!line) continue
    let obj: unknown
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (
      obj &&
      typeof obj === 'object' &&
      (obj as { type?: unknown }).type === 'result'
    ) {
      const r = obj as { num_turns?: unknown; usage?: Record<string, unknown> }
      const usage = r.usage ?? {}
      return {
        inputTokens: asNumber(usage.input_tokens),
        outputTokens: asNumber(usage.output_tokens),
        cacheReadTokens: asNumber(usage.cache_read_input_tokens),
        cacheCreationTokens: asNumber(usage.cache_creation_input_tokens),
        loopCount: asNumber(r.num_turns),
      }
    }
  }
  return null
}
```

- [ ] **Step 4: Re-export from the shared barrel**

In `shared/src/index.ts`, add:

```ts
export { parseStreamJsonUsage } from './stream-json-usage'
export type { RunUsage } from './stream-json-usage'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- __tests__/shared/stream-json-usage.test.ts`
Expected: PASS (all 5).

- [ ] **Step 6: Commit**

```bash
git add shared/src/stream-json-usage.ts shared/src/index.ts __tests__/shared/stream-json-usage.test.ts
git commit -m "feat: add shared parseStreamJsonUsage parser [LUM-281]"
```

---

## Task 3: `markRunCompleted` persists usage (both packages)

**Files:**

- Modify: `lib/agent/run-lifecycle.ts:86-111`
- Modify: `agent-server/src/agent/execute.ts:200-225`

- [ ] **Step 1: Extend `markRunCompleted` in `lib/agent/run-lifecycle.ts`**

Add the import at the top:

```ts
import type { RunUsage } from '@lumo/shared'
```

Change the `data` param type (add one optional field) and the `update` payload:

```ts
export async function markRunCompleted(
  runId: string,
  data: {
    durationMs: number
    prNumber?: number | undefined
    prUrl?: string | undefined
    branchName?: string | undefined
    summary?: string | null | undefined
    changedFiles?: unknown
    usage?: RunUsage | null | undefined
  }
) {
  await prisma.agentRun.update({
    where: { id: runId },
    data: {
      status: 'COMPLETED',
      summary: (data.summary as string) ?? null,
      changedFiles:
        (data.changedFiles as Prisma.InputJsonValue) ?? Prisma.DbNull,
      durationMs: data.durationMs,
      prNumber: data.prNumber ?? null,
      prUrl: data.prUrl ?? null,
      branchName: data.branchName ?? null,
      inputTokens: data.usage?.inputTokens ?? null,
      outputTokens: data.usage?.outputTokens ?? null,
      cacheReadTokens: data.usage?.cacheReadTokens ?? null,
      cacheCreationTokens: data.usage?.cacheCreationTokens ?? null,
      loopCount: data.usage?.loopCount ?? null,
      finishedAt: new Date(),
    },
  })
}
```

- [ ] **Step 2: Mirror the change in `agent-server/src/agent/execute.ts:200`**

Apply the identical type + `update` changes to the local `markRunCompleted`. Import `RunUsage` from `@lumo/shared` (the package already imports from it — see `agent-server/src/agent/errors.ts`).

- [ ] **Step 3: Typecheck both**

Run: `npx tsc --noEmit`
Then for agent-server: `cd agent-server && npx tsc --noEmit && cd ..`
Expected: no errors. (Existing `markRunCompleted` callers omit `usage`, which is optional → still compile.)

- [ ] **Step 4: Commit**

```bash
git add lib/agent/run-lifecycle.ts agent-server/src/agent/execute.ts
git commit -m "feat: markRunCompleted persists token/loop usage [LUM-281]"
```

---

## Task 4: AgentRun client-pipeline wiring (callback → route → completion)

**Files:**

- Modify: `lib/agent/pipeline.ts:137-179` (`send-callback.py`)
- Modify: `app/api/agent/sandbox-done/route.ts:7-14` (schema)
- Modify: `lib/agent/execute.ts:291-359` (`processAgentCompletion`) + its `markRunCompleted` calls

- [ ] **Step 1: Make `send-callback.py` extract the last stream-json result line**

In `lib/agent/pipeline.ts`, inside the `callbackPy` template, after the `stderr` block and before `payload = json.dumps({`, add:

```python
result_line = ""
try:
    with open("/tmp/agent-stdout.log") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            if isinstance(obj, dict) and obj.get("type") == "result":
                result_line = line  # keep the LAST result line
except Exception:
    pass
```

Then add `"resultLine": result_line,` to the `payload = json.dumps({ ... })` object.

- [ ] **Step 2: Accept `resultLine` in the route schema**

In `app/api/agent/sandbox-done/route.ts`, change `bodySchema`:

```ts
const bodySchema = z.object({
  runId: z.string().min(1),
  taskId: z.string().min(1),
  exitCode: z.number(),
  timedOut: z.boolean(),
  stderr: z.string(),
  branchExistsOnRemote: z.boolean(),
  resultLine: z.string().optional(),
})
```

(No other route change — it already forwards `parsed.data` to `processAgentCompletion`.)

- [ ] **Step 3: Thread `resultLine` → usage via `RunContext`**

All three success-path `markRunCompleted` calls (`lib/agent/post-agent.ts:22` in `handleNoCommits`, `:39` in `handleFollowUpNoChanges`, and `lib/agent/github-pr.ts:259` in `createOrReusePR`) receive the same `ctx: RunContext` that `processAgentCompletion` builds at `lib/agent/execute.ts:376-393`. Thread usage as one field on `RunContext`:

1. In `lib/agent/execute.ts`, add the import `import { parseStreamJsonUsage, type RunUsage } from '@lumo/shared'` and add `usage?: RunUsage | null | undefined` to the exported `RunContext` interface.
2. In `processAgentCompletion`, add `resultLine?: string` to the params type, and right after destructuring params compute:

```ts
const usage = params.resultLine ? parseStreamJsonUsage(params.resultLine) : null
```

3. When building `ctx` (the object literal at line 376), add `usage,` to it.
4. In `lib/agent/post-agent.ts:22`, `:39`, and `lib/agent/github-pr.ts:259`, add `usage: ctx.usage,` to each `markRunCompleted(ctx.currentRunId, { … })` data object.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. Confirm `usage` reaches every success-path `markRunCompleted` for this pipeline.

- [ ] **Step 5: Add a regression test for the route schema + threading**

Mirror the existing `__tests__/app/api/agent/` test style (find one with `grep -rl sandbox-done __tests__`). Assert: a callback body with a valid `resultLine` results in `markRunCompleted` being called with a `usage` object whose `loopCount`/`inputTokens` match the parsed line (mock `markRunCompleted`). Assert a body with no `resultLine` calls `markRunCompleted` with `usage: null`.

Run: `npm test -- __tests__/app/api/agent`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/agent/pipeline.ts app/api/agent/sandbox-done/route.ts lib/agent/execute.ts lib/agent/post-agent.ts lib/agent/github-pr.ts __tests__/app/api/agent
git commit -m "feat: capture AgentRun token cost via sandbox callback [LUM-281]"
```

---

## Task 5: AgentRun agent-server wiring (foreground reads stdout log)

**Files:**

- Modify: `agent-server/src/agent/execute.ts` (foreground run @ 1140-1169, `processAgentCompletion` @ 1185)
- Modify: `agent-server/src/routes/sandbox-done.ts:5-14` (schema, for the fallback callback path)

- [ ] **Step 1: Read the stdout log after the foreground run**

In `agent-server/src/agent/execute.ts`, after `const result = await sandbox.commands.run(...)` (line 1151) and before `processAgentCompletion(...)`, read the log from the still-alive sandbox:

```ts
let claudeStdout = ''
try {
  claudeStdout = await sandbox.files.read('/tmp/agent-stdout.log')
} catch {
  // best-effort — leave cost null if the log can't be read
}
```

Pass it into the direct call:

```ts
await processAgentCompletion({
  runId: ctx.currentRunId,
  taskId: ctx.taskId,
  exitCode,
  timedOut,
  stderr,
  branchExistsOnRemote,
  resultLine: claudeStdout,
})
```

(`resultLine` may be the full log; `parseStreamJsonUsage` scans for the last result line.)

- [ ] **Step 2: Thread it through `processAgentCompletion`**

Add `import { parseStreamJsonUsage, type RunUsage } from '@lumo/shared'`. Add `resultLine?: string` to the `processAgentCompletion` params type and compute `const usage = params.resultLine ? parseStreamJsonUsage(params.resultLine) : null`. Mirror the main-app approach: add `usage?: RunUsage | null | undefined` to agent-server's `RunContext`, set it when the ctx is built, and add `usage: ctx.usage,` to each success-path `markRunCompleted` call (lines 601, 627, 764). If a call site uses a params object rather than `ctx`, pass `usage` directly there.

- [ ] **Step 3: Accept `resultLine` in the agent-server route schema**

In `agent-server/src/routes/sandbox-done.ts`, add `resultLine: z.string().optional(),` to `bodySchema` (keeps the fallback HTTP-callback path consistent).

- [ ] **Step 4: Typecheck agent-server**

Run: `cd agent-server && npx tsc --noEmit && cd ..`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add agent-server/src/agent/execute.ts agent-server/src/routes/sandbox-done.ts
git commit -m "feat: capture AgentRun token cost in agent-server foreground path [LUM-281]"
```

---

## Task 6: `computeTranscriptUsage` (CLI pure reader)

**Files:**

- Create: `cli/src/lib/transcript-usage.ts`
- Test: `cli/__tests__/lib/transcript-usage.test.ts` (match the cli test dir/runner — check `cli/package.json` `scripts.test` and an existing `cli/__tests__/lib/*.test.ts`)

- [ ] **Step 1: Write the failing test**

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

describe('sumTranscriptUsage', () => {
  it('sums message.usage across assistant entries (cumulative)', () => {
    const path = fixture([
      { type: 'user', message: {} },
      {
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 100,
            output_tokens: 10,
            cache_read_input_tokens: 5,
            cache_creation_input_tokens: 2,
          },
        },
      },
      {
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 200,
            output_tokens: 20,
            cache_read_input_tokens: 7,
            cache_creation_input_tokens: 3,
          },
        },
      },
    ])
    expect(sumTranscriptUsage(path)).toEqual({
      inputTokens: 300,
      outputTokens: 30,
      cacheReadTokens: 12,
      cacheCreationTokens: 5,
    })
  })

  it('ignores non-assistant lines and missing usage', () => {
    const path = fixture([
      { type: 'system' },
      { type: 'assistant', message: {} },
      {
        type: 'assistant',
        message: { usage: { input_tokens: 1, output_tokens: 1 } },
      },
    ])
    expect(sumTranscriptUsage(path)).toEqual({
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    })
  })

  it('returns null when the file is missing or unreadable', () => {
    expect(sumTranscriptUsage('/no/such/transcript.jsonl')).toBeNull()
  })

  it('returns null when there are no assistant usage entries', () => {
    const path = fixture([{ type: 'user', message: {} }])
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
          message: { usage: { input_tokens: 9, output_tokens: 0 } },
        })
    )
    expect(sumTranscriptUsage(path)).toEqual({
      inputTokens: 9,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npm test -- transcript-usage && cd ..`
Expected: FAIL — module not found / `sumTranscriptUsage is not a function`.

- [ ] **Step 3: Implement the reader**

Create `cli/src/lib/transcript-usage.ts`:

```ts
import { readFileSync } from 'node:fs'

export interface SessionUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

function asNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * Read a Claude Code transcript JSONL and sum `message.usage` across all
 * assistant entries → cumulative session token totals. Best-effort: returns
 * null if the file can't be read or has no assistant usage. Never throws.
 */
export function sumTranscriptUsage(
  transcriptPath: string
): SessionUsage | null {
  let text: string
  try {
    text = readFileSync(transcriptPath, 'utf8')
  } catch {
    return null
  }
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
      message?: { usage?: Record<string, unknown> }
    }
    if (o.type !== 'assistant') continue
    const usage = o.message?.usage
    if (!usage) continue
    seen = true
    total.inputTokens += asNumber(usage.input_tokens)
    total.outputTokens += asNumber(usage.output_tokens)
    total.cacheReadTokens += asNumber(usage.cache_read_input_tokens)
    total.cacheCreationTokens += asNumber(usage.cache_creation_input_tokens)
  }
  return seen ? total : null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npm test -- transcript-usage && cd ..`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add cli/src/lib/transcript-usage.ts cli/__tests__/lib/transcript-usage.test.ts
git commit -m "feat: add CLI transcript usage summation [LUM-281]"
```

---

## Task 7: CLI stop-hook augments the forwarded payload

**Files:**

- Modify: `cli/src/lib/hook-runner.ts:392-437` (`runHookWithBody`)
- Test: extend an existing `cli/__tests__/lib/hook-runner*.test.ts`

- [ ] **Step 1: Write a helper that injects usage into the body**

In `cli/src/lib/hook-runner.ts`, import the reader and add a pure helper (exported for tests):

```ts
import { sumTranscriptUsage } from './transcript-usage'

/**
 * For stop/stop-failure hooks, read the transcript named in the payload and
 * fold cumulative token totals into the body under `_lumo_usage` so the server
 * can persist them on the Session. Best-effort: returns the body unchanged on
 * any failure (no transcript_path, unreadable, unparseable, no usage). The
 * hook is never blocked or failed by this.
 */
export function augmentBodyWithUsage(path: HookPath, body: string): string {
  if (path !== 'stop' && path !== 'stop-failure') return body
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(body || '{}')
  } catch {
    return body
  }
  const transcriptPath = parsed['transcript_path']
  if (typeof transcriptPath !== 'string' || !transcriptPath) return body
  const usage = sumTranscriptUsage(transcriptPath)
  if (!usage) return body
  return JSON.stringify({ ...parsed, _lumo_usage: usage })
}
```

- [ ] **Step 2: Call it before the POST**

In `runHookWithBody`, replace the `body: body || '{}',` in the `fetch` call with a pre-computed value. After building `headers` (around line 429), add:

```ts
const outgoingBody = augmentBodyWithUsage(path, body) || '{}'
```

and change the fetch to `body: outgoingBody,`.

- [ ] **Step 3: Write the test**

`augmentBodyWithUsage` is exported from `hook-runner.ts` (Step 1). In an existing cli hook-runner test file, add:

```ts
import { augmentBodyWithUsage } from '../../src/lib/hook-runner'
```

Assert:

- a `stop` body with a `transcript_path` pointing at a fixture JSONL (reuse the Task 6 fixture helper) yields a body whose parsed `_lumo_usage` equals the summed totals.
- a non-stop path (`pre-tool-use`) returns the body unchanged.
- a `stop` body with no `transcript_path` returns the body unchanged.

Run: `cd cli && npm test -- hook-runner && cd ..`
Expected: PASS.

- [ ] **Step 4: Typecheck CLI**

Run: `cd cli && npx tsc --noEmit && cd ..`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add cli/src/lib/hook-runner.ts cli/__tests__
git commit -m "feat: CLI injects cumulative session token usage on stop hook [LUM-281]"
```

---

## Task 8: Server persists Session token cost + loopCount

**Files:**

- Modify: `lib/services/hook-event.service.ts:62-118`
- Modify: `lib/repositories/session.repository.ts:4-57`
- Test: `__tests__/lib/services/hook-event.service.test.ts`, `__tests__/lib/repositories/session.repository.test.ts` (mirror existing)

- [ ] **Step 1: Extract `_lumo_usage` + STOP flag in the service**

In `lib/services/hook-event.service.ts`, add a typed extractor near `extractStringField`:

```ts
interface InjectedUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

function extractInjectedUsage(payload: unknown): InjectedUsage | null {
  if (!payload || typeof payload !== 'object') return null
  const u = (payload as Record<string, unknown>)['_lumo_usage']
  if (!u || typeof u !== 'object') return null
  const o = u as Record<string, unknown>
  const num = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? v : 0
  return {
    inputTokens: num(o.inputTokens),
    outputTokens: num(o.outputTokens),
    cacheReadTokens: num(o.cacheReadTokens),
    cacheCreationTokens: num(o.cacheCreationTokens),
  }
}
```

In `recordHookEvent`, before the `upsertForHookEvent` call, compute:

```ts
const usage = extractInjectedUsage(payload)
const isStop = type === 'STOP' || type === 'STOP_FAILURE'
```

and pass them into the upsert:

```ts
const session = await sessionRepository.upsertForHookEvent({
  id: sessionId,
  workspaceId: identity.workspace.id,
  workspaceMemberId: memberId,
  cwd,
  ...(agent !== undefined ? { agent } : {}),
  usage,
  isStop,
  now: new Date(),
})
```

- [ ] **Step 2: Apply usage + loopCount in the repository**

In `lib/repositories/session.repository.ts`, extend `UpsertSessionData`:

```ts
interface UpsertSessionData {
  id: string
  workspaceId: string
  workspaceMemberId: string
  cwd: string | null
  agent?: TaskArtifactAgent
  /** Cumulative session token totals from the CLI transcript (STOP only). */
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
  } | null
  /** True when this event is a STOP/STOP_FAILURE → bump loopCount. */
  isStop?: boolean
  now: Date
}
```

Rewrite `upsertForHookEvent`’s update/create to overwrite cumulative tokens and increment `loopCount` on STOP:

```ts
async upsertForHookEvent(data: UpsertSessionData) {
  const setOnUpdate: Prisma.SessionUpdateInput = {
    lastActivityAt: data.now,
    eventCount: { increment: 1 },
  }
  if (data.cwd !== null) setOnUpdate.cwd = data.cwd
  if (data.usage) {
    // Cumulative totals — OVERWRITE, not increment (the CLI re-reads the whole
    // transcript each STOP, so the latest value is the running total).
    setOnUpdate.inputTokens = data.usage.inputTokens
    setOnUpdate.outputTokens = data.usage.outputTokens
    setOnUpdate.cacheReadTokens = data.usage.cacheReadTokens
    setOnUpdate.cacheCreationTokens = data.usage.cacheCreationTokens
  }
  if (data.isStop) setOnUpdate.loopCount = { increment: 1 }

  return prisma.session.upsert({
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
      ...(data.usage
        ? {
            inputTokens: data.usage.inputTokens,
            outputTokens: data.usage.outputTokens,
            cacheReadTokens: data.usage.cacheReadTokens,
            cacheCreationTokens: data.usage.cacheCreationTokens,
          }
        : {}),
      ...(data.isStop ? { loopCount: 1 } : {}),
    },
    update: setOnUpdate,
    select: { id: true, taskId: true },
  })
}
```

- [ ] **Step 3: Write/extend tests**

Repository test (`session.repository.test.ts`): assert that an update with `usage` + `isStop: true` calls `prisma.session.upsert` with `update.inputTokens === <value>` (overwrite, not `{ increment }`) and `update.loopCount === { increment: 1 }`; and that without `usage`/`isStop` neither appears. (Mock `prisma.session.upsert`, inspect call args — same style as existing repo tests.)

Service test (`hook-event.service.test.ts`): a STOP payload containing `_lumo_usage` forwards `usage` + `isStop: true` to `upsertForHookEvent`; a PRE_TOOL_USE payload forwards `usage: null`, `isStop: false`.

Run: `npm test -- session.repository hook-event.service`
Expected: PASS.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (mind `exactOptionalPropertyTypes` on the new optional fields).

- [ ] **Step 5: Commit**

```bash
git add lib/services/hook-event.service.ts lib/repositories/session.repository.ts __tests__/lib
git commit -m "feat: persist cumulative session token cost + loopCount on hook events [LUM-281]"
```

---

## Task 9: `getEdgeCost` aggregation mapper

**Files:**

- Create: `lib/repositories/lineage-cost.ts`
- Test: `__tests__/lib/repositories/lineage-cost.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { getEdgeCost } from '@/lib/repositories/lineage-cost'

const cost = {
  inputTokens: 10,
  outputTokens: 2,
  cacheReadTokens: 1,
  cacheCreationTokens: 0,
  loopCount: 3,
}

describe('getEdgeCost', () => {
  it('returns the run cost when runId/run is present (run-first)', () => {
    const edge = {
      runId: 'run_1',
      run: { ...cost },
      sessionId: 'sess_1',
      session: { ...cost, inputTokens: 999 },
    }
    expect(getEdgeCost(edge)).toEqual(cost)
  })

  it('falls back to session cost when there is no run', () => {
    const edge = {
      runId: null,
      run: null,
      sessionId: 'sess_1',
      session: { ...cost },
    }
    expect(getEdgeCost(edge)).toEqual(cost)
  })

  it('returns null when neither side carries cost', () => {
    expect(
      getEdgeCost({ runId: null, run: null, sessionId: null, session: null })
    ).toBeNull()
  })

  it('treats an all-null run as no cost and falls back to session', () => {
    const edge = {
      runId: 'run_1',
      run: {
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheCreationTokens: null,
        loopCount: null,
      },
      sessionId: 'sess_1',
      session: { ...cost },
    }
    expect(getEdgeCost(edge)).toEqual(cost)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lineage-cost`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the mapper**

Create `lib/repositories/lineage-cost.ts`:

```ts
/** Uniform per-run cost shape consumed by LineageEdge readers (LUM-275). */
export interface RunCost {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  loopCount: number
}

interface CostColumns {
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
  loopCount: number | null
}

interface EdgeCostInput {
  runId: string | null
  run: CostColumns | null
  sessionId: string | null
  session: CostColumns | null
}

function toCost(c: CostColumns | null | undefined): RunCost | null {
  if (!c) return null
  const allNull =
    c.inputTokens === null &&
    c.outputTokens === null &&
    c.cacheReadTokens === null &&
    c.cacheCreationTokens === null &&
    c.loopCount === null
  if (allNull) return null
  return {
    inputTokens: c.inputTokens ?? 0,
    outputTokens: c.outputTokens ?? 0,
    cacheReadTokens: c.cacheReadTokens ?? 0,
    cacheCreationTokens: c.cacheCreationTokens ?? 0,
    loopCount: c.loopCount ?? 0,
  }
}

/**
 * Resolve a LineageEdge's cost: prefer the AgentRun (the run that produced the
 * outcome), fall back to the Session. Returns null when neither side has any
 * captured cost. This is the DoD ④ exit (LUM-281) consumed by lineage readers.
 */
export function getEdgeCost(edge: EdgeCostInput): RunCost | null {
  return toCost(edge.run) ?? toCost(edge.session)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lineage-cost`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/lineage-cost.ts __tests__/lib/repositories/lineage-cost.test.ts
git commit -m "feat: add getEdgeCost mapper for LineageEdge cost join [LUM-281]"
```

---

## Task 10: Full verification + PR prep

- [ ] **Step 1: Merge fresh origin/main, regenerate, full typecheck**

```bash
git fetch origin main && git merge origin/main
npx prisma generate
npx tsc --noEmit
cd agent-server && npx tsc --noEmit && cd ..
cd cli && npx tsc --noEmit && cd ..
```

Expected: clean. Confirm `git status` shows **no** deletions under `prisma/migrations/`.

- [ ] **Step 2: Full test + lint**

```bash
npm test
cd cli && npm test && cd ..
npm run lint
```

Expected: all green. (No `lint:tokens` impact — no UI/colors. No new i18n keys.)

- [ ] **Step 3: CLI publish prerequisites (do NOT publish yet)**

The CLI changed (`cli/src/lib/`). Per CLAUDE.md, bump `cli/package.json` (feat → minor) so `lumo update` ships it; `npm publish` is a manual post-merge step. `cli/src/commands/` did **not** change → no `SKILL.md` update needed. Note both in the PR description.

```bash
# bump version field in cli/package.json (minor), then:
git add cli/package.json
git commit -m "chore: bump cli version for token-usage hook [LUM-281]"
```

- [ ] **Step 4: Push + open PR**

```bash
git push -u origin lumo/LUM-281-per-run-token-cost
```

PR title: `feat: capture per-run token/loop cost onto Run/Session [LUM-281]`. In the body, note:

- New columns on `agent_runs` + `sessions` → **production requires `migrate deploy` on next deploy** (additive, non-destructive).
- CLI version bumped; needs a manual `cd cli && npm publish` after merge.
- No new npm packages.

---

## Self-Review notes (spec coverage)

- Spec §1 data model → Task 1. §2 AgentRun capture (both paths) → Tasks 2–5. §3 Session capture → Tasks 6–8. §4 aggregation exposure → Task 9. §5 error handling → best-effort null paths in Tasks 2/5/6/7. §6 testing → tests in Tasks 2,4,5,6,7,8,9. §7 out-of-scope respected (no USD/UI/backfill). Cross-cutting (CLI bump, migrate deploy) → Task 10.
- Type names consistent across tasks: `RunUsage` (shared parser output, AgentRun side), `SessionUsage` (CLI transcript output), `InjectedUsage` (server-side `_lumo_usage`), `RunCost` (mapper output). These are deliberately distinct shapes: `RunUsage`/`RunCost` carry `loopCount`; `SessionUsage`/`InjectedUsage` carry tokens only (session loopCount is server-derived from STOP count, not transcript).

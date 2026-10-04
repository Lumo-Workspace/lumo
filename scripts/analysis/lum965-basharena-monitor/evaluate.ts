/**
 * LUM-965 evaluate — runs one monitor shape over one split of monitor-eval
 * through the Vercel AI Gateway (`@/lib/ai/gateway`, zero data retention
 * forced) and appends one JSON line per call to a local results file.
 *
 *   DOTENV_CONFIG_PATH=<main checkout>/.env.local npx tsx -r dotenv/config \
 *     scripts/analysis/lum965-basharena-monitor/evaluate.ts \
 *     --approach whole|authz-action --model anthropic/claude-sonnet-4.6 \
 *     --split tune [--variant v1] [--budget 30] [--concurrency 6]
 *     [--limit N] [--dry-run] [--out ~/.cache/lumo-lum965/results.jsonl]
 *
 * Splits: `tune` / `holdout` (monitor-eval, see split.ts) and `fresh` /
 * `fresh-unsuccessful` (ControlArena trajectories from
 * `controlarena/generate.py export`). Every split but `tune` additionally
 * needs `--holdout-once`, and is refused when the results file already holds
 * judgements for that split / approach / variant / model: each holdout is
 * scored exactly once, after tuning is frozen.
 *
 * Read-only for Lumo: no DB, no Lumo writes. Resumable: units with a
 * successful record are skipped. The run stops before a new call once the
 * gateway-reported spend of the WHOLE results file reaches --budget (USD),
 * and immediately on a non-retryable gateway error (out of credit, bad key).
 * A failed call is recorded with suspicion = null — scoring treats it as
 * "not flagged", never as a detection.
 */
import '@/lib/ai/gateway'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { generateObject, type ModelMessage } from 'ai'
import type { z } from 'zod'
import { gateway } from '@/lib/ai/gateway'
import { DEFAULT_CACHE_DIR, loadSplit } from '../lum948-basharena/download'
import {
  candidatesOf,
  monitorEvalTrajectories,
  type Candidate,
  type MonitorEvalRow,
  type MonitorEvalTrajectory,
} from '../lum958-basharena-llm/candidates'
import { repairJudgeText } from '../lum958-basharena-llm/prompt'
import { isFatalError } from '../lum958-basharena-llm/report'
import {
  ACTION_JUDGE_SYSTEM_PROMPT,
  AUTHZ_SYSTEM_PROMPT,
  ActionJudgeSchema,
  AuthzSchema,
  WHOLE_JUDGE_SYSTEM_PROMPT,
  WholeJudgeSchema,
  buildActionBlock,
  buildActionTaskBlock,
  buildAuthzPrompt,
  buildWholePrompt,
  type Authz,
} from './prompts'
import {
  APPROACHES,
  doneUnits,
  holdoutGuard,
  type Approach,
  type MonitorRecord,
} from './records'
import { splitTrajectories, type Split } from './split'
import {
  freshTrajectories,
  parseExport,
  type FreshTrajectory,
} from './controlarena/trajectories'

export const DEFAULT_OUT = join(
  homedir(),
  '.cache',
  'lumo-lum965',
  'results.jsonl'
)

const TIMEOUT_MS = 180_000

/** `generate.py export` output — the fresh ControlArena trajectories. */
export const FRESH_EXPORT = join(
  homedir(),
  '.cache',
  'lumo-lum965',
  'ca-trajectories.jsonl'
)

export type Trajectory = MonitorEvalTrajectory | FreshTrajectory

export const SPLITS: Split[] = [
  'tune',
  'holdout',
  'fresh',
  'fresh-unsuccessful',
]

export interface Corpus {
  trajectories: Trajectory[]
  split: Map<string, Split>
  candidates: Candidate[]
}

export async function loadCorpus(
  cacheDir: string = DEFAULT_CACHE_DIR,
  freshExport: string = FRESH_EXPORT
): Promise<Corpus> {
  const rows = await loadSplit(
    cacheDir,
    'abhayesian/basharena-monitor-eval',
    'train',
    { log: m => process.stderr.write(`${m}\n`) }
  )
  const monitorEval = monitorEvalTrajectories(
    rows as unknown as MonitorEvalRow[]
  )
  const split = new Map<string, Split>(splitTrajectories(monitorEval))
  const trajectories: Trajectory[] = [...monitorEval]
  let exported = ''
  try {
    exported = await readFile(freshExport, 'utf8')
  } catch {
    // no fresh trajectories generated yet
  }
  if (exported) {
    const fresh = freshTrajectories(parseExport(exported))
    trajectories.push(...fresh.trajectories)
    for (const [id, s] of Array.from(fresh.split.entries())) split.set(id, s)
  }
  return {
    trajectories,
    split,
    candidates: trajectories.flatMap(t => candidatesOf(t, t.taskDescription)),
  }
}

export type { Approach, MonitorRecord }

export async function readRecords(path: string): Promise<MonitorRecord[]> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return []
  }
  return raw
    .split('\n')
    .filter(l => l.trim() !== '')
    .map(l => JSON.parse(l) as MonitorRecord)
}

function gatewayCost(meta: unknown): number | null {
  const g = (meta as { gateway?: { cost?: unknown } } | undefined)?.gateway
  const n = Number(g?.cost)
  return Number.isFinite(n) ? n : null
}

type Usage = {
  inputTokens?: number
  outputTokens?: number
  inputTokenDetails?: { cacheReadTokens?: number }
}

async function call<S extends z.ZodTypeAny>(opts: {
  model: string
  schema: S
  system: string
  messages: ModelMessage[]
  maxOutputTokens: number
}): Promise<{
  object: z.infer<S>
  usage: Usage
  costUsd: number | null
  latencyMs: number
}> {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now()
    try {
      const r = await generateObject({
        model: gateway(opts.model),
        schema: opts.schema,
        system: opts.system,
        messages: opts.messages,
        maxOutputTokens: opts.maxOutputTokens,
        temperature: 0,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        experimental_repairText: async ({ text }) => repairJudgeText(text),
      })
      return {
        object: r.object as z.infer<S>,
        usage: r.usage as Usage,
        costUsd: gatewayCost(r.providerMetadata),
        latencyMs: Date.now() - started,
      }
    } catch (err) {
      lastError = err
      if (isFatalError((err as Error).message)) break
    }
  }
  throw lastError
}

function failed(
  base: Pick<
    MonitorRecord,
    'approach' | 'variant' | 'model' | 'split' | 'trajectoryId' | 'unitId'
  >,
  err: unknown
): MonitorRecord {
  return {
    ...base,
    suspicion: null,
    category: null,
    reason: '',
    detail: null,
    error: (err as Error).message.slice(0, 300),
    latencyMs: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    costUsd: null,
  }
}

function usageFields(r: {
  usage: Usage
  costUsd: number | null
  latencyMs: number
}) {
  return {
    latencyMs: r.latencyMs,
    inputTokens: r.usage.inputTokens ?? 0,
    cacheReadTokens: r.usage.inputTokenDetails?.cacheReadTokens ?? 0,
    outputTokens: r.usage.outputTokens ?? 0,
    costUsd: r.costUsd,
  }
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

export async function judgeWhole(
  model: string,
  variant: string,
  split: Split,
  t: Trajectory
): Promise<MonitorRecord> {
  const base = {
    approach: 'whole' as const,
    variant,
    model,
    split,
    trajectoryId: t.id,
    unitId: t.id,
  }
  try {
    const r = await call({
      model,
      schema: WholeJudgeSchema,
      system: WHOLE_JUDGE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildWholePrompt(t.taskDescription, t.events),
        },
      ],
      maxOutputTokens: 2_500,
    })
    return {
      ...base,
      suspicion: clamp01(r.object.suspicion / 100),
      category: r.object.category,
      reason: r.object.reason,
      detail: { authorized: r.object.authorized, findings: r.object.findings },
      error: null,
      ...usageFields(r),
    }
  } catch (err) {
    return failed(base, err)
  }
}

export async function extractAuthz(
  model: string,
  variant: string,
  split: Split,
  t: Trajectory
): Promise<MonitorRecord> {
  const base = {
    approach: 'authz-extract' as const,
    variant,
    model,
    split,
    trajectoryId: t.id,
    unitId: t.id,
  }
  try {
    const r = await call({
      model,
      schema: AuthzSchema,
      system: AUTHZ_SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: buildAuthzPrompt(t.taskDescription) },
      ],
      maxOutputTokens: 1_500,
    })
    return {
      ...base,
      suspicion: null,
      category: null,
      reason: '',
      detail: r.object,
      error: null,
      ...usageFields(r),
    }
  } catch (err) {
    return failed(base, err)
  }
}

export async function judgeAction(
  model: string,
  variant: string,
  split: Split,
  c: Candidate,
  authz: Authz
): Promise<MonitorRecord> {
  const base = {
    approach: 'authz-action' as const,
    variant,
    model,
    split,
    trajectoryId: c.trajectoryId,
    unitId: c.id,
  }
  try {
    const r = await call({
      model,
      schema: ActionJudgeSchema,
      system: ACTION_JUDGE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: buildActionTaskBlock(c, authz),
              // Same prefix for every action of a trajectory.
              providerOptions: {
                anthropic: { cacheControl: { type: 'ephemeral' } },
              },
            },
            { type: 'text', text: buildActionBlock(c) },
          ],
        },
      ],
      maxOutputTokens: 800,
    })
    return {
      ...base,
      suspicion: clamp01(r.object.suspicion),
      category: r.object.category,
      reason: r.object.reason,
      detail: { comparison: r.object.comparison },
      error: null,
      ...usageFields(r),
    }
  } catch (err) {
    return failed(base, err)
  }
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const out = flag('--out') ?? DEFAULT_OUT
  const approach = flag('--approach') as Approach
  if (!APPROACHES.includes(approach as (typeof APPROACHES)[number]))
    throw new Error(`--approach must be one of ${APPROACHES.join(', ')}`)
  const model = flag('--model')
  if (!model) throw new Error('--model is required')
  const split = flag('--split') as Split
  if (!SPLITS.includes(split))
    throw new Error(`--split must be one of ${SPLITS.join(', ')}`)
  const variant = flag('--variant') ?? 'v1'
  const budget = Number(flag('--budget') ?? 30)
  const limit = Number(flag('--limit') ?? Infinity)
  const concurrency = Number(flag('--concurrency') ?? 6)
  const dryRun = process.argv.includes('--dry-run')

  const corpus = await loadCorpus(flag('--cache-dir') ?? DEFAULT_CACHE_DIR)
  const trajs = corpus.trajectories
    .filter(t => corpus.split.get(t.id) === split)
    .slice(0, limit)
  const attacks = trajs.filter(t => t.label === 'attack').length
  const candidates = corpus.candidates.filter(c =>
    trajs.some(t => t.id === c.trajectoryId)
  )
  process.stdout.write(
    `${split}: ${trajs.length} trajectories (${attacks} attack / ${trajs.length - attacks} honest) · ${candidates.length} candidate actions\n`
  )
  if (dryRun) {
    const chars = trajs.reduce(
      (n, t) => n + buildWholePrompt(t.taskDescription, t.events).length,
      0
    )
    process.stdout.write(
      `whole: ~${Math.round(chars / 4 / 1000)}k input tokens\n`
    )
    return
  }

  await mkdir(dirname(out), { recursive: true })
  const records = await readRecords(out)
  if (split !== 'tune') {
    const refused = holdoutGuard(
      records,
      split,
      approach,
      variant,
      model,
      process.argv
    )
    if (refused) throw new Error(refused)
  }
  let spent = records.reduce((s, r) => s + (r.costUsd ?? 0), 0)
  process.stdout.write(
    `results file spend $${spent.toFixed(2)} of $${budget}\n`
  )

  let stopped: string | null = null
  const record = async (r: MonitorRecord): Promise<boolean> => {
    if (r.error !== null && isFatalError(r.error)) {
      // Not recorded: a resumed run should make this call again.
      stopped = `fatal gateway error: ${r.error}`
      return false
    }
    spent += r.costUsd ?? 0
    await appendFile(out, `${JSON.stringify(r)}\n`)
    return true
  }
  const overBudget = (): boolean => {
    if (spent >= budget) stopped ??= `budget $${budget} reached`
    return stopped !== null
  }

  const pool = async <T>(
    items: T[],
    fn: (item: T) => Promise<void>
  ): Promise<void> => {
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < items.length && !overBudget()) await fn(items[next++]!)
    }
    await Promise.all(Array.from({ length: concurrency }, worker))
  }

  let n = 0
  const progress = (total: number) => {
    n++
    if (n % 20 === 0 || n === total)
      process.stdout.write(`  ${n}/${total} · $${spent.toFixed(2)}\n`)
  }

  if (approach === 'whole') {
    const done = doneUnits(records, 'whole', variant, model)
    const todo = trajs.filter(t => !done.has(t.id))
    process.stdout.write(`whole/${variant}/${model}: ${todo.length} to judge\n`)
    await pool(todo, async t => {
      await record(await judgeWhole(model, variant, split, t))
      progress(todo.length)
    })
  } else {
    // Step 1: one authorization list per trajectory (cached in the file).
    const authz = doneUnits(records, 'authz-extract', variant, model)
    const needAuthz = trajs.filter(t => !authz.has(t.id))
    process.stdout.write(`authz-extract: ${needAuthz.length} to extract\n`)
    await pool(needAuthz, async t => {
      const r = await extractAuthz(model, variant, split, t)
      if ((await record(r)) && r.error === null) authz.set(t.id, r)
    })
    // Step 2: every candidate action, trajectory-grouped for the cache.
    const done = doneUnits(records, 'authz-action', variant, model)
    const groups = trajs
      .map(t => ({
        authz: authz.get(t.id)?.detail as Authz | undefined,
        cs: candidates.filter(c => c.trajectoryId === t.id && !done.has(c.id)),
      }))
      .filter(g => g.authz && g.cs.length > 0)
    const total = groups.reduce((s, g) => s + g.cs.length, 0)
    process.stdout.write(
      `authz-action/${variant}/${model}: ${total} to judge\n`
    )
    await pool(groups, async g => {
      for (const c of g.cs) {
        if (overBudget()) return
        await record(await judgeAction(model, variant, split, c, g.authz!))
        progress(total)
      }
    })
  }
  process.stdout.write(
    `${stopped ? `${stopped} — stopped` : 'done'} · results file spend $${spent.toFixed(2)}\n`
  )
}

if (process.argv[1]?.endsWith('lum965-basharena-monitor/evaluate.ts')) {
  main().catch(err => {
    process.stderr.write(`lum965 evaluate: ${(err as Error).message}\n`)
    process.exit(1)
  })
}

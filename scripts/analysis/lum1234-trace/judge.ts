/**
 * LUM-1234 — whole-trajectory reward-hack LLM judge over TRACE, through the
 * Vercel AI Gateway with zero data retention forced (`generateEvalObject` →
 * `@/lib/ai/gateway`). Appends one LUM-965-format JSON line per trajectory
 * to a results file OUTSIDE the repo; score it with the shared harness:
 *
 *   DOTENV_CONFIG_PATH=<main checkout>/.env.local npx tsx -r dotenv/config \
 *     scripts/analysis/lum1234-trace/judge.ts --model anthropic/claude-sonnet-4.6 \
 *     [--budget 10] [--concurrency 6] [--limit N] [--dry-run] [--data <cache>] [--out <file>]
 *   npx tsx scripts/crossing-eval.ts --dataset trace --judge recorded \
 *     --records ~/.cache/lumo-lum1234-trace/judge.jsonl --config whole/trace-v1/<model> --threshold 0.5
 *
 * Read-only for Lumo: no DB, no Lumo writes. Resumable (a trajectory with a
 * successful record is skipped). Stops before a new call once the
 * gateway-reported spend of the WHOLE results file reaches --budget (USD),
 * and on a non-retryable gateway error. A failed call is recorded with
 * suspicion = null (scored "not flagged"). `reason` / `evidence` pass
 * through `redactForStorage` before they are written.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { redactForStorage } from '@/lib/security-scan/scan-secrets'
import { generateEvalObject } from '@/ee/private/llm/offline-eval-client'
import { repairJudgeText } from '../lum958-basharena-llm/prompt'
import { isFatalError } from '../lum958-basharena-llm/report'
import { convertTraceRow } from './convert'
import {
  REWARD_HACK_SYSTEM_PROMPT,
  RewardHackJudgeSchema,
  buildRewardHackPrompt,
} from './judge-prompt'
import { resolveTraceFile } from './source'

export const VARIANT = 'trace-v1'
export const DEFAULT_JUDGE_OUT = join(
  homedir(),
  '.cache',
  'lumo-lum1234-trace',
  'judge.jsonl'
)
const TIMEOUT_MS = 240_000

/** LUM-965 `MonitorRecord` shape, so `--judge recorded` reads it as is. */
export interface TraceJudgeRecord {
  approach: 'whole'
  variant: string
  model: string
  split: 'trace'
  trajectoryId: string
  unitId: string
  suspicion: number | null
  category: null
  reason: string
  detail: { evidence: string } | null
  error: string | null
  latencyMs: number
  inputTokens: number
  cacheReadTokens: number
  outputTokens: number
  costUsd: number | null
}

export function gatewayCost(meta: unknown): number | null {
  const g = (meta as { gateway?: { cost?: unknown } } | undefined)?.gateway
  if (g?.cost === undefined || g.cost === null) return null
  const n = Number(g.cost)
  return Number.isFinite(n) ? n : null
}

/** Trajectory ids that already have a success record for this model. */
export function doneIds(
  records: TraceJudgeRecord[],
  model: string,
  variant: string = VARIANT
): Set<string> {
  return new Set(
    records
      .filter(r => r.model === model && r.variant === variant && !r.error)
      .map(r => r.trajectoryId)
  )
}

/**
 * Pilot order: alternate the two classes so `--limit N` is balanced. Labels
 * pick the order only; they never reach the prompt.
 */
export function interleave<T extends { hacked: boolean }>(items: T[]): T[] {
  const a = items.filter(i => i.hacked)
  const b = items.filter(i => !i.hacked)
  const out: T[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i]!)
    if (b[i]) out.push(b[i]!)
  }
  return out
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const redact = (s: string) => redactForStorage(s).text

export async function judgeTrajectory(
  model: string,
  id: string,
  conversation: unknown
): Promise<TraceJudgeRecord> {
  const base = {
    approach: 'whole' as const,
    variant: VARIANT,
    model,
    split: 'trace' as const,
    trajectoryId: id,
    unitId: id,
    category: null,
  }
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now()
    try {
      const r = await generateEvalObject({
        model,
        schema: RewardHackJudgeSchema,
        system: REWARD_HACK_SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: buildRewardHackPrompt(conversation) },
        ],
        maxOutputTokens: 1_500,
        timeoutMs: TIMEOUT_MS,
        repairText: repairJudgeText,
      })
      return {
        ...base,
        suspicion: clamp01(r.object.suspicion / 100),
        reason: redact(r.object.reason),
        detail: { evidence: redact(r.object.evidence) },
        error: null,
        latencyMs: Date.now() - started,
        inputTokens: r.usage.inputTokens ?? 0,
        cacheReadTokens: r.usage.inputTokenDetails?.cacheReadTokens ?? 0,
        outputTokens: r.usage.outputTokens ?? 0,
        costUsd: gatewayCost(r.providerMetadata),
      }
    } catch (err) {
      lastError = err
      if (isFatalError((err as Error).message)) break
    }
  }
  return {
    ...base,
    suspicion: null,
    reason: '',
    detail: null,
    error: redact((lastError as Error)?.message ?? String(lastError)).slice(
      0,
      300
    ),
    latencyMs: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    costUsd: null,
  }
}

async function readJudgeRecords(path: string): Promise<TraceJudgeRecord[]> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return []
  }
  return raw
    .split('\n')
    .filter(l => l.trim() !== '')
    .map(l => JSON.parse(l) as TraceJudgeRecord)
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const model = flag('--model')
  if (!model) throw new Error('--model is required')
  const out = flag('--out') ?? DEFAULT_JUDGE_OUT
  const budget = Number(flag('--budget') ?? 10)
  const limit = Number(flag('--limit') ?? Infinity)
  const concurrency = Number(flag('--concurrency') ?? 6)
  const file = resolveTraceFile(flag('--data'))
  const rows = JSON.parse(await readFile(file, 'utf8')) as Record<
    string,
    unknown
  >[]
  const all = interleave(
    rows.map(row => ({ row, ...convertTraceRow(row) }))
  ).slice(0, limit)
  if (process.argv.includes('--dry-run')) {
    const chars = all.reduce(
      (n, t) => n + buildRewardHackPrompt(t.row.conversation).length,
      0
    )
    process.stdout.write(
      `${all.length} trajectories · ~${(chars / 4 / 1e6).toFixed(2)}M input tokens (chars/4)\n`
    )
    return
  }
  await mkdir(dirname(out), { recursive: true })
  const records = await readJudgeRecords(out)
  let spent = records.reduce((s, r) => s + (r.costUsd ?? 0), 0)
  const done = doneIds(records, model)
  const todo = all.filter(t => !done.has(t.id))
  process.stdout.write(
    `${model}: ${todo.length} to judge · results file spend $${spent.toFixed(2)} of $${budget}\n`
  )
  let stopped: string | null = null
  let next = 0
  let n = 0
  const worker = async (): Promise<void> => {
    while (next < todo.length && !stopped) {
      if (spent >= budget) {
        stopped = `budget $${budget} reached`
        break
      }
      const t = todo[next++]!
      const r = await judgeTrajectory(model, t.id, t.row.conversation)
      if (r.error !== null && isFatalError(r.error)) {
        stopped = `fatal gateway error: ${r.error}`
        break
      }
      spent += r.costUsd ?? 0
      await appendFile(out, `${JSON.stringify(r)}\n`)
      n++
      if (n % 20 === 0 || n === todo.length) {
        process.stdout.write(`  ${n}/${todo.length} · $${spent.toFixed(2)}\n`)
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  process.stdout.write(
    `${stopped ? `${stopped} — stopped` : 'done'} · results file spend $${spent.toFixed(2)}\n`
  )
}

if (process.argv[1]?.endsWith('lum1234-trace/judge.ts')) {
  main().catch(err => {
    process.stderr.write(`lum1234 judge: ${(err as Error).message}\n`)
    process.exit(1)
  })
}

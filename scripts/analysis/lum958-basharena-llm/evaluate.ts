/**
 * LUM-958 evaluate — sends every candidate action to each judge model through
 * the Vercel AI Gateway (`@/lib/ai/gateway`, zero data retention forced) and
 * appends one JSON line per judgement to a local results file.
 *
 *   DOTENV_CONFIG_PATH=<main checkout>/.env.local npx tsx -r dotenv/config \
 *     scripts/analysis/lum958-basharena-llm/evaluate.ts \
 *     --out ~/.cache/lumo-lum958/results.jsonl \
 *     [--models a,b] [--datasets monitor-eval,synthetic:test,synthetic:train]
 *     [--budget 30] [--limit N] [--concurrency 8] [--dry-run]
 *
 * Read-only for Lumo: no DB, no Lumo writes. Network: the HF download (cached
 * by LUM-948's loader, outside the repo) and the gateway calls.
 *
 * Resumable: results already in --out without an error are skipped. The run
 * stops before starting a new call once the gateway-reported spend of the
 * results file reaches --budget (USD). A failed call (after one retry) is
 * recorded with its error and suspicion = null — scoring treats it as
 * "not flagged", never as a detection.
 */
import '@/lib/ai/gateway'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { generateObject } from 'ai'
import { gateway } from '@/lib/ai/gateway'
import {
  DEFAULT_CACHE_DIR,
  SOURCES,
  loadSplit,
} from '../lum948-basharena/download'
import {
  groupByTrajectory,
  monitorEvalCandidates,
  sampleTrajectories,
  syntheticCandidates,
  type Candidate,
  type MonitorEvalRow,
  type SyntheticRow,
  type TrajectoryMeta,
} from './candidates'
import {
  JUDGE_SYSTEM_PROMPT,
  JudgeSchema,
  buildActionBlock,
  buildTaskBlock,
  repairJudgeText,
} from './prompt'
import { isFatalError, type JudgeResult } from './report'

export const DEFAULT_MODELS = [
  'anthropic/claude-haiku-4.5',
  'anthropic/claude-sonnet-4.6',
  'openai/gpt-4.1-mini',
] as const

/**
 * synthetic:train is 839 trajectories; a fixed stratified sample keeps the
 * spend inside the task budget. monitor-eval and synthetic:test run whole.
 */
export const SYNTHETIC_TRAIN_SAMPLE: Record<string, number> = {
  honest: 40,
  '*': 20,
}

export const DEFAULT_OUT = join(
  homedir(),
  '.cache',
  'lumo-lum958',
  'results.jsonl'
)

const TIMEOUT_MS = 120_000
const MAX_OUTPUT_TOKENS = 600

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

export interface Corpus {
  meta: TrajectoryMeta[]
  candidates: Candidate[]
}

export async function loadCorpus(
  cacheDir: string = DEFAULT_CACHE_DIR
): Promise<Corpus> {
  const meta: TrajectoryMeta[] = []
  const candidates: Candidate[] = []
  for (const src of SOURCES) {
    const rows = await loadSplit(cacheDir, src.dataset, src.split, {
      log: m => process.stderr.write(`${m}\n`),
    })
    if (src.dataset.endsWith('monitor-eval')) {
      const r = monitorEvalCandidates(rows as unknown as MonitorEvalRow[])
      meta.push(...r.meta)
      candidates.push(...r.candidates)
      continue
    }
    const r = syntheticCandidates(rows as unknown as SyntheticRow[], src.split)
    if (src.split === 'train') {
      const keep = sampleTrajectories(r.meta, SYNTHETIC_TRAIN_SAMPLE)
      meta.push(...r.meta.filter(m => keep.has(`${m.dataset}|${m.id}`)))
      candidates.push(
        ...r.candidates.filter(c => keep.has(`${c.dataset}|${c.trajectoryId}`))
      )
    } else {
      meta.push(...r.meta)
      candidates.push(...r.candidates)
    }
  }
  return { meta, candidates }
}

function gatewayCost(meta: unknown): number | null {
  const g = (meta as { gateway?: { cost?: unknown } } | undefined)?.gateway
  const n = Number(g?.cost)
  return Number.isFinite(n) ? n : null
}

async function judgeOnce(model: string, c: Candidate): Promise<JudgeResult> {
  let repaired = false
  const started = Date.now()
  const { object, usage, providerMetadata } = await generateObject({
    model: gateway(model),
    schema: JudgeSchema,
    system: JUDGE_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: buildTaskBlock(c),
            // Same task block for every action of a trajectory: cache it where
            // the provider supports it (Anthropic; ignored elsewhere).
            providerOptions: {
              anthropic: { cacheControl: { type: 'ephemeral' } },
            },
          },
          { type: 'text', text: buildActionBlock(c) },
        ],
      },
    ],
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    temperature: 0,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    experimental_repairText: async ({ text }) => {
      const fixed = repairJudgeText(text)
      if (fixed !== null) repaired = true
      return fixed
    },
  })
  return {
    model,
    candidateId: c.id,
    suspicion: Math.max(0, Math.min(1, object.suspicion)),
    category: object.category,
    reason: object.reason,
    error: null,
    repaired,
    latencyMs: Date.now() - started,
    inputTokens: usage.inputTokens ?? 0,
    cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    costUsd: gatewayCost(providerMetadata),
  }
}

async function judge(model: string, c: Candidate): Promise<JudgeResult> {
  let lastError = 'unknown'
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await judgeOnce(model, c)
    } catch (err) {
      lastError = (err as Error).message.slice(0, 300)
    }
  }
  return {
    model,
    candidateId: c.id,
    suspicion: null,
    category: null,
    reason: '',
    error: lastError,
    repaired: false,
    latencyMs: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    costUsd: null,
  }
}

export async function readResults(path: string): Promise<JudgeResult[]> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return []
  }
  return raw
    .split('\n')
    .filter(l => l.trim() !== '')
    .map(l => JSON.parse(l) as JudgeResult)
}

async function main(): Promise<void> {
  const out = flag('--out') ?? DEFAULT_OUT
  const models = flag('--models')?.split(',') ?? [...DEFAULT_MODELS]
  const datasets = flag('--datasets')?.split(',')
  const budget = Number(flag('--budget') ?? 30)
  const limit = Number(flag('--limit') ?? Infinity)
  const concurrency = Number(flag('--concurrency') ?? 8)
  const dryRun = process.argv.includes('--dry-run')

  const corpus = await loadCorpus(flag('--cache-dir') ?? DEFAULT_CACHE_DIR)
  const pool = corpus.candidates.filter(
    c => !datasets || datasets.includes(c.dataset)
  )
  const trajectories = groupByTrajectory(pool).slice(0, limit)
  const chars = trajectories
    .flat()
    .reduce(
      (n, c) => n + buildTaskBlock(c).length + buildActionBlock(c).length,
      0
    )
  process.stdout.write(
    `${trajectories.length} trajectories · ${trajectories.flat().length} candidate actions · ~${Math.round(chars / 4 / 1000)}k input tokens per model\n`
  )
  if (dryRun) return

  await mkdir(dirname(out), { recursive: true })
  const existing = await readResults(out)
  let spent = existing.reduce((s, r) => s + (r.costUsd ?? 0), 0)
  const done = new Set(
    existing
      .filter(r => r.error === null)
      .map(r => `${r.model}|${r.candidateId}`)
  )
  process.stdout.write(`already spent $${spent.toFixed(2)} of $${budget}\n`)

  for (const model of models) {
    const todo = trajectories
      .map(g => g.filter(c => !done.has(`${model}|${c.id}`)))
      .filter(g => g.length > 0)
    process.stdout.write(`${model}: ${todo.flat().length} to judge\n`)
    let next = 0
    let n = 0
    let stopped: string | null = null
    const worker = async (): Promise<void> => {
      while (next < todo.length && !stopped) {
        const group = todo[next++]!
        for (const c of group) {
          if (stopped) return
          if (spent >= budget) {
            stopped = `budget $${budget} reached`
            return
          }
          const r = await judge(model, c)
          if (r.error !== null && isFatalError(r.error)) {
            // Not recorded: a resumed run should judge this action again.
            stopped = `fatal gateway error: ${r.error}`
            return
          }
          spent += r.costUsd ?? 0
          await appendFile(out, `${JSON.stringify(r)}\n`)
          n++
          if (n % 50 === 0) {
            process.stdout.write(
              `  ${model} ${n}/${todo.flat().length} · total $${spent.toFixed(2)}\n`
            )
          }
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker))
    process.stdout.write(`  ${model} done · total $${spent.toFixed(2)}\n`)
    if (stopped) {
      process.stdout.write(`${stopped} — stopping\n`)
      return
    }
  }
}

if (process.argv[1]?.endsWith('lum958-basharena-llm/evaluate.ts')) {
  main().catch(err => {
    process.stderr.write(`lum958 evaluate: ${(err as Error).message}\n`)
    process.exit(1)
  })
}

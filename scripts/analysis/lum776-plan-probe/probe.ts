/**
 * LUM-776 — A/B probe for the L3 planning step, on REAL prompts.
 *
 * Every variant is run once over every prompt of the corpus `build-corpus.ts`
 * produced (≥16 distinct (PR, head sha) pairs — the same prompt repeated is
 * one sample, LUM-766). Shipped-schema variants go THROUGH the shipped
 * `planHuntTasks` so the thing measured is the thing deployed; the old-schema
 * control rebuilds the pre-LUM-776 schema around the same prompt.
 *
 * Writes `results.json` next to this file: per-call finish reason, token
 * spend, latency, task count, objective/reason lengths and — on failure — the
 * stable shape `describePlanFailure` assigns. Prompt TEXT is not written (it
 * carries acceptance criteria and team memory); only its length and hash.
 *
 * Run (needs AI_GATEWAY_API_KEY; the corpus file is local):
 *   DOTENV_CONFIG_PATH=/abs/.env.local npx tsx -r dotenv/config \
 *     scripts/analysis/lum776-plan-probe/probe.ts --corpus /abs/corpus.json \
 *     [--variants flash-reasoning,haiku-4.5] [--concurrency 4] [--out results.json]
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { generateObject } from 'ai'
import { gateway } from '../../../lib/ai/gateway'
import { z } from 'zod'
import {
  planHuntTasks,
  buildPlanPrompt,
  PLAN_SYSTEM_PROMPT,
  type PlanClientInput,
} from '@/ee/security/llm/security-hunt-plan-client'
import {
  HUNT_CATEGORIES,
  HUNT_MAX_PLANNED_TASKS,
  PLAN_HUNT_MAX_ATTEMPTS,
  PLAN_HUNT_TIMEOUT_MS,
  PLAN_HUNT_TOKEN_BUDGET,
  PLAN_OBJECTIVE_MAX_CHARS,
} from '@/ee/security/services/security-hunt.config'
import {
  describePlanFailure,
  isTransientPlanError,
} from '@/ee/security/security-scan/hunt/plan-retry'
import { VARIANTS, type ProbeVariant } from './variants'
import type { CorpusEntry } from './build-corpus'

export interface ProbeCall {
  variant: string
  promptId: string
  ok: boolean
  latencyMs: number
  finishReason?: string
  outputTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  tasks?: number
  objectiveChars?: number[]
  reasonChars?: number
  /** Set when the plan only validated through `repairPlanText` (shipped-schema variants). */
  repaired?: string
  /**
   * Attempts this call took, mirroring `planHunt`'s retry: a transient
   * failure (timeout / transport / `length` / empty output) gets one fresh
   * window, exactly as production gives it. `attemptFailures` lists the
   * failures of the attempts that were retried; `failure` is the final one.
   */
  attempts: number
  attemptFailures?: Array<{ shape: string; finishReason?: string }>
  failure?: {
    shape: string
    message: string
    finishReason?: string
    textPrefix?: string
  }
}

export interface ProbeResults {
  generatedAt: string
  corpus: Array<{
    id: string
    pr: number
    headSha: string
    plannedByInProd: string
    promptChars: number
    promptSha256: string
  }>
  variants: Record<
    string,
    {
      config: ProbeVariant
      /** 1 = single-shot (the candidate rows); PLAN_HUNT_MAX_ATTEMPTS = as shipped. */
      attemptsAllowed: number
      calls: ProbeCall[]
    }
  >
}

/** The schema as it was before LUM-776 — the control. */
const OLD_SCHEMA = z.object({
  tasks: z
    .array(
      z.object({
        objective: z.string().min(20).max(PLAN_OBJECTIVE_MAX_CHARS),
        category: z.enum(HUNT_CATEGORIES),
        startingPoints: z.array(z.string()).max(5),
      })
    )
    .max(HUNT_MAX_PLANNED_TASKS),
  reason: z.string().max(400),
})

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}

/**
 * One call with the shipped retry semantics on top: `planHunt` gives a
 * transient failure one more fresh window, so a probe that stops at the first
 * `length` measures a stricter thing than production runs.
 */
async function runOne(
  variant: ProbeVariant,
  entry: CorpusEntry,
  attemptsAllowed: number
): Promise<ProbeCall> {
  const attemptFailures: NonNullable<ProbeCall['attemptFailures']> = []
  for (let attempt = 1; ; attempt++) {
    const { call, error } = await runAttempt(variant, entry)
    const done: ProbeCall = {
      ...call,
      attempts: attempt,
      ...(attemptFailures.length > 0 ? { attemptFailures } : {}),
    }
    if (call.ok || attempt >= attemptsAllowed || !isTransientPlanError(error))
      return done
    attemptFailures.push({
      shape: call.failure!.shape,
      ...(call.failure!.finishReason
        ? { finishReason: call.failure!.finishReason }
        : {}),
    })
  }
}

async function runAttempt(
  variant: ProbeVariant,
  entry: CorpusEntry
): Promise<{ call: Omit<ProbeCall, 'attempts'>; error?: unknown }> {
  const input: PlanClientInput = {
    ...entry.input,
    timeoutMs: PLAN_HUNT_TIMEOUT_MS,
  }
  const started = Date.now()
  try {
    if (variant.schema === 'old') {
      const { object, usage, finishReason } = await generateObject({
        model: gateway(variant.model),
        schema: OLD_SCHEMA,
        system: PLAN_SYSTEM_PROMPT,
        prompt: buildPlanPrompt(input),
        maxOutputTokens: PLAN_HUNT_TOKEN_BUDGET,
        ...(variant.providerOptions
          ? { providerOptions: variant.providerOptions }
          : {}),
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(input.timeoutMs),
      })
      return {
        call: {
          variant: variant.name,
          promptId: entry.id,
          ok: true,
          latencyMs: Date.now() - started,
          finishReason: finishReason ?? 'unknown',
          outputTokens: usage.outputTokens ?? 0,
          reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
          totalTokens: usage.totalTokens ?? 0,
          tasks: object.tasks.length,
          objectiveChars: object.tasks.map(t => t.objective.length),
          reasonChars: object.reason.length,
        },
      }
    }
    const out = await planHuntTasks(input, {
      model: gateway(variant.model),
      ...(variant.providerOptions
        ? { providerOptions: variant.providerOptions }
        : {}),
    })
    return {
      call: {
        variant: variant.name,
        promptId: entry.id,
        ok: true,
        latencyMs: Date.now() - started,
        finishReason: out.finishReason,
        outputTokens: out.outputTokens,
        reasoningTokens: out.reasoningTokens,
        totalTokens: out.tokens,
        tasks: out.tasks.length,
        objectiveChars: out.tasks.map(t => t.objective.length),
        reasonChars: out.reason.length,
        ...(out.repaired ? { repaired: out.repaired } : {}),
      },
    }
  } catch (error) {
    const f = describePlanFailure(error)
    return {
      error,
      call: {
        variant: variant.name,
        promptId: entry.id,
        ok: false,
        latencyMs: Date.now() - started,
        ...(f.finishReason ? { finishReason: f.finishReason } : {}),
        ...(f.outputTokens !== undefined
          ? { outputTokens: f.outputTokens }
          : {}),
        ...(f.reasoningTokens !== undefined
          ? { reasoningTokens: f.reasoningTokens }
          : {}),
        failure: {
          shape: f.shape,
          message: f.message.slice(0, 200),
          ...(f.finishReason ? { finishReason: f.finishReason } : {}),
          ...(f.textPrefix !== undefined ? { textPrefix: f.textPrefix } : {}),
        },
      },
    }
  }
}

async function pool<T>(
  jobs: Array<() => Promise<T>>,
  width: number
): Promise<T[]> {
  const results: T[] = new Array(jobs.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(width, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++
        results[i] = await jobs[i]!()
      }
    })
  )
  return results
}

function pct(xs: number[], p: number): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!
}

export function summarize(calls: ProbeCall[]): string {
  const ok = calls.filter(c => c.ok)
  const shapes: Record<string, number> = {}
  for (const c of calls)
    if (c.failure) shapes[c.failure.shape] = (shapes[c.failure.shape] ?? 0) + 1
  const empty = ok.filter(c => c.tasks === 0).length
  const repaired = ok.filter(c => c.repaired).length
  const retried = calls.filter(c => c.attempts > 1).length
  const reasoning = ok.map(c => c.reasoningTokens ?? 0)
  const lat = ok.map(c => c.latencyMs)
  return (
    `ok ${ok.length}/${calls.length} · empty plans ${empty}/${ok.length} · repaired ${repaired} · retried ${retried} · ` +
    `latency p50 ${pct(lat, 50)} p90 ${pct(lat, 90)} max ${pct(lat, 100)} ms · ` +
    `reasoning p50 ${pct(reasoning, 50)} max ${pct(reasoning, 100)} · ` +
    `failures ${JSON.stringify(shapes)}`
  )
}

async function main(): Promise<void> {
  const corpusPath = arg('--corpus')
  if (!corpusPath) throw new Error('--corpus <file> is required')
  const out = arg('--out', path.join(__dirname, 'results.json'))!
  const width = Number(arg('--concurrency', '4'))
  // As shipped: `planHunt` retries a transient failure once. `--single-shot`
  // measures one attempt per prompt instead (the candidate rows were run so).
  const attemptsAllowed = process.argv.includes('--single-shot')
    ? 1
    : PLAN_HUNT_MAX_ATTEMPTS
  const names = arg('--variants')?.split(',')
  const variants = names
    ? VARIANTS.filter(v => names.includes(v.name))
    : [...VARIANTS]
  const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as CorpusEntry[]

  let results: ProbeResults
  try {
    results = JSON.parse(readFileSync(out, 'utf8')) as ProbeResults
  } catch {
    results = { generatedAt: '', corpus: [], variants: {} }
  }
  results.generatedAt = new Date().toISOString()
  results.corpus = corpus.map(e => {
    const prompt = buildPlanPrompt({ ...e.input, timeoutMs: 0 })
    return {
      id: e.id,
      pr: e.pr,
      headSha: e.headSha,
      plannedByInProd: e.plannedByInProd,
      promptChars: prompt.length,
      promptSha256: createHash('sha256').update(prompt).digest('hex'),
    }
  })

  for (const variant of variants) {
    console.log(`\n=== ${variant.name} — ${variant.why}`)
    const calls = await pool(
      corpus.map(e => async () => {
        const c = await runOne(variant, e, attemptsAllowed)
        console.log(
          `  ${e.id} ${c.ok ? 'ok ' : 'ERR'} ${String(c.latencyMs).padStart(6)}ms finish=${c.finishReason ?? '-'} reasoning=${c.reasoningTokens ?? '-'} out=${c.outputTokens ?? '-'} tasks=${c.tasks ?? '-'}` +
            (c.attempts > 1 ? ` attempts=${c.attempts}` : '') +
            (c.repaired ? ` repaired=${c.repaired}` : '') +
            (c.failure ? ` [${c.failure.shape}] ${c.failure.message}` : '')
        )
        return c
      }),
      width
    )
    results.variants[variant.name] = { config: variant, attemptsAllowed, calls }
    console.log(`  → ${summarize(calls)}`)
    writeFileSync(out, JSON.stringify(results, null, 2))
  }
  console.log(`\nwrote ${out}`)
  console.log('\n=== summary')
  for (const [name, v] of Object.entries(results.variants))
    console.log(`${name.padEnd(28)} ${summarize(v.calls)}`)
}

if (require.main === module) {
  main().catch(err => {
    console.error('[lum776] fatal:', err)
    process.exit(1)
  })
}

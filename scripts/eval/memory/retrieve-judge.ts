/**
 * LUM-414 LLM-judge Probe1 (arXiv 2603.02473) — LIVE, key-gated, NOT in CI.
 *
 * Independently re-judges the relevance of every fragment the score-ordered
 * top-k would inject (no floor — judging the ceiling set covers both relevant
 * and irrelevant injections, including the abstention controls' all-irrelevant
 * sets). Reports judged Precision@k per run plus k-run consistency (τ-bench
 * pass^k discipline: a non-deterministic eval reports cross-run agreement,
 * never a single pass) and judge-vs-gold agreement as an annotation audit.
 *
 * The gateway import is dynamic and happens AFTER the key check, so this
 * module is safe to load in jest (no @ai-sdk/gateway TransformStream trap)
 * and skips cleanly without AI_GATEWAY_API_KEY.
 *
 * Usage: npx tsx scripts/eval/memory/retrieve-judge.ts
 */
import { memoryContentToText } from '@/lib/memory/content-text'
import { scoreJudgeRuns, type JudgeVote } from './retrieve-metrics'
import {
  retrievePool,
  retrieveQuerySet,
  retrieveQueryText,
  type RetrieveQuery,
} from './retrieve-set'

export const RETRIEVE_JUDGE_RUNS = 3
export const RETRIEVE_JUDGE_MODEL = 'deepseek/deepseek-v4-flash'

export interface JudgePair {
  query: RetrieveQuery
  /** Injected fragment ids, score order (the relevance-ceiling top-k set). */
  fragmentIds: string[]
}

/** Pure: the (query → injected fragments) pairs the judge audits. Built from
 * the deterministic report path so the judged set is exactly what the
 * score-ordered ceiling would inject. */
export async function judgedPairs(k: number): Promise<JudgePair[]> {
  // Dynamic so loading this module never drags the 8.5MB pool fixture into a
  // jest bundle that only wants the gating behavior.
  const { outcomesFor } = await import('./retrieve-report')
  const byId = new Map(retrieveQuerySet.map(q => [q.id, q]))
  return outcomesFor({ ordering: 'score', floor: null }, k).map(o => ({
    query: byId.get(o.queryId)!,
    fragmentIds: o.injected,
  }))
}

const poolById = new Map(retrievePool.map(c => [c.id, c]))

export function fragmentText(fragmentId: string): string {
  const c = poolById.get(fragmentId)!
  return memoryContentToText(c.category, c.existing)
}

/** LIVE: one judge pass over every pair. Throws if the key is absent. */
export async function runJudgeOnce(
  pairs: JudgePair[],
  runIndex: number
): Promise<JudgeVote[]> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error(
      'retrieve-judge: AI_GATEWAY_API_KEY missing — this live eval needs the gateway key (.env.local).'
    )
  }
  const { generateObject } = await import('ai')
  const { gateway } = await import('@/lib/ai/gateway')
  const { z } = await import('zod')
  const votes: JudgeVote[] = []
  for (const { query, fragmentIds } of pairs) {
    const fragments = fragmentIds
      .map((id, i) => `[${i + 1}] (id=${id})\n${fragmentText(id)}`)
      .join('\n\n')
    const callJudge = async (): Promise<{
      judgments: Array<{ id: string; relevant: boolean }>
    }> => {
      const { object } = await generateObject({
        model: gateway(RETRIEVE_JUDGE_MODEL),
        schema: z.object({
          judgments: z.array(
            z.object({ id: z.string(), relevant: z.boolean() })
          ),
        }),
        prompt: [
          'You audit a memory-injection system for a dev-team project tool.',
          'Given the task a developer is starting, judge EACH memory fragment:',
          'is it relevant background that should be injected for THIS task?',
          'Judge topical relevance to the task — an outdated or superseded',
          'belief about the same topic still counts as relevant (lifecycle is',
          'handled elsewhere). Unrelated facts, however plausible, are not.',
          `Return one judgment per fragment id (${fragmentIds.length} total).`,
          '',
          `TASK:\n${retrieveQueryText(query)}`,
          '',
          `FRAGMENTS:\n${fragments}`,
        ].join('\n'),
      })
      return object
    }
    // Transient gateway 5xx happen on long batches; retry once, then skip the
    // query for THIS run. Skipped pairs drop out of the unanimity denominator
    // (scoreJudgeRuns only counts pairs every run judged), never fake a vote.
    let object: Awaited<ReturnType<typeof callJudge>>
    try {
      object = await callJudge()
    } catch {
      try {
        object = await callJudge()
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          `  run ${runIndex + 1}: SKIPPED ${query.id} after retry — ${err instanceof Error ? err.message : String(err)}`
        )
        continue
      }
    }
    for (const j of object.judgments) {
      if (fragmentIds.includes(j.id)) {
        votes.push({
          queryId: query.id,
          fragmentId: j.id,
          relevant: j.relevant,
        })
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `  run ${runIndex + 1}: judged ${query.id} (${object.judgments.length} votes)`
    )
  }
  return votes
}

export async function runRetrieveJudge(k = 5): Promise<void> {
  const pairs = await judgedPairs(k)
  const gold = new Map(
    retrieveQuerySet.map(q => [q.id, new Set(q.relevantIds)])
  )
  const runs: JudgeVote[][] = []
  for (let r = 0; r < RETRIEVE_JUDGE_RUNS; r++) {
    runs.push(await runJudgeOnce(pairs, r))
  }
  const c = scoreJudgeRuns(runs, gold)
  // eslint-disable-next-line no-console
  const log = console.log
  log('\n=== LUM-414 Retrieve Judge (Probe1, live) ===')
  log(
    `  model=${RETRIEVE_JUDGE_MODEL}  runs=${RETRIEVE_JUDGE_RUNS}  pairs/run=${pairs.reduce((n, p) => n + p.fragmentIds.length, 0)}`
  )
  c.runs.forEach((r, i) =>
    log(
      `  run ${i + 1}: judged-precision=${r.judgedPrecision.toFixed(3)}  gold-agreement=${r.goldAgreement.toFixed(3)}`
    )
  )
  log(
    `  consistency: mean=${c.meanJudgedPrecision.toFixed(3)}  min=${c.minJudgedPrecision.toFixed(3)}  unanimous=${(c.unanimousRate * 100).toFixed(1)}%`
  )

  // Annotation audit: pairs where the LAST run disagrees with gold.
  const last = runs[runs.length - 1] ?? []
  const disagreements = last.filter(
    v => v.relevant !== (gold.get(v.queryId)?.has(v.fragmentId) ?? false)
  )
  log(`\n  judge-vs-gold disagreements (last run, ${disagreements.length}):`)
  for (const d of disagreements) {
    log(
      `    ${d.queryId} × ${d.fragmentId}: judge=${d.relevant ? 'relevant' : 'irrelevant'} gold=${d.relevant ? 'irrelevant' : 'relevant'}`
    )
  }
}

if (require.main === module) {
  void import('dotenv').then(({ config }) => {
    config({ path: '.env.local' })
    if (!process.env.AI_GATEWAY_API_KEY) {
      // eslint-disable-next-line no-console
      console.error(
        'retrieve-judge: AI_GATEWAY_API_KEY missing — this live eval needs the gateway key (.env.local).'
      )
      process.exit(1)
    }
    runRetrieveJudge().catch(err => {
      // eslint-disable-next-line no-console
      console.error(err)
      process.exit(1)
    })
  })
}

/**
 * LUM-945 evaluate — runs the context-triage judge over the exported corpus
 * with each candidate model through the Vercel AI Gateway (`@/lib/ai/gateway`
 * forces zero data retention on every request). Read-only with respect to
 * Lumo data: it reads a local corpus file and writes a local results file.
 *
 *   DOTENV_CONFIG_PATH=<main checkout>/.env.local npx tsx -r dotenv/config \
 *     scripts/analysis/lum945-crossing-triage/evaluate.ts \
 *     --corpus /tmp/lum945/corpus.json --out /tmp/lum945/results.json \
 *     [--models a,b] [--limit N] [--concurrency 6]
 *
 * Resumable: rows already in --out that succeeded are kept and skipped.
 * A failed call (after one retry) is recorded as UNSURE with its error — it
 * never counts as LEGIT.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { generateEvalObject } from '@/ee/private/llm/offline-eval-client'
import type { CorpusItem } from './corpus'
import {
  TRIAGE_SYSTEM_PROMPT,
  TriageSchema,
  buildTriagePrompt,
  repairTriageText,
} from './prompt'
import type { JudgeResult } from './report'
import { JEV_BOOLEAN_MODEL, JEV_MODEL, isJevEligible, judgeJev } from './jev'

export const CANDIDATE_MODELS = [
  'alibaba/qwen3.7-flash',
  'deepseek/deepseek-v4-flash',
  'moonshotai/kimi-k2-thinking',
  'anthropic/claude-haiku-4.5',
  JEV_MODEL,
  JEV_BOOLEAN_MODEL,
] as const

const TIMEOUT_MS = 90_000
const MAX_OUTPUT_TOKENS = 4_000

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function judgeOnce(
  model: string,
  item: CorpusItem
): Promise<JudgeResult> {
  let repaired = false
  const started = Date.now()
  const { object, usage } = await generateEvalObject({
    model,
    schema: TriageSchema,
    system: TRIAGE_SYSTEM_PROMPT,
    prompt: buildTriagePrompt(item),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    timeoutMs: TIMEOUT_MS,
    repairText: text => {
      const fixed = repairTriageText(text)
      if (fixed !== null) repaired = true
      return fixed
    },
  })
  return {
    model,
    itemId: item.id,
    verdict: object.verdict,
    confidence: Math.max(0, Math.min(1, object.confidence)),
    basis: object.basis,
    error: null,
    repaired,
    latencyMs: Date.now() - started,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
  }
}

async function judge(model: string, item: CorpusItem): Promise<JudgeResult> {
  let lastError = 'unknown'
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await judgeOnce(model, item)
    } catch (err) {
      lastError = (err as Error).message.slice(0, 300)
    }
  }
  return {
    model,
    itemId: item.id,
    verdict: 'UNSURE',
    confidence: 0,
    basis: '',
    error: lastError,
    repaired: false,
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
  }
}

async function pool<T>(
  tasks: (() => Promise<T>)[],
  size: number
): Promise<T[]> {
  const out: T[] = []
  let next = 0
  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const i = next++
      out[i] = await tasks[i]!()
    }
  }
  await Promise.all(Array.from({ length: size }, worker))
  return out
}

async function readExisting(path: string): Promise<JudgeResult[]> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as JudgeResult[]
  } catch {
    return []
  }
}

async function main(): Promise<void> {
  const corpusPath = flag('--corpus')
  const outPath = flag('--out')
  if (!corpusPath || !outPath) {
    throw new Error('--corpus <path> and --out <path> are required')
  }
  const models = flag('--models')?.split(',') ?? [...CANDIDATE_MODELS]
  const limit = Number(flag('--limit') ?? Infinity)
  const concurrency = Number(flag('--concurrency') ?? 6)

  const corpus = (
    JSON.parse(await readFile(corpusPath, 'utf8')) as CorpusItem[]
  ).slice(0, limit)
  const kept = (await readExisting(outPath)).filter(r => r.error === null)
  const done = new Set(kept.map(r => `${r.model}|${r.itemId}`))
  const results: JudgeResult[] = [...kept]

  for (const model of models) {
    const todo = corpus.filter(
      i =>
        !done.has(`${model}|${i.id}`) &&
        // Jev has no ZDR endpoint: only Lumo's own workspace data goes there.
        ((model !== JEV_MODEL && model !== JEV_BOOLEAN_MODEL) ||
          isJevEligible(i))
    )
    process.stdout.write(`${model}: ${todo.length} to judge\n`)
    let n = 0
    const fresh = await pool(
      todo.map(item => async () => {
        const r =
          model === JEV_MODEL
            ? await judgeJev(item, 'choice')
            : model === JEV_BOOLEAN_MODEL
              ? await judgeJev(item, 'boolean')
              : await judge(model, item)
        n++
        if (n % 25 === 0)
          process.stdout.write(`  ${model} ${n}/${todo.length}\n`)
        return r
      }),
      concurrency
    )
    results.push(...fresh)
    await writeFile(outPath, JSON.stringify(results, null, 2))
    const failed = fresh.filter(r => r.error !== null)
    process.stdout.write(
      `  done · ${failed.length} failed${failed[0] ? ` (e.g. ${failed[0].error})` : ''}\n`
    )
  }
}

if (process.argv[1]?.endsWith('evaluate.ts')) {
  main().catch(err => {
    process.stderr.write(`lum945 evaluate: ${(err as Error).message}\n`)
    process.exit(1)
  })
}

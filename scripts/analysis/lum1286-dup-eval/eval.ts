/**
 * LUM-1286 eval — replay the CLI duplicate gate on public GitHub duplicates.
 *
 *   npx tsx --env-file=<.env.local> scripts/analysis/lum1286-dup-eval/eval.ts \
 *     <data_dir> <prefilter|gate> [--pos N] [--neg N] [--concurrency N] [--seed S]
 *     [--recall bigram|embedding]
 *
 * <data_dir> holds issues.json / dups.json / dup_labelled.json from fetch.py.
 * Each case is replayed as a project: the 200 issues created just before the
 * new issue (the canonical swapped in for positives) stand in for
 * findForDuplicateCheck. `prefilter` only ranks titles by bigram similarity
 * (no LLM); `gate` runs the shipped checkDuplicates with the CLI's
 * candidateLimit, timeout and block score. `--recall bigram` (default) stubs the
 * embedding lookup out, reproducing the step-1 pipeline; `--recall embedding`
 * serves it from <data_dir>/emb.f32 (written by embed.ts) over every issue
 * created before the case, as the step-2 pipeline does over a whole project.
 * Results append to <data_dir>/<mode>[-embedding].jsonl, so a run resumes.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { EMBEDDING_DIM } from '@/lib/ai/embedding'
import { taskRepository } from '@/lib/repositories'
import { bigramSimilarity } from '@/lib/similarity'
import {
  DUPLICATE_SUGGEST_SCORE,
  CLI_DUPLICATE_CANDIDATES,
  CLI_DUPLICATE_TIMEOUT_MS,
  checkDuplicates,
} from '@/lib/services/duplicate-check.service'

interface Issue {
  number: number
  title: string
  createdAt: string
}
interface Dup extends Issue {
  canonical: Issue
  meta: boolean
}
interface Case {
  id: string
  kind: 'pos' | 'neg'
  meta: boolean
  title: string
  expected: number | null
  pool: Issue[]
  /** pos only: was the canonical among the 200 issues created just before? */
  canonicalInWindow: boolean | null
  /** Every issue created before this one (+ the canonical): embedding recall pool. */
  history: Issue[]
}

const POOL = 200
const [dir, mode, ...rest] = process.argv.slice(2)
if (!dir || (mode !== 'prefilter' && mode !== 'gate')) {
  throw new Error('usage: eval.ts <data_dir> <prefilter|gate> [--pos N] [--neg N] [--concurrency N] [--seed S]')
}
const flag = (name: string, dflt: number) => {
  const i = rest.indexOf(`--${name}`)
  return i >= 0 ? Number(rest[i + 1]) : dflt
}

const issues: Issue[] = JSON.parse(readFileSync(`${dir}/issues.json`, 'utf8'))
const dups: Dup[] = JSON.parse(readFileSync(`${dir}/dups.json`, 'utf8'))
const labelled = new Set<number>(
  JSON.parse(readFileSync(`${dir}/dup_labelled.json`, 'utf8'))
)
const indexOf = new Map(issues.map((x, i) => [x.number, i]))

// Deterministic shuffle so --pos/--neg samples are reproducible.
let seed = flag('seed', 1286)
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
const shuffle = <T>(xs: T[]) => {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

function before(i: number): Issue[] {
  return issues.slice(Math.max(0, i - POOL), i)
}

const cases: Case[] = []
for (const d of dups) {
  const i = indexOf.get(d.number)
  if (i === undefined || i < POOL) continue // need a full window before it
  const window = before(i)
  const inWindow = window.some(x => x.number === d.canonical.number)
  // Swap the canonical in (it is often older than the window): this measures
  // "if the canonical is among the 200 candidates, does the gate catch it".
  const pool = inWindow
    ? window
    : [...window.slice(1), d.canonical]
  cases.push({
    id: `pos-${d.number}`,
    kind: 'pos',
    meta: d.meta,
    title: d.title,
    expected: d.canonical.number,
    pool,
    canonicalInWindow: inWindow,
    history: issues.slice(0, i).some(x => x.number === d.canonical.number)
      ? issues.slice(0, i)
      : [...issues.slice(0, i), d.canonical],
  })
}
const dupNumbers = new Set(dups.map(d => d.number))
const negatives = issues
  .map((x, i) => ({ x, i }))
  .filter(({ x, i }) => i >= POOL && !labelled.has(x.number) && !dupNumbers.has(x.number))
for (const { x, i } of negatives) {
  cases.push({
    id: `neg-${x.number}`,
    kind: 'neg',
    meta: false,
    title: x.title,
    expected: null,
    pool: before(i),
    canonicalInWindow: null,
    history: issues.slice(0, i),
  })
}

const pos = shuffle(cases.filter(c => c.kind === 'pos' && !c.meta)).slice(0, flag('pos', 1e9))
const posMeta = shuffle(cases.filter(c => c.kind === 'pos' && c.meta)).slice(0, flag('pos', 1e9))
const neg = shuffle(cases.filter(c => c.kind === 'neg')).slice(0, flag('neg', 1e9))
const selected = mode === 'prefilter' ? [...pos, ...posMeta] : [...pos, ...posMeta, ...neg]

const recallIdx = rest.indexOf('--recall')
const recall = recallIdx >= 0 ? rest[recallIdx + 1] : 'bigram'
if (recall !== 'bigram' && recall !== 'embedding') throw new Error('--recall bigram|embedding')
const out = `${dir}/${mode}${recall === 'embedding' ? '-embedding' : ''}.jsonl`
const done = new Set<string>(
  existsSync(out)
    ? readFileSync(out, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(l => (JSON.parse(l) as { id: string }).id)
    : []
)

function prefilterRank(c: Case): number {
  const ranked = c.pool
    .map(x => ({ n: x.number, s: bigramSimilarity(c.title, x.title) }))
    .sort((a, b) => b.s - a.s)
  return ranked.findIndex(r => r.n === c.expected) + 1 // 0 = absent
}

// The repository the shipped code reads, swapped for the case's pool.
// Keyed by case id (passed as the projectId) so concurrent cases never read
// each other's pool across an await.
const pools = new Map<string, Issue[]>()
const histories = new Map<string, Issue[]>()

// Embedding recall served from embed.ts output (unit vectors by issue number).
const vectors = new Map<number, Float32Array>()
if (recall === 'embedding') {
  const ids: number[] = JSON.parse(readFileSync(`${dir}/emb_ids.json`, 'utf8'))
  const raw = readFileSync(`${dir}/emb.f32`)
  const all = new Float32Array(raw.buffer, raw.byteOffset, ids.length * EMBEDDING_DIM)
  ids.forEach((n, i) => {
    const v = all.slice(i * EMBEDDING_DIM, (i + 1) * EMBEDDING_DIM)
    const norm = Math.hypot(...v)
    vectors.set(n, v.map(x => x / norm))
  })
}
const repo = taskRepository as unknown as Record<string, unknown>
repo.findNearestByTitleEmbedding = async (p: string, q: number[], k: number) => {
  if (recall !== 'embedding') return []
  const qn = Math.hypot(...q)
  return (histories.get(p) ?? [])
    .map(x => {
      const v = vectors.get(x.number)
      let dot = 0
      if (v) for (let i = 0; i < v.length; i++) dot += v[i]! * q[i]!
      return { id: String(x.number), s: v ? dot / qn : -1 }
    })
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map(x => x.id)
}
repo.findForDuplicateCheckByIds = async (p: string, ids: string[]) => {
  const byId = new Map((histories.get(p) ?? []).map(x => [String(x.number), x]))
  return ids.flatMap(id => {
    const x = byId.get(id)
    return x ? [toRow(x)] : []
  })
}
const toRow = (x: Issue) => ({
  id: String(x.number),
  title: x.title,
  number: x.number,
  status: 'TODO',
  priority: 'NONE',
  team: { identifier: 'VSC' },
  assignee: null,
})
repo.findForDuplicateCheck = async (p: string) => (pools.get(p) ?? []).map(toRow)

async function runGate(c: Case) {
  pools.set(c.id, c.pool)
  histories.set(c.id, c.history)
  const t0 = Date.now()
  // Same bounds as findLikelyDuplicates, but keep every score for analysis.
  const signal = AbortSignal.timeout(CLI_DUPLICATE_TIMEOUT_MS)
  const timedOut = new Promise<never>((_, reject) =>
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  )
  try {
    const matches = await Promise.race([
      checkDuplicates(c.title, c.id, {
        abortSignal: signal,
        candidateLimit: CLI_DUPLICATE_CANDIDATES,
      }),
      timedOut,
    ])
    pools.delete(c.id)
    histories.delete(c.id)
    const blocking = matches.filter(m => m.score >= DUPLICATE_SUGGEST_SCORE)
    return {
      ms: Date.now() - t0,
      error: null,
      matches: matches.map(m => ({ n: m.number, s: m.score })),
      blocked: blocking.length > 0,
      caughtExpected:
        c.expected !== null && blocking.some(m => m.number === c.expected),
    }
  } catch (e) {
    return {
      ms: Date.now() - t0,
      error: (e as Error).name || String(e),
      matches: [],
      blocked: false,
      caughtExpected: false,
    }
  }
}

async function main() {
  const todo = selected.filter(c => !done.has(c.id))
  process.stderr.write(
    `${mode}: pos=${pos.length} posMeta=${posMeta.length} neg=${mode === 'gate' ? neg.length : 0} todo=${todo.length}\n`
  )
  let next = 0
  let finished = 0
  const worker = async () => {
    while (next < todo.length) {
      const c = todo[next++]!
      const base = {
        id: c.id,
        kind: c.kind,
        meta: c.meta,
        title: c.title,
        expected: c.expected,
        canonicalInWindow: c.canonicalInWindow,
        prefilterRank: c.expected === null ? null : prefilterRank(c),
      }
      const row = mode === 'gate' ? { ...base, ...(await runGate(c)) } : base
      appendFileSync(out, JSON.stringify(row) + '\n')
      if (++finished % 10 === 0) process.stderr.write(`  ${finished}/${todo.length}\n`)
    }
  }
  await Promise.all(
    Array.from({ length: mode === 'gate' ? flag('concurrency', 4) : 1 }, worker)
  )
}

main().then(
  () => process.exit(0),
  e => {
    process.stderr.write(String(e) + '\n')
    process.exit(1)
  }
)

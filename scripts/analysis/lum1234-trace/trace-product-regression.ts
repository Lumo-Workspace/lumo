/**
 * LUM-1234 — offline TRACE regression through the SHIPPED reward-hack
 * pipeline: per labeled TRACE row, `decideRewardHack` (judge → threshold /
 * evidence / diff gates → up to `REWARD_HACK_MAX_REFUTES` refutes, the
 * product prompts, `REWARD_HACK_THRESHOLD`, `REWARD_HACK_MODEL`) on one
 * session mapped from the conversation and a synthetic PR built from the
 * trajectory's own writes — see `trace-product-map.ts` for the mapping and
 * the PR approximation. The earlier numbers in RESULTS.md are for a simpler
 * research judge (one call, no gates, no refutes).
 *
 *   AI_PROVIDER=gateway DOTENV_CONFIG_PATH=<main checkout>/.env.local \
 *     npx tsx -r dotenv/config scripts/analysis/lum1234-trace/trace-product-regression.ts \
 *     [--dry-run] [--report] [--limit N] [--concurrency 4] [--budget 10]
 *     [--out <file>] [--data <cache>]
 *
 * `--dry-run`: no model call; the core runs with a spend gate that refuses
 * every call, which yields each row's exact judge prompt and the product
 * estimator's (deliberately high) cost, plus a worst case with every refute.
 * `--report`: rates from the results file, no call.
 *
 * A real run is resumable (a row with a non-error record is skipped; an
 * errored row is re-run and appended after the old line; the report reads
 * the last record per row) and stops before a call the `--budget` (USD,
 * counted over the WHOLE results file) cannot cover — an estimate is
 * reserved before every call, as the product does. Read-only for Lumo: no
 * DB. The label and the trajectory id never reach the model; the results
 * file (outside the repo) holds counts, ids and the model's item summaries
 * passed through `redactForStorage` — no TRACE text (CC-BY-SA, gated).
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { redactForStorage } from '@/lib/security-scan/scan-secrets'
import {
  REWARD_HACK_MAX_REFUTES,
  decideRewardHack,
  type RhJudgeFn,
  type RhRefuteFn,
} from '@/ee/security/security-scan/reward-hack-decide'
import {
  buildRhPrDiffBlock,
  type RhEvent,
  type RhPrFile,
} from '@/ee/security/security-scan/reward-hack-input'
import {
  REWARD_HACK_REFUTE_MAX_OUTPUT_TOKENS,
  REWARD_HACK_REFUTE_SYSTEM_PROMPT,
  REWARD_HACK_SYSTEM_PROMPT,
  buildRefutePrompt,
} from '@/ee/security/security-scan/reward-hack-prompts'
import { REWARD_HACK_THRESHOLD } from '@/ee/security/security-scan/reward-hack-gates'
import {
  estimateRhCallUsd,
  estimateRhTokens,
  settledRhCallUsd,
} from '@/ee/security/security-scan/reward-hack-cost'
import { auroc, wilson } from '@/ee/private/boundary-crossing/eval/stats'
import { isFatalError } from '../lum958-basharena-llm/report'
import { BudgetGate } from './calibrate-pr'
import { hackFamily, parseTraceLabel } from './convert'
import {
  TRACE_SESSION_ID,
  buildSyntheticPr,
  parseTraceConversation,
  traceRequirement,
  traceToRhEvents,
} from './trace-product-map'
import { loadTraceRows, resolveTraceFile } from './source'

export const DEFAULT_REGRESSION_OUT = join(
  homedir(),
  '.cache',
  'lumo-lum1234-trace',
  'product-regression.jsonl'
)

const red = (s: string) => redactForStorage(s).text

/** The research judge's numbers (RESULTS.md, Sonnet 4.6, threshold 0.5). */
export const RESEARCH_JUDGE = {
  detection: 0.586,
  falsePositive: 0.076,
  auroc: 0.837,
  byFamily: { '1.1': 0.775, '1.2': 0.402, '1.3': 0.318, '1.4': 0.698 },
} as const

export interface RegressionRecord {
  trajectoryId: string
  hacked: boolean
  hackTypes: string[]
  outcome: 'judged' | 'overCap' | 'error'
  promptChars: number
  truncated: boolean
  overCap: boolean
  events: number
  prFiles: number
  /** Judge suspicion 0..1; null when no judge call returned. */
  suspicion: number | null
  itemsBeforeGates: { kind: string; summary: string }[]
  gated: number
  kept: number
  keptKinds: string[]
  refutes: { kind: string; refuted: boolean }[]
  refuteCapped: boolean
  costs: { judgeUsd: number; refuteUsd: number; totalUsd: number }
  error: string | null
  at: string
}

export interface PreparedRow {
  id: string
  hacked: boolean
  hackTypes: string[]
  events: RhEvent[]
  prFileList: RhPrFile[]
  requirement: string
}

/**
 * One TRACE row → the core's inputs. The label is read for the record only;
 * the conversation alone feeds the events, PR and requirement.
 */
export function prepareTraceRow(row: Record<string, unknown>): PreparedRow {
  const label = parseTraceLabel(row.label)
  const messages = parseTraceConversation(row.conversation)
  const events = traceToRhEvents(messages)
  return {
    id: String(row.trajectory_id),
    hacked: label.hacked,
    hackTypes: label.hackTypes,
    events,
    prFileList: buildSyntheticPr(events),
    requirement: traceRequirement(messages),
  }
}

/** Run the shipped core on one prepared row. `capped` = the gate said no. */
export async function regressRow(args: {
  row: PreparedRow
  judge: RhJudgeFn
  refute: RhRefuteFn
  spend: BudgetGate
}): Promise<
  | { kind: 'record'; record: RegressionRecord }
  | {
      kind: 'capped'
      /**
       * Capped at the refutes: the judge call was paid for. Recorded as an
       * error (the row is re-run on resume) so its cost counts in the file.
       */
      record: RegressionRecord | null
    }
  | { kind: 'fatal'; error: string }
> {
  const { row } = args
  const base: RegressionRecord = {
    trajectoryId: row.id,
    hacked: row.hacked,
    hackTypes: row.hackTypes,
    outcome: 'judged',
    promptChars: 0,
    truncated: false,
    overCap: false,
    events: row.events.length,
    prFiles: row.prFileList.length,
    suspicion: null,
    itemsBeforeGates: [],
    gated: 0,
    kept: 0,
    keptKinds: [],
    refutes: [],
    refuteCapped: false,
    costs: { judgeUsd: 0, refuteUsd: 0, totalUsd: 0 },
    error: null,
    at: new Date().toISOString(),
  }
  let judgeUsd = 0
  let refuteUsd = 0
  const judge: RhJudgeFn = async p => {
    const r = await args.judge(p)
    judgeUsd = settledRhCallUsd(r, 0)
    return r
  }
  const refute: RhRefuteFn = async a => {
    const r = await args.refute(a)
    refuteUsd += settledRhCallUsd(r, 0)
    return r
  }
  let decision
  try {
    decision = await decideRewardHack({
      sessions: [{ id: TRACE_SESSION_ID, events: row.events }],
      prFileList: row.prFileList,
      requirement: row.requirement,
      judge,
      refute,
      spend: args.spend,
    })
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    // Decided on the raw message: out of credit / bad key stops the run and
    // leaves the row unrecorded, so a resumed run makes the call again.
    if (isFatalError(raw))
      return { kind: 'fatal', error: red(raw).slice(0, 300) }
    return {
      kind: 'record',
      record: {
        ...base,
        outcome: 'error',
        error: red(raw).slice(0, 300),
        costs: { judgeUsd, refuteUsd, totalUsd: judgeUsd + refuteUsd },
      },
    }
  }
  const built = decision.built
  const withPrompt = {
    ...base,
    promptChars: built.prompt.length,
    truncated: built.truncated,
    overCap: built.overCap,
  }
  if (decision.outcome === 'capped')
    return {
      kind: 'capped',
      record:
        decision.stage === 'refute'
          ? {
              ...withPrompt,
              outcome: 'error',
              error: 'budget reached before the refute calls',
              costs: { judgeUsd, refuteUsd: 0, totalUsd: judgeUsd },
            }
          : null,
    }
  if (decision.outcome === 'overCap')
    return {
      kind: 'record',
      record: { ...withPrompt, outcome: 'overCap', overCap: true },
    }
  return {
    kind: 'record',
    record: {
      ...withPrompt,
      outcome: 'judged',
      suspicion:
        Math.min(100, Math.max(0, decision.judged.output.suspicion)) / 100,
      itemsBeforeGates: decision.judged.output.items.map(i => ({
        kind: i.kind,
        summary: red(i.summary).slice(0, 400),
      })),
      gated: decision.gated.length,
      kept: decision.kept.length,
      keptKinds: decision.kept.map(i => i.kind),
      refutes: decision.refutes.map(r => ({
        kind: r.item.kind,
        refuted: r.refuted,
      })),
      refuteCapped: decision.refuteCapped,
      costs: { judgeUsd, refuteUsd, totalUsd: judgeUsd + refuteUsd },
    },
  }
}

// ─── dry run ────────────────────────────────────────────────────────────────

export interface DryRunTotals {
  rows: number
  promptChars: number
  /** Product estimator (deliberately high) over system + user prompt. */
  estTokens: number
  judgeUsd: number
  /** Judge plus every row's `REWARD_HACK_MAX_REFUTES` refutes. */
  worstUsd: number
  truncated: number
  overCap: number
  noPrFiles: number
}

/** Cost of one row's refutes if every one runs (each about the full prompt). */
export function refuteWorstUsdFor(
  prompt: string,
  prFileList: RhPrFile[]
): number {
  const prDiff = buildRhPrDiffBlock(
    prFileList,
    prFileList.map(f => f.filename)
  )
  const one = estimateRhCallUsd(
    `${REWARD_HACK_REFUTE_SYSTEM_PROMPT}\n${buildRefutePrompt({
      prompt,
      item: { kind: 'OTHER', summary: 'x'.repeat(400), eventIds: ['e0'] },
      prDiff,
    })}`,
    REWARD_HACK_REFUTE_MAX_OUTPUT_TOKENS
  )
  return one * REWARD_HACK_MAX_REFUTES
}

/** Run the core with a refusing gate over `rows`: the exact prompts, no calls. */
export async function dryRun(rows: PreparedRow[]): Promise<DryRunTotals> {
  const t: DryRunTotals = {
    rows: rows.length,
    promptChars: 0,
    estTokens: 0,
    judgeUsd: 0,
    worstUsd: 0,
    truncated: 0,
    overCap: 0,
    noPrFiles: 0,
  }
  const refuse = async () => {
    throw new Error('dry run: no model call')
  }
  for (const row of rows) {
    const gate = new BudgetGate(0, 0, false)
    const r = await decideRewardHack({
      sessions: [{ id: TRACE_SESSION_ID, events: row.events }],
      prFileList: row.prFileList,
      requirement: row.requirement,
      judge: refuse,
      refute: refuse,
      spend: gate,
    })
    const prompt = r.built.prompt
    if (row.prFileList.length === 0) t.noPrFiles++
    if (r.built.truncated) t.truncated++
    if (r.outcome === 'overCap') {
      t.overCap++
      continue
    }
    t.promptChars += prompt.length
    t.estTokens += estimateRhTokens(`${REWARD_HACK_SYSTEM_PROMPT}\n${prompt}`)
    t.judgeUsd += gate.requestedUsd
    t.worstUsd += gate.requestedUsd + refuteWorstUsdFor(prompt, row.prFileList)
  }
  return t
}

// ─── report ─────────────────────────────────────────────────────────────────

/** Results-file lines; a corrupt line is an error naming it. */
export function parseRegressionRecords(
  raw: string,
  file: string
): RegressionRecord[] {
  return raw.split('\n').flatMap((l, i) => {
    if (l.trim() === '') return []
    try {
      return [JSON.parse(l) as RegressionRecord]
    } catch {
      throw new Error(`${file}:${i + 1} is not JSON — fix or remove that line`)
    }
  })
}

/** The last record per trajectory (a re-run supersedes an errored line). */
export function latestPerRow(records: RegressionRecord[]): RegressionRecord[] {
  const m = new Map<string, RegressionRecord>()
  for (const r of records) m.set(r.trajectoryId, r)
  return [...m.values()]
}

export interface RateCI {
  k: number
  n: number
  rate: number | null
  lo: number
  hi: number
}

function rate(k: number, n: number): RateCI {
  const [lo, hi] = wilson(k, n)
  return { k, n, rate: n > 0 ? k / n : null, lo, hi }
}

export interface RegressionReport {
  rows: number
  errors: number
  overCap: number
  partial: number
  noPrFiles: number
  /** Hacked rows with ≥1 reported item (errors excluded; overCap = not flagged). */
  detection: RateCI
  /** Benign rows with ≥1 reported item. */
  falsePositive: RateCI
  /** Judge alone: suspicion ≥ REWARD_HACK_THRESHOLD, before gates/refutes. */
  judgeDetection: RateCI
  judgeFalsePositive: RateCI
  auroc: number | null
  byFamily: Record<string, RateCI>
  spendUsd: number
}

const flagged = (r: RegressionRecord) => r.outcome === 'judged' && r.kept > 0
const judgeFlag = (r: RegressionRecord) =>
  r.suspicion !== null && r.suspicion >= REWARD_HACK_THRESHOLD

export function buildRegressionReport(
  records: RegressionRecord[]
): RegressionReport {
  const latest = latestPerRow(records)
  const scored = latest.filter(r => r.outcome !== 'error')
  const hacked = scored.filter(r => r.hacked)
  const benign = scored.filter(r => !r.hacked)
  const families = new Map<string, RegressionRecord[]>()
  for (const r of hacked)
    for (const f of new Set(r.hackTypes.map(hackFamily)))
      families.set(f, [...(families.get(f) ?? []), r])
  const byFamily: Record<string, RateCI> = {}
  for (const f of [...families.keys()].sort()) {
    const rs = families.get(f)!
    byFamily[f] = rate(rs.filter(flagged).length, rs.length)
  }
  const sus = (rs: RegressionRecord[]) =>
    rs.filter(r => r.suspicion !== null).map(r => r.suspicion!)
  return {
    rows: latest.length,
    errors: latest.length - scored.length,
    overCap: scored.filter(r => r.outcome === 'overCap').length,
    partial: scored.filter(r => r.truncated || r.overCap).length,
    noPrFiles: scored.filter(r => r.prFiles === 0).length,
    detection: rate(hacked.filter(flagged).length, hacked.length),
    falsePositive: rate(benign.filter(flagged).length, benign.length),
    judgeDetection: rate(hacked.filter(judgeFlag).length, hacked.length),
    judgeFalsePositive: rate(benign.filter(judgeFlag).length, benign.length),
    auroc: auroc(sus(hacked), sus(benign)),
    byFamily,
    spendUsd: records.reduce((n, r) => n + r.costs.totalUsd, 0),
  }
}

const pct = (x: number | null) =>
  x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`
const ci = (r: RateCI) =>
  `${r.k}/${r.n} ${pct(r.rate)} (95% ${pct(r.lo)}–${pct(r.hi)})`

export function renderRegressionReport(r: RegressionReport): string {
  const rj = RESEARCH_JUDGE
  const lines = [
    `TRACE through the shipped reward-hack pipeline (threshold ${REWARD_HACK_THRESHOLD})`,
    `rows ${r.rows} · errors ${r.errors} (excluded) · overCap ${r.overCap} (not sent, counted as not flagged) · PARTIAL (cut or overCap) ${r.partial} · no written files ${r.noPrFiles} · spend $${r.spendUsd.toFixed(2)}`,
    `detection (hacked, ≥1 reported item):   ${ci(r.detection)}   [research judge ${pct(rj.detection)}]`,
    `false positive (benign, ≥1 item):       ${ci(r.falsePositive)}   [research judge ${pct(rj.falsePositive)}]`,
    `judge alone (suspicion ≥ threshold):    detection ${ci(r.judgeDetection)} · FP ${ci(r.judgeFalsePositive)}`,
    `AUROC (judge suspicion): ${r.auroc === null ? 'n/a' : r.auroc.toFixed(3)}   [research judge ${rj.auroc.toFixed(3)}]`,
    `detection by hack family:`,
    ...Object.entries(r.byFamily).map(
      ([f, x]) =>
        `  ${f}: ${ci(x)}   [research judge ${pct((rj.byFamily as Record<string, number>)[f] ?? null)}]`
    ),
  ]
  return lines.join('\n')
}

// ─── args + main ────────────────────────────────────────────────────────────

export interface RegressionArgs {
  out: string
  budget: number
  limit: number
  concurrency: number
  data: string | undefined
  dryRun: boolean
  report: boolean
}

export function parseRegressionArgs(argv: string[]): RegressionArgs {
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const num = (name: string, fallback: number, integer: boolean): number => {
    const raw = flag(name)
    if (raw === undefined) return fallback
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isInteger(n)))
      throw new Error(
        `${name} must be a positive ${integer ? 'integer' : 'number'} (got ${raw})`
      )
    return n
  }
  return {
    out: flag('--out') ?? DEFAULT_REGRESSION_OUT,
    budget: num('--budget', 10, false),
    limit: num('--limit', Infinity, true),
    concurrency: num('--concurrency', 4, true),
    data: flag('--data'),
    dryRun: argv.includes('--dry-run'),
    report: argv.includes('--report'),
  }
}

async function readRecords(file: string): Promise<RegressionRecord[]> {
  try {
    return parseRegressionRecords(await readFile(file, 'utf8'), file)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

/**
 * Alternate hacked and benign so `--limit N` is balanced; labels pick the
 * order only.
 */
function interleave<T extends { hacked: boolean }>(xs: T[]): T[] {
  const a = xs.filter(x => x.hacked)
  const b = xs.filter(x => !x.hacked)
  const out: T[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i]!)
    if (b[i]) out.push(b[i]!)
  }
  return out
}

async function main(): Promise<void> {
  const args = parseRegressionArgs(process.argv)
  const say = (s: string) => process.stdout.write(`${s}\n`)
  if (args.report) {
    say(
      renderRegressionReport(buildRegressionReport(await readRecords(args.out)))
    )
    return
  }
  if (!args.dryRun && process.env.AI_PROVIDER !== 'gateway')
    throw new Error('set AI_PROVIDER=gateway (ZDR) for a real run')
  const rows = await loadTraceRows({
    file: resolveTraceFile(args.data),
    download: false,
    fetchCommand: 'npx tsx scripts/crossing-eval.ts --dataset trace --download',
  })
  const prepared = interleave(
    rows.map(r => prepareTraceRow(r as Record<string, unknown>))
  ).slice(0, args.limit)

  if (args.dryRun) {
    const t = await dryRun(prepared)
    say(
      [
        `dry run (no model calls): ${t.rows} rows`,
        `  rows whose input was cut (PARTIAL): ${t.truncated} · over the cap (not sent): ${t.overCap} · no written files: ${t.noPrFiles}`,
        `  judge prompt chars (sent rows): ${t.promptChars}`,
        `  estimated input tokens (product estimator, deliberately high): ${t.estTokens} · chars/4: ${Math.round(t.promptChars / 4)}`,
        `  estimated judge cost: $${t.judgeUsd.toFixed(2)}`,
        `  worst case incl. ${REWARD_HACK_MAX_REFUTES} refutes per row: $${t.worstUsd.toFixed(2)}`,
      ].join('\n')
    )
    return
  }

  const client = await import('@/ee/security/llm/reward-hack-judge-client')
  const judge: RhJudgeFn = p => client.judgeRewardHack(p)
  const refute: RhRefuteFn = a => client.refuteRewardHackItem(a)
  await mkdir(dirname(args.out), { recursive: true })
  const records = await readRecords(args.out)
  const spentBefore = records.reduce((n, r) => n + r.costs.totalUsd, 0)
  const gate = new BudgetGate(args.budget, spentBefore, true)
  const done = new Set(
    records.filter(r => r.outcome !== 'error').map(r => r.trajectoryId)
  )
  const todo = prepared.filter(p => !done.has(p.id))
  say(
    `${todo.length} rows to run · results file spend $${spentBefore.toFixed(2)} of $${args.budget}`
  )
  let next = 0
  let n = 0
  let stopped: string | null = null
  const worker = async (): Promise<void> => {
    while (next < todo.length && !stopped) {
      const row = todo[next++]!
      const r = await regressRow({ row, judge, refute, spend: gate })
      if (r.kind === 'capped') {
        if (r.record)
          await appendFile(args.out, `${JSON.stringify(r.record)}\n`)
        stopped = `budget $${args.budget} reached`
        break
      }
      if (r.kind === 'fatal') {
        stopped = `fatal gateway error: ${r.error}`
        break
      }
      await appendFile(args.out, `${JSON.stringify(r.record)}\n`)
      n++
      if (n % 20 === 0 || n === todo.length)
        say(`  ${n}/${todo.length} · $${gate.spentUsd.toFixed(2)}`)
    }
  }
  await Promise.all(Array.from({ length: args.concurrency }, worker))
  say(
    `${stopped ? `${stopped} — stopped` : 'done'} · ${n} rows this run · spend $${gate.spentUsd.toFixed(2)}`
  )
  say(
    renderRegressionReport(buildRegressionReport(await readRecords(args.out)))
  )
}

if (process.argv[1]?.endsWith('lum1234-trace/trace-product-regression.ts')) {
  main().catch(err => {
    process.stderr.write(
      `lum1234 trace regression: ${(err as Error).message}\n`
    )
    process.exit(1)
  })
}

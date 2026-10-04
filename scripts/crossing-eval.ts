/**
 * LUM-984 — one evaluation entry point for the boundary-crossing monitor:
 * any dataset × any judge, scored and reported the same way.
 *
 *   npx tsx scripts/crossing-eval.ts --list
 *   npx tsx scripts/crossing-eval.ts --dataset gold --judge stub
 *   npx tsx scripts/crossing-eval.ts --dataset basharena-monitor-eval --judge rules [--confirm] [--history] [--split tune|holdout|all]
 *   npx tsx scripts/crossing-eval.ts --dataset basharena-synthetic --judge rules [--confirm] [--split train|test|all]
 *   npx tsx scripts/crossing-eval.ts --dataset rjudge --judge rules --confirm
 *   npx tsx scripts/crossing-eval.ts --dataset basharena-monitor-eval --judge recorded \
 *     --records $HOME/.cache/lumo-lum965/results.jsonl --config whole/v1/anthropic/claude-sonnet-4.6 --split holdout
 *   npx tsx scripts/crossing-eval.ts --dataset controlarena-holdout --judge recorded \
 *     --records $HOME/.cache/lumo-lum965/results.jsonl --config whole/v1/anthropic/claude-sonnet-4.6 --threshold 0.4
 *
 *   common flags: --json (machine-readable, for before/after diffs)
 *                 --data <dir|file> (override the dataset's cache location)
 *                 --download (fetch a missing cache; the only network access)
 *
 * Default path (gold + stub) is offline and deterministic, and exits 1 when
 * the recall guard trips — the same contract as scripts/boundary-align-eval.ts.
 * No DB, no Lumo writes. A scored judge's threshold is chosen on the
 * dataset's tune split or given with --threshold; never on the reported set.
 */
import { homedir } from 'node:os'
import { stubActionJudge } from '@/lib/boundary-crossing/align-eval'
import { goldDataset } from '@/lib/boundary-crossing/eval/datasets/gold'
import {
  pickConfig,
  readRecordsFiles,
  recordedJudge,
} from '@/lib/boundary-crossing/eval/recorded-judge'
import { formatEvalReport } from '@/lib/boundary-crossing/eval/report'
import { ruleJudge } from '@/lib/boundary-crossing/eval/rule-judge'
import { runEval, type DatasetAdapter } from '@/lib/boundary-crossing/eval/run'
import type { Judge } from '@/lib/boundary-crossing/eval/types'
import {
  basharenaMonitorEval,
  basharenaSynthetic,
  controlarenaHoldout,
  rjudge,
} from './crossing-eval/datasets'

export const DATASETS: DatasetAdapter[] = [
  goldDataset(),
  basharenaMonitorEval,
  basharenaSynthetic,
  rjudge,
  controlarenaHoldout,
]

export const JUDGES: { id: string; describe: string }[] = [
  {
    id: 'stub',
    describe:
      'rule detector + action confirmation by the deterministic stub judge (= rules --confirm; scripts/boundary-align-eval.ts default)',
  },
  {
    id: 'rules',
    describe:
      'rule detector (detectAndRecord composition, no DB); --confirm adds stub action confirmation, --confirm --live the real model client',
  },
  {
    id: 'recorded',
    describe:
      'recorded LLM judgements re-scored from a results file (LUM-958 / LUM-965 .jsonl); --records <file[,file]> [--config <approach/variant/model>] [--threshold t] [--unjudged skip|zero]',
  },
]

const VALUE_FLAGS = [
  '--dataset',
  '--judge',
  '--split',
  '--data',
  '--records',
  '--config',
  '--threshold',
  '--unjudged',
] as const
const BOOL_FLAGS = [
  '--list',
  '--json',
  '--confirm',
  '--live',
  '--history',
  '--download',
  '--help',
] as const

export interface CliOptions {
  list: boolean
  help: boolean
  json: boolean
  dataset?: string | undefined
  judge?: string | undefined
  confirm: boolean
  live: boolean
  history: boolean
  download: boolean
  split?: string | undefined
  data?: string | undefined
  records: string[]
  config?: string | undefined
  threshold?: number | undefined
  unjudged: 'skip' | 'zero'
}

export class UsageError extends Error {}

function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? `${homedir()}${p.slice(1)}` : p
}

export function parseArgs(argv: string[]): CliOptions {
  const values: Record<string, string> = {}
  const bools = new Set<string>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if ((VALUE_FLAGS as readonly string[]).includes(a)) {
      const v = argv[i + 1]
      if (v === undefined || v.startsWith('--')) {
        throw new UsageError(`${a} needs a value`)
      }
      values[a] = v
      i++
    } else if ((BOOL_FLAGS as readonly string[]).includes(a)) {
      bools.add(a)
    } else {
      throw new UsageError(`unknown argument ${a} — see --help`)
    }
  }
  let threshold: number | undefined
  if (values['--threshold'] !== undefined) {
    threshold = Number(values['--threshold'])
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
      throw new UsageError('--threshold must be a number in (0, 1]')
    }
  }
  const unjudged = values['--unjudged'] ?? 'skip'
  if (unjudged !== 'skip' && unjudged !== 'zero') {
    throw new UsageError('--unjudged must be skip or zero')
  }
  const opts: CliOptions = {
    list: bools.has('--list'),
    help: bools.has('--help'),
    json: bools.has('--json'),
    dataset: values['--dataset'],
    judge: values['--judge'],
    confirm: bools.has('--confirm'),
    live: bools.has('--live'),
    history: bools.has('--history'),
    download: bools.has('--download'),
    split: values['--split'],
    data: values['--data'] ? expandHome(values['--data']) : undefined,
    records: values['--records']
      ? values['--records'].split(',').map(p => expandHome(p.trim()))
      : [],
    config: values['--config'],
    threshold,
    unjudged,
  }
  if (opts.list || opts.help) return opts
  if (!opts.dataset) throw new UsageError('--dataset is required (see --list)')
  if (!opts.judge) throw new UsageError('--judge is required (see --list)')
  if (!DATASETS.some(d => d.id === opts.dataset)) {
    throw new UsageError(
      `unknown dataset ${opts.dataset} — one of: ${DATASETS.map(d => d.id).join(', ')}`
    )
  }
  if (!JUDGES.some(j => j.id === opts.judge)) {
    throw new UsageError(
      `unknown judge ${opts.judge} — one of: ${JUDGES.map(j => j.id).join(', ')}`
    )
  }
  if (opts.confirm && opts.judge !== 'rules') {
    throw new UsageError('--confirm only applies to --judge rules')
  }
  if (opts.live && !(opts.judge === 'rules' && opts.confirm)) {
    throw new UsageError('--live only applies to --judge rules --confirm')
  }
  const recordedOnly = [
    ['--records', opts.records.length > 0],
    ['--config', opts.config !== undefined],
    ['--unjudged', values['--unjudged'] !== undefined],
  ] as const
  for (const [flag, set] of recordedOnly) {
    if (set && opts.judge !== 'recorded') {
      throw new UsageError(`${flag} only applies to --judge recorded`)
    }
  }
  if (opts.judge === 'recorded' && opts.records.length === 0) {
    throw new UsageError(
      '--judge recorded needs --records <results.jsonl[,more.jsonl]>'
    )
  }
  const ds = DATASETS.find(d => d.id === opts.dataset)!
  if (opts.history && !(ds.flags ?? []).includes('--history')) {
    throw new UsageError(`--history does not apply to ${ds.id}`)
  }
  if (opts.split && !ds.splits) {
    throw new UsageError(`${ds.id} has no splits`)
  }
  return opts
}

export function formatList(): string {
  const lines = ['datasets:']
  for (const d of DATASETS) {
    lines.push(`  ${d.id}  [unit: ${d.unit}]`)
    lines.push(`      ${d.describe}`)
    lines.push(`      data: ${d.source}`)
    if (d.splits) lines.push(`      --split ${d.splits.join(' | ')}`)
    if (d.flags?.length) lines.push(`      flags: ${d.flags.join(' ')}`)
  }
  lines.push('', 'judges:')
  for (const j of JUDGES) {
    lines.push(`  ${j.id}`)
    lines.push(`      ${j.describe}`)
  }
  return `${lines.join('\n')}\n`
}

async function buildJudge(opts: CliOptions): Promise<Judge> {
  if (opts.judge === 'stub') {
    return {
      ...ruleJudge({ kind: 'stub', judge: stubActionJudge }),
      id: 'stub',
    }
  }
  if (opts.judge === 'rules') {
    if (!opts.confirm) return ruleJudge({ kind: 'off' })
    if (!opts.live) return ruleJudge({ kind: 'stub', judge: stubActionJudge })
    // Lazy: the default path never loads the AI SDK or touches the network.
    const { confirmActionExecuted } =
      await import('@/lib/llm/action-confirm-client')
    return ruleJudge({ kind: 'live', judge: confirmActionExecuted })
  }
  const units = await readRecordsFiles(opts.records)
  const config = pickConfig(units, opts.config)
  return recordedJudge({
    units,
    config,
    files: opts.records,
    missingAsZero: opts.unjudged === 'zero',
  })
}

export const HELP = `usage: npx tsx scripts/crossing-eval.ts --dataset <id> --judge <id> [flags]
       npx tsx scripts/crossing-eval.ts --list
flags: --json  --split <s>  --history  --data <path>  --download
       --confirm [--live]                     (judge rules)
       --records <f[,f]> --config <c> --threshold <t> --unjudged skip|zero   (judge recorded)
`

export async function main(
  argv: string[],
  out: (s: string) => void = s => process.stdout.write(s),
  err: (s: string) => void = s => process.stderr.write(s)
): Promise<number> {
  let opts: CliOptions
  try {
    opts = parseArgs(argv)
  } catch (e) {
    if (e instanceof UsageError) {
      err(`crossing-eval: ${e.message}\n`)
      return 2
    }
    throw e
  }
  if (opts.help) {
    out(HELP)
    return 0
  }
  if (opts.list) {
    out(formatList())
    return 0
  }
  const dataset = DATASETS.find(d => d.id === opts.dataset)!
  const loaded = await dataset.load({
    data: opts.data,
    split: opts.split,
    history: opts.history,
    download: opts.download,
    log: m => err(`${m}\n`),
  })
  const judge = await buildJudge(opts)
  const { report, detail, guardFailure } = await runEval({
    dataset,
    loaded,
    judge,
    threshold: opts.threshold,
  })
  if (opts.json) {
    out(`${JSON.stringify({ report, guardFailure }, null, 2)}\n`)
  } else {
    out(formatEvalReport(report) + detail)
  }
  if (guardFailure) {
    err(`\n✗ ${guardFailure}\n`)
    return 1
  }
  if (dataset.guard) err('\n✓ recall guard: no non-evasion positive slipped\n')
  return 0
}

/** Process entry: run `main`, exit with its code; an unexpected error exits 1. */
export async function runCli(argv: string[]): Promise<number> {
  try {
    return await main(argv)
  } catch (e) {
    process.stderr.write(`crossing-eval: ${(e as Error)?.message ?? e}\n`)
    return 1
  }
}

if (require.main === module) {
  void (async () => {
    process.exit(await runCli(process.argv.slice(2)))
  })()
}

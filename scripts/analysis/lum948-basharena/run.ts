/**
 * LUM-948 — offline BashArena eval for the boundary detector (CLI entry).
 *
 *   npx tsx scripts/analysis/lum948-basharena/run.ts                 # deterministic, text report
 *   npx tsx scripts/analysis/lum948-basharena/run.ts --json > a.json # machine-readable, for before/after diffs
 *   npx tsx scripts/analysis/lum948-basharena/run.ts --confirm       # + confirmActionCandidates (stub judge)
 *   npx tsx scripts/analysis/lum948-basharena/run.ts --history       # monitor-eval: whole trajectory, not only scored actions
 *   flags: --cache-dir <dir>  --refresh  (re-download)
 *
 * Read-only: no DB, no Lumo writes. Network only to download the (unlicensed,
 * never committed) datasets into the local cache. `--confirm` uses align-eval's
 * deterministic stub judge — never a network model.
 */
import { stubActionJudge } from '@/ee/private/boundary-crossing/align-eval'
import {
  monitorEvalTrajectories,
  syntheticTrajectories,
  type MonitorEvalRow,
  type SyntheticRow,
  type Trajectory,
} from './convert'
import { DEFAULT_CACHE_DIR, SOURCES, loadSplit } from './download'
import { aggregate, evaluateTrajectory, formatReport } from './evaluate'

export interface CliOptions {
  json: boolean
  confirm: boolean
  history: boolean
  refresh: boolean
  cacheDir: string
}

export function parseArgs(argv: string[]): CliOptions {
  const i = argv.indexOf('--cache-dir')
  const cacheDir = i >= 0 ? argv[i + 1] : undefined
  if (i >= 0 && (!cacheDir || cacheDir.startsWith('--'))) {
    throw new Error('--cache-dir needs a directory')
  }
  return {
    json: argv.includes('--json'),
    confirm: argv.includes('--confirm'),
    history: argv.includes('--history'),
    refresh: argv.includes('--refresh'),
    cacheDir: cacheDir ?? DEFAULT_CACHE_DIR,
  }
}

export async function main(argv: string[]): Promise<number> {
  const opts = parseArgs(argv)
  const log = (m: string) => process.stderr.write(`${m}\n`)
  const trajectories: Trajectory[] = []
  for (const src of SOURCES) {
    const rows = await loadSplit(opts.cacheDir, src.dataset, src.split, {
      refresh: opts.refresh,
      log,
    })
    if (src.dataset.endsWith('monitor-eval')) {
      trajectories.push(
        ...monitorEvalTrajectories(rows as unknown as MonitorEvalRow[], {
          includeHistory: opts.history,
        })
      )
    } else {
      trajectories.push(
        ...syntheticTrajectories(rows as unknown as SyntheticRow[], src.split)
      )
    }
  }
  const judge = opts.confirm ? stubActionJudge : null
  const results = []
  for (const t of trajectories) results.push(await evaluateTrajectory(t, judge))
  const report = aggregate(results, {
    mode: opts.confirm ? 'confirm-stub' : 'deterministic',
    includeHistory: opts.history,
  })
  process.stdout.write(
    opts.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report)
  )
  return 0
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then(code => process.exit(code))
    .catch(err => {
      process.stderr.write(`lum948-basharena: ${err?.message ?? err}\n`)
      process.exit(1)
    })
}

/**
 * LUM-963 — offline RedCode-Exec eval of the boundary detector (CLI entry).
 *
 *   npx tsx scripts/analysis/lum963-redcode/run.ts                    # bash + python (inline), text report
 *   npx tsx scripts/analysis/lum963-redcode/run.ts --python-mode file # python as Write + run
 *   npx tsx scripts/analysis/lum963-redcode/run.ts --deterministic    # skip the action confirmation (stub judge)
 *   npx tsx scripts/analysis/lum963-redcode/run.ts --json > out.json  # machine-readable, for before/after diffs
 *   flags: --lang bash|python  --cache-dir <dir>  --refresh
 *
 * Read-only: no DB, no Lumo writes, no network model. Network only to fetch
 * the pinned upstream files into a cache outside the repository. See
 * RESULTS.md for numbers and the data's attribution (CC BY 4.0).
 */
import type { PythonMode } from './convert'
import {
  aggregate,
  detectorFor,
  evaluateItem,
  formatReport,
  type Stage,
} from './evaluate'
import {
  REDCODE_REPO,
  REDCODE_SHA,
  defaultCacheDir,
  loadAll,
  type RedCodeLanguage,
} from './source'

export interface CliOptions {
  json: boolean
  refresh: boolean
  cacheDir: string
  pythonMode: PythonMode
  stage: Stage
  langs: RedCodeLanguage[]
}

function valueOf(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag)
  if (i < 0) return undefined
  const v = argv[i + 1]
  if (!v || v.startsWith('--')) throw new Error(`${flag} needs a value`)
  return v
}

export function parseArgs(argv: string[]): CliOptions {
  const mode = valueOf(argv, '--python-mode') ?? 'inline'
  if (mode !== 'inline' && mode !== 'file') {
    throw new Error('--python-mode must be inline or file')
  }
  const lang = valueOf(argv, '--lang')
  if (lang && lang !== 'bash' && lang !== 'python') {
    throw new Error('--lang must be bash or python')
  }
  return {
    json: argv.includes('--json'),
    refresh: argv.includes('--refresh'),
    cacheDir: valueOf(argv, '--cache-dir') ?? defaultCacheDir(),
    pythonMode: mode,
    stage: argv.includes('--deterministic') ? 'deterministic' : 'confirm-stub',
    langs: lang ? [lang as RedCodeLanguage] : ['bash', 'python'],
  }
}

export async function main(argv: string[]): Promise<number> {
  const opts = parseArgs(argv)
  const log = (m: string) => process.stderr.write(`${m}\n`)
  const items = await loadAll(opts.cacheDir, opts.langs, {
    refresh: opts.refresh,
    log,
  })
  const detect = detectorFor(opts.stage)
  const results = []
  for (const item of items) {
    results.push(await evaluateItem(item, opts.pythonMode, detect))
  }
  const report = aggregate(results, {
    source: { repo: REDCODE_REPO, sha: REDCODE_SHA, license: 'CC BY 4.0' },
    pythonMode: opts.pythonMode,
    stage: opts.stage,
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
      process.stderr.write(`lum963-redcode: ${err?.message ?? err}\n`)
      process.exit(1)
    })
}

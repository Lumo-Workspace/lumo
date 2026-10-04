/**
 * LUM-949 — offline R-Judge evaluation of the boundary detector.
 *
 *   npx tsx scripts/analysis/lum949-rjudge/run.ts --download          # fetch + run
 *   npx tsx scripts/analysis/lum949-rjudge/run.ts                     # run from cache
 *   npx tsx scripts/analysis/lum949-rjudge/run.ts --json > out.json   # machine-readable
 *   npx tsx scripts/analysis/lum949-rjudge/run.ts --data-dir <dir>
 *
 * Read-only: the only network access is the optional --download of the pinned
 * upstream files into a cache dir outside the repository (no license upstream →
 * never committed). No DB, no LLM, no writes to Lumo. See RESULTS.md.
 */
import { convertRecord } from './convert'
import {
  evaluateRecord,
  formatReport,
  pipelineDetector,
  summarize,
} from './evaluate'
import {
  RJUDGE_REPO,
  RJUDGE_SHA,
  defaultDataDir,
  downloadAll,
  loadAll,
} from './source'

export interface CliOptions {
  json: boolean
  download: boolean
  dataDir: string
}

export function parseArgs(argv: string[]): CliOptions {
  const i = argv.indexOf('--data-dir')
  const dataDir = i >= 0 ? argv[i + 1] : undefined
  if (i >= 0 && (!dataDir || dataDir.startsWith('--'))) {
    throw new Error('--data-dir needs a path')
  }
  return {
    json: argv.includes('--json'),
    download: argv.includes('--download'),
    dataDir: dataDir ?? defaultDataDir(),
  }
}

export async function main(argv: string[]): Promise<number> {
  const opts = parseArgs(argv)
  const log = (line: string) => process.stderr.write(`${line}\n`)
  if (opts.download) await downloadAll(opts.dataDir, log)
  const { records, invalid } = await loadAll(opts.dataDir)

  const converted = records.map(r => convertRecord(r))
  const detect = pipelineDetector()
  const results = []
  for (const c of converted) {
    if (c.status === 'unmapped') continue
    results.push(await evaluateRecord(c, detect))
  }
  const report = summarize(converted, results, {
    repo: RJUDGE_REPO,
    sha: RJUDGE_SHA,
    invalid,
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
      process.stderr.write(`lum949-rjudge: ${err?.message ?? err}\n`)
      process.exit(1)
    })
}

/**
 * Boundary-crossing false-positive-rate report (LUM-449, Phase 1-②) — read-only.
 *
 * Measure-first denoise instrument for the dev-guardrail wedge. It reads every
 * HUMAN-dispositioned crossing (LUM-435: FALSE_POSITIVE vs CONFIRMED) and prints
 * the false-positive rate per category, honestly withholding a rate for any
 * category below the sample threshold (a freshly-launched detector has sparse
 * dispositions; a misleading 100%/0% off two rows would invite a blind
 * over-tighten). It is a runnable script, deliberately NOT a `lumo` subcommand —
 * it touches no `cli/src/commands/**`, so it carries no SKILL.md-sync duty
 * (mirrors `scripts/checkpointer-drift.ts`).
 *
 * Read-only (the core invariant, mirrors the LUM-436 sweep): the only data
 * access is `boundaryCrossingRepository.findDispositioned()`, a single SELECT.
 * It never writes or mutates a crossing or its disposition.
 *
 * Usage:
 *   npx tsx scripts/boundary-fp-rate.ts [--min N]
 *     --min N   override the per-category sample threshold (default 10)
 *
 * Reads the DATABASE_URL already in the environment (does not load a specific
 * .env — run it against whichever database you want a report on).
 */
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import {
  computeFalsePositiveRates,
  formatReport,
  DEFAULT_MIN_SAMPLES,
  type DispositionedCrossing,
} from '@/ee/private/boundary-crossing/false-positive-rate'

function parseMin(argv: string[]): number {
  const i = argv.indexOf('--min')
  if (i === -1) return DEFAULT_MIN_SAMPLES
  const raw = argv[i + 1]
  const n = raw != null ? Number.parseInt(raw, 10) : NaN
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`--min expects a positive integer, got "${raw ?? ''}"`)
  }
  return n
}

export async function main(argv: string[]): Promise<number> {
  const minSamples = parseMin(argv)
  const rows = await boundaryCrossingRepository.findDispositioned()
  const report = computeFalsePositiveRates(rows as DispositionedCrossing[], {
    minSamples,
  })
  process.stdout.write(formatReport(report))
  return 0
}

// Run only when invoked as a script (never when imported by tests).
if (process.argv[1] && process.argv[1].endsWith('boundary-fp-rate.ts')) {
  main(process.argv.slice(2)).then(
    code => process.exit(code),
    err => {
      process.stderr.write(`boundary-fp-rate: ${(err as Error).message}\n`)
      process.exit(1)
    }
  )
}

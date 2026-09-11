/**
 * LUM-740 — suggested-disposition precision (spec §12 R2).
 *
 * READ-ONLY — no writes. Over every finding with a `suggestedDisposition`:
 * how many a human confirmed, overruled, or has not decided on, and the
 * resulting precision. This number (with the LUM-739 hunt audit) is the
 * precondition for ever letting an LLM-derived finding block DONE.
 *
 * Run:
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config scripts/analysis/lum740-suggestion-precision/report.ts
 */
import { prisma } from '../../../lib/db/prisma'
import { aggregateSuggestionPrecision } from './aggregate'

function pct(n: number | null): string {
  return n === null ? 'n/a' : `${(n * 100).toFixed(1)}%`
}

async function main(): Promise<void> {
  const rows = await prisma.prSecurityFinding.findMany({
    where: { suggestedDisposition: { not: null } },
    select: {
      suggestedDisposition: true,
      disposition: true,
      suggestionOutcome: true,
    },
  })
  const s = aggregateSuggestionPrecision(rows)
  const out = [
    '=== LUM-740 suggested-disposition precision ===',
    `suggested: ${s.suggested}`,
    `confirmed: ${s.confirmed}`,
    `overruled: ${s.overruled}`,
    `pending:   ${s.pending}`,
    `precision (confirmed / decided): ${pct(s.precision)}`,
    '',
  ].join('\n')
  process.stdout.write(out)
}

main()
  .catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack : error}\n`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

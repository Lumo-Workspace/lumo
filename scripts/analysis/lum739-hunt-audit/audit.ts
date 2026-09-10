/**
 * LUM-739 — hunt audit (spec §6 L3 "Verify" step 4, §12 R2).
 *
 * READ-ONLY — no writes. Reports, over every scan whose `stages` carries a
 * `hunt` key: per-state counts, candidates, mechanical rejections by reason,
 * the falsifier REJECT rate, the INCONCLUSIVE → FALSE_POSITIVE disposition
 * rate, and token spend. These two rates are the precondition for ever
 * letting an LLM_JUDGE finding block DONE (policy table, LUM-740).
 *
 * Run:
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config scripts/analysis/lum739-hunt-audit/audit.ts
 */
import { prisma } from '../../../lib/db/prisma'
import { aggregateHuntAudit, type HuntScanRow } from './aggregate'

function pct(n: number | null): string {
  return n === null ? 'n/a' : `${(n * 100).toFixed(1)}%`
}

async function main(): Promise<void> {
  const scans = await prisma.prSecurityScan.findMany({
    where: { stages: { path: ['hunt'], not: 'null' } },
    select: {
      id: true,
      stages: true,
      huntAudit: true,
      tokenSpent: true,
      findings: {
        select: {
          ruleId: true,
          provenance: true,
          disposition: true,
          falsifierVerdict: true,
        },
      },
    },
  })
  const stats = aggregateHuntAudit(scans as unknown as HuntScanRow[])

  console.log('=== LUM-739 hunt audit ===')
  console.log(`scans with a hunt layer: ${stats.scans}`)
  for (const [state, n] of Object.entries(stats.hunt)) {
    console.log(`  ${state.padEnd(8)} ${String(n).padStart(6)}`)
  }
  console.log('')
  console.log('=== Hunt → mechanical gate ===')
  console.log(`candidates submitted:   ${stats.candidates}`)
  console.log(`mechanically rejected:  ${stats.mechanicalRejected}`)
  for (const [reason, n] of Object.entries(stats.rejectReasons).sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(`  ${reason.padEnd(28)} ${String(n).padStart(6)}`)
  }
  console.log('')
  console.log('=== Falsifier ===')
  console.log(`REJECT:        ${stats.falsifierRejects}`)
  console.log(
    `INCONCLUSIVE:  ${stats.inconclusive} (persisted as advisory findings)`
  )
  console.log(`REJECT rate:   ${pct(stats.falsifierRejectRate)}`)
  console.log('')
  console.log('=== Human dispositions on INCONCLUSIVE findings ===')
  console.log(`FALSE_POSITIVE: ${stats.falsePositive}`)
  console.log(`ACCEPTED_RISK:  ${stats.acceptedRisk}`)
  console.log(
    `INCONCLUSIVE → FALSE_POSITIVE rate: ${pct(stats.inconclusiveToFalsePositiveRate)}`
  )
  console.log('')
  console.log('=== Tokens ===')
  console.log(
    `metered scans: ${stats.tokenSpent.measured} / ${stats.scans} · total ${stats.tokenSpent.total} tokens`
  )
}

main()
  .catch(err => {
    console.error('[lum739] fatal:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

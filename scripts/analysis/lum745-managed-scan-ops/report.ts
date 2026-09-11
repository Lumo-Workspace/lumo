/**
 * LUM-745 — managed-scan ops read-out (spec §12 R1; milestone exit
 * criterion "last 20 managed scans: external RAN ≥ 90%, no PENDING > 45 min,
 * superseded runs cancelled").
 *
 * READ-ONLY — no writes. Takes the most recent N scans that started a managed
 * run (`managedRunId` set) and prints the external-layer distribution, the RAN
 * rate (superseded rows excluded from the denominator), the PENDING backlog
 * older than 45 min and the failure reasons.
 *
 * Run:
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config scripts/analysis/lum745-managed-scan-ops/report.ts --n 20
 */
import { prisma } from '../../../lib/db/prisma'
import { aggregateManagedScanOps } from './aggregate'

function argN(): number {
  const i = process.argv.indexOf('--n')
  const v = i === -1 ? NaN : Number(process.argv[i + 1])
  return Number.isInteger(v) && v > 0 ? v : 20
}

async function main(): Promise<void> {
  const n = argN()
  const rows = await prisma.prSecurityScan.findMany({
    where: { managedRunId: { not: null } },
    orderBy: { startedAt: 'desc' },
    take: n,
    select: {
      id: true,
      stages: true,
      error: true,
      startedAt: true,
      managedRunId: true,
    },
  })
  const stats = aggregateManagedScanOps(rows, new Date())
  const pct =
    stats.ranRate === null ? 'n/a' : `${(stats.ranRate * 100).toFixed(1)}%`
  process.stdout.write(
    [
      `managed scans considered: ${stats.scans} (requested ${n})`,
      `external: RAN=${stats.external.RAN} FAILED=${stats.external.FAILED} PENDING=${stats.external.PENDING} SUPERSEDED=${stats.external.SUPERSEDED} other=${stats.external.other}`,
      `RAN rate (excl. superseded): ${pct}`,
      `PENDING older than 45 min: ${stats.pendingOver45Min}`,
      `failure reasons: ${JSON.stringify(stats.failureReasons)}`,
      '',
    ].join('\n')
  )
}

main()
  .catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack : error}\n`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

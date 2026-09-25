/**
 * LUM-798 — READ-ONLY probe. Reports what the mechanical gate did to every
 * hunt candidate on record: how each one was placed in the repository
 * (subgraph / sink rule / sandbox sighting), the rejection RATE, and every
 * rejection's full reason string.
 *
 * Run (the dev DB is empty — the real rows are in the production database):
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config \
 *     scripts/analysis/lum798-gate-probe/probe.ts [--since 2026-09-16] [--write]
 *
 * `--write` drops the same numbers as JSON next to this file so a later run
 * can be diffed against an earlier one; without it nothing is written.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../../../lib/db/prisma'
import {
  readGateResults,
  formatGateReadout,
  type HuntAuditRow,
} from './aggregate'

/** Fixed, inside this script's own directory — never taken from argv. */
const REPORT_PATH = join(__dirname, 'gate-readout.json')

function parseSince(argv: string[]): Date | null {
  const i = argv.indexOf('--since')
  if (i < 0) return null
  const raw = argv[i + 1]
  if (raw === undefined) return null
  const at = new Date(raw)
  return Number.isNaN(at.getTime()) ? null : at
}

async function main(): Promise<void> {
  const since = parseSince(process.argv)
  const scans = await prisma.prSecurityScan.findMany({
    where: {
      stages: { path: ['hunt'], not: 'null' },
      ...(since ? { startedAt: { gte: since } } : {}),
    },
    select: {
      headSha: true,
      startedAt: true,
      stages: true,
      huntAudit: true,
      pullRequest: { select: { number: true } },
    },
    orderBy: { startedAt: 'asc' },
  })
  const rows: HuntAuditRow[] = scans.map(s => {
    const stages = (s.stages ?? {}) as Record<string, unknown>
    const audit = s.huntAudit
    return {
      headSha: s.headSha,
      prNumber: s.pullRequest?.number ?? null,
      startedAt: s.startedAt,
      huntStage: typeof stages.hunt === 'string' ? stages.hunt : null,
      audit:
        audit !== null && typeof audit === 'object' && !Array.isArray(audit)
          ? (audit as Record<string, unknown>)
          : null,
    }
  })
  const readout = readGateResults(rows)
  console.log('=== LUM-798 mechanical gate read-out ===')
  if (since) console.log(`since ${since.toISOString()}`)
  for (const line of formatGateReadout(readout)) console.log(line)
  if (process.argv.includes('--write')) {
    writeFileSync(REPORT_PATH, `${JSON.stringify(readout, null, 2)}\n`)
    console.log(`\nwrote ${REPORT_PATH}`)
  }
}

main()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

/**
 * LUM-579 — the audit metric. Reports the current count of negative-claim DONE
 * tasks (the same population enumerate.ts lists). Run it BEFORE regeneration to
 * capture `beforeNeg`, and AFTER to capture `afterNeg`; the acceptance anchor is
 * that afterNeg drops materially below beforeNeg while genuinely-undelivered
 * control tasks stay negative.
 *
 * READ-ONLY.
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config \
 *     scripts/analysis/lum579-run-summary-underreport/audit.ts
 */
import { prisma } from '@/lib/db/prisma'
import { enumerateNegativeClaims } from './enumerate'

async function main() {
  const rows = await enumerateNegativeClaims()
  const ids = rows.map(r => `LUM-${r.number}`).join(', ')
  console.log(`negativeClaimCount = ${rows.length}`)
  console.log(`tasks: ${ids}`)
  await prisma.$disconnect()
}

main().catch(async err => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})

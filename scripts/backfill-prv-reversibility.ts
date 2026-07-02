/**
 * One-time LUM-630 backfill: flip `reversible` to true on existing
 * PROJECT_RULE_VIOLATION crossings whose target carries the `coderule:` prefix
 * (diff-only code-rule violations — pure repo state, undone by a follow-up
 * commit), and on all POLICY_WEAKENING crossings (a committed CLAUDE.md edit,
 * restorable from git). Both LUM-590 categories were never classified in the
 * reversibility taxonomy and their create sites omitted `reversible`, so every
 * row ate the repository's `?? false` default.
 *
 * `actionrule:` PROJECT_RULE_VIOLATION rows are intentionally left untouched —
 * the matched command is arbitrary shell and stays conservatively irreversible.
 *
 * Reversibility is orthogonal to severity: this flips only the 🔒/🔓 label,
 * never the DONE gate (which keys on severity/disposition).
 *
 * Dry-run by default; pass --apply to mutate. Production: run only with
 * explicit per-session authorization against the prod DB URL (CLAUDE.md
 * prod rules apply).
 *
 * Usage:
 *   npx tsx scripts/backfill-prv-reversibility.ts           # dry-run
 *   npx tsx scripts/backfill-prv-reversibility.ts --apply   # mutate
 */
import 'dotenv/config'
import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'

const WHERE_CODE_RULE: Prisma.BoundaryCrossingWhereInput = {
  category: 'PROJECT_RULE_VIOLATION',
  target: { startsWith: 'coderule:' },
  reversible: false,
}
const WHERE_POLICY_WEAKENING: Prisma.BoundaryCrossingWhereInput = {
  category: 'POLICY_WEAKENING',
  reversible: false,
}

async function main() {
  const apply = process.argv.includes('--apply')

  for (const [label, where] of [
    ['PROJECT_RULE_VIOLATION coderule:*', WHERE_CODE_RULE],
    ['POLICY_WEAKENING', WHERE_POLICY_WEAKENING],
  ] as const) {
    if (!apply) {
      const n = await prisma.boundaryCrossing.count({ where })
      console.log(
        `[dry-run] ${n} ${label} crossings would flip reversible -> true.`
      )
    } else {
      const res = await prisma.boundaryCrossing.updateMany({
        where,
        data: { reversible: true },
      })
      console.log(`backfilled reversible=true on ${res.count} ${label} rows`)
    }
  }
  if (!apply) console.log('Re-run with --apply to mutate.')

  await prisma.$disconnect()
}

main().catch(async e => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})

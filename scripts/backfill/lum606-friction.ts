/**
 * LUM-606 — one-time backfill: replay verification friction onto every
 * TaskForecastSnapshot that predates the friction columns (verificationRounds /
 * sendBackCount still NULL). Friction is a deterministic function of the
 * append-only, post-delivery-immutable VerificationRun log cut at each
 * snapshot's capturedAt — so this is a REPLAY, not a guess.
 *
 * Idempotent: a genuine no-verification delivery re-derives to NULL by design
 * (that IS the no-verification bucket, not a skipped row); re-running only
 * recomputes the same value. No LLM calls — only the DB URL is needed.
 *
 *   npx tsx scripts/backfill/lum606-friction.ts --dry-run         # count, no writes (dev)
 *   npx tsx scripts/backfill/lum606-friction.ts                   # apply against dev
 *   npx tsx scripts/backfill/lum606-friction.ts --prod --dry-run  # count against prod
 *   npx tsx scripts/backfill/lum606-friction.ts --prod            # apply against prod (ops step, post-deploy)
 */
import { config } from 'dotenv'

const useProd = process.argv.includes('--prod')
config({ path: useProd ? '.env.production' : '.env.local' })

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  console.log(
    `[backfill] lum606-friction ${useProd ? '(prod)' : '(dev)'} ${
      dryRun ? '(dry-run)' : '(apply)'
    }`
  )

  // Dynamic import AFTER dotenv load so the Prisma client sees the right
  // DATABASE_URL (same ordering as scripts/backfill-claim-snapshots.ts).
  const { prisma } = await import('@/lib/db/prisma')
  const { computeFriction } = await import('@/lib/outcome/friction')

  try {
    // Only snapshots that never got friction frozen (both columns NULL). A real
    // no-verification delivery already has NULL columns and is indistinguishable
    // here — re-deriving simply writes the same NULL, so it is a safe no-op.
    const snaps = await prisma.taskForecastSnapshot.findMany({
      where: { verificationRounds: null, sendBackCount: null },
      select: { id: true, taskId: true, capturedAt: true },
    })
    console.log(`[backfill] candidate snapshots: ${snaps.length}`)

    const dist = new Map<string, number>()
    let written = 0
    let nonNull = 0
    for (const s of snaps) {
      const runs = await prisma.verificationRun.findMany({
        where: { taskId: s.taskId },
        select: { round: true, verdict: true, createdAt: true },
      })
      const f = computeFriction(
        runs.map(r => ({
          round: r.round,
          verdict: r.verdict,
          createdAt: r.createdAt,
        })),
        s.capturedAt
      )
      const label =
        f.verificationRounds === null
          ? 'no-verification'
          : f.verificationRounds >= 2 || (f.sendBackCount ?? 0) >= 1
            ? 'multi-round-or-sendback'
            : 'single-round'
      dist.set(label, (dist.get(label) ?? 0) + 1)
      if (f.verificationRounds !== null) nonNull++

      if (!dryRun && f.verificationRounds !== null) {
        await prisma.taskForecastSnapshot.update({
          where: { id: s.id },
          data: {
            verificationRounds: f.verificationRounds,
            sendBackCount: f.sendBackCount,
          },
        })
        written++
      }
    }

    console.log('[backfill] friction-bucket distribution (replayed):')
    for (const [label, n] of [...dist].sort()) {
      console.log(`  ${label}: ${n}`)
    }
    console.log(
      `[backfill] ${dryRun ? 'would write' : 'wrote'} ${
        dryRun ? nonNull : written
      } non-null rows ` +
        `(${dist.get('no-verification') ?? 0} stay NULL = no-verification bucket)`
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})

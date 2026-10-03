/**
 * One-shot backfill: for every HookEvent with sessionId=null, re-derive
 * session_id from payload, upsert the corresponding Session (using the
 * event's own createdAt so timestamps are historically accurate), and link
 * the HookEvent to it.
 *
 * Safe to re-run. Events whose payload has no session_id are left unlinked.
 *
 * Run with:
 *   npx tsx scripts/backfill-sessions.ts           # default DB (.env)
 *   set -a && source .env.production && set +a && npx tsx scripts/backfill-sessions.ts
 */
import 'dotenv/config'
import { prisma } from '@/lib/db/prisma'
import { openHookPayloads } from '@/lib/hook-event/payload-cipher'

type PayloadShape = {
  session_id?: unknown
  cwd?: unknown
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

async function main() {
  // LUM-863: payloads may be stored encrypted.
  const events = await openHookPayloads(
    await prisma.hookEvent.findMany({
      where: { sessionId: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        workspaceId: true,
        workspaceMemberId: true,
        payload: true,
        payloadEncrypted: true,
        createdAt: true,
      },
    })
  )

  console.log(`scanning ${events.length} orphan HookEvent rows`)

  let linked = 0
  let skipped = 0
  // cache of {sessionId -> true} once we've created the session this run
  const seenSessions = new Set<string>()

  for (const e of events) {
    const p = (e.payload ?? {}) as PayloadShape
    const sessionId = str(p.session_id)
    if (!sessionId) {
      skipped++
      continue
    }
    const cwd = str(p.cwd)

    if (!seenSessions.has(sessionId)) {
      // First time we see this session in this run — upsert with the event's
      // createdAt so startedAt matches the earliest event (events are sorted
      // asc). eventCount is set below via a single update at the end per
      // session; here we just ensure the row exists.
      await prisma.session.upsert({
        where: { id: sessionId },
        create: {
          id: sessionId,
          workspaceId: e.workspaceId,
          workspaceMemberId: e.workspaceMemberId,
          cwd,
          startedAt: e.createdAt,
          lastActivityAt: e.createdAt,
          eventCount: 0, // will be recalc'd after linking
        },
        update: cwd ? { cwd } : {},
      })
      seenSessions.add(sessionId)
    }

    await prisma.hookEvent.update({
      where: { id: e.id },
      data: { sessionId },
    })
    linked++
  }

  // Recompute eventCount + lastActivityAt for every touched session so the
  // cached counters match the actual linked rows.
  for (const sessionId of seenSessions) {
    const agg = await prisma.hookEvent.aggregate({
      where: { sessionId },
      _count: { _all: true },
      _max: { createdAt: true },
      _min: { createdAt: true },
    })
    await prisma.session.update({
      where: { id: sessionId },
      data: {
        eventCount: agg._count._all,
        lastActivityAt: agg._max.createdAt ?? new Date(),
        startedAt: agg._min.createdAt ?? new Date(),
      },
    })
  }

  console.log(`linked ${linked} events across ${seenSessions.size} sessions`)
  if (skipped > 0) {
    console.log(
      `skipped ${skipped} events without payload.session_id (left unlinked)`
    )
  }

  await prisma.$disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

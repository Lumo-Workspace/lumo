/**
 * One-shot backfill for HookEvent.taskId on rows written before the
 * `fix(hooks): tag each HookEvent with its own taskId` fix.
 *
 * Problem: events written by the buggy service had taskId=null, so
 * timeline queries fell back to `session.taskId` — and Session.taskId is
 * write-once (never updated by `lumo session start <new>`). Events
 * emitted after a mid-session switch ended up bucketed under the
 * original task.
 *
 * Heuristic: a Memory is Layer-1's synthesis of the events leading up
 * to a STOP, and Memory.taskId is correct (set from current-task.json
 * at extraction time). For each event, find the FIRST memory at-or-
 * after event.createdAt — that memory's task owns the event. Events
 * that fall before any memory (no synthesis to attach to) keep the
 * session's original taskId (left as NULL → falls through to
 * session.taskId branch in `findByTaskId`).
 *
 * Edge cases:
 *   - Session whose only memories all carry session.taskId → no switch
 *     ever happened, skipped.
 *   - Session whose memories span multiple taskIds (multi-switch) →
 *     interval logic puts each event under the right task.
 *   - Event after the last memory → tagged with last memory's taskId
 *     (active task at the time the session went silent).
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/backfill-hook-event-task-id.ts
 *       → dry-run, prints per-session retag counts
 *   DATABASE_URL=... npx tsx scripts/backfill-hook-event-task-id.ts --commit
 *       → actually update rows
 *   add `--session=<id>` to limit to one session
 */
import { prisma } from '../lib/db/prisma'

interface Args {
  dryRun: boolean
  sessionId: string | undefined
}

function parseArgs(): Args {
  const sessionFlag = process.argv.find(a => a.startsWith('--session='))
  return {
    dryRun: !process.argv.includes('--commit'),
    sessionId: sessionFlag ? sessionFlag.slice('--session='.length) : undefined,
  }
}

async function main() {
  const { dryRun, sessionId } = parseArgs()
  console.log(
    dryRun
      ? '[DRY RUN] no rows will be updated'
      : '[COMMIT] rows will be updated'
  )

  const sessions = await prisma.session.findMany({
    where: sessionId
      ? { id: sessionId }
      : { memories: { some: { taskId: { not: null } } } },
    select: {
      id: true,
      taskId: true,
      memories: {
        select: { taskId: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  let sessionsTouched = 0
  let totalEventsRetagged = 0

  for (const s of sessions) {
    const tagged = s.memories.filter(
      (m): m is { taskId: string; createdAt: Date } => !!m.taskId
    )
    if (tagged.length === 0) continue

    // Skip if all memories already match session.taskId (no switch).
    const distinctMemoryTasks = new Set(tagged.map(m => m.taskId))
    if (distinctMemoryTasks.size === 1 && tagged[0]!.taskId === s.taskId) {
      continue
    }

    // Pull every null-taskId event in this session ordered by time.
    // Events that already have a taskId (written by the post-fix path)
    // are left alone — they're authoritative.
    const events = await prisma.hookEvent.findMany({
      where: { sessionId: s.id, taskId: null },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
    if (events.length === 0) continue

    const lastMemoryTaskId = tagged[tagged.length - 1]!.taskId

    // Walk events and memories together; each event picks up the taskId
    // of the next memory at-or-after it (i.e. the memory that
    // synthesizes the events leading to its STOP).
    //
    // Special case: events BEFORE the first memory. We can't tell
    // whether they predate or follow a switch (Layer 1 is async, so
    // the first memory's taskId only proves "by the time this STOP
    // synthesized, current-task said X" — it doesn't pin down when
    // the switch happened). Conservative choice: leave them with
    // session.taskId (NULL → falls through), which keeps existing
    // history under the original task unless a subsequent memory
    // proves otherwise.
    const updatesByTask: Record<string, string[]> = {}
    let memIdx = 0

    for (const e of events) {
      while (
        memIdx < tagged.length &&
        tagged[memIdx]!.createdAt < e.createdAt
      ) {
        memIdx++
      }

      let targetTask: string
      if (memIdx === 0 && tagged[0]!.createdAt > e.createdAt) {
        targetTask = s.taskId ?? '__no_session_task__'
      } else if (memIdx < tagged.length) {
        targetTask = tagged[memIdx]!.taskId
      } else {
        targetTask = lastMemoryTaskId
      }

      // Leave NULL when target matches session.taskId — functionally
      // identical via the OR fallback in findByTaskId.
      if (targetTask === s.taskId || targetTask === '__no_session_task__') {
        continue
      }

      ;(updatesByTask[targetTask] ??= []).push(e.id)
    }

    const updateCount = Object.values(updatesByTask).reduce(
      (n, ids) => n + ids.length,
      0
    )
    if (updateCount === 0) continue

    sessionsTouched++
    totalEventsRetagged += updateCount

    const breakdown = Object.entries(updatesByTask)
      .map(([t, ids]) => `${t}=${ids.length}`)
      .join(', ')
    console.log(
      `session ${s.id}: session.taskId=${s.taskId ?? '(null)'} | ${events.length} null-taskId events | retag: ${breakdown}`
    )

    if (!dryRun) {
      for (const [taskId, ids] of Object.entries(updatesByTask)) {
        const result = await prisma.hookEvent.updateMany({
          where: { id: { in: ids } },
          data: { taskId },
        })
        console.log(`  ✓ ${taskId}: updated ${result.count} rows`)
      }
    }
  }

  console.log(
    `\n${dryRun ? '[DRY RUN] ' : ''}` +
      `${sessionsTouched} sessions, ${totalEventsRetagged} events ` +
      `${dryRun ? 'would be retagged' : 'retagged'}`
  )
  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})

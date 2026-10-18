/**
 * LUM-1237 history recompute: re-run the attribution engine (compute
 * version 3) over every UNBOUND root session that hosts a self-attached
 * subagent, so the orchestrating parent stops being inferred onto tasks.
 *
 * What changes per family — written by `recomputeAttributionOnly` (which runs
 * `attributionService.recomputeFamily`, the same versioned, root-serialized
 * write the STOP / attach triggers use), then `replayBackfilledEvents` for any
 * event that moved from no task onto one:
 *   - the root's INFERRED segments (only work-output turns keep one);
 *   - the root's event task tags (`HookEvent.taskId`, mostly → no task);
 *   - UNDISPOSITIONED boundary crossings on those events move with them
 *     (dispositioned crossings stay where they were ruled).
 * Nothing else needs a rewrite: subagent active time and the run/Sessions
 * read models are computed at read time from stored events, and subagent
 * tokens were already settled onto the child sessions.
 *
 * Families are processed one at a time, oldest first (one family = one
 * root), so two recomputes of a family never race. Only families still
 * carrying a segment from an older engine version are listed, so re-running
 * with the same `--limit` after a `--commit` continues with the next batch.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/recompute-orchestration-hosts.ts
 *       → dry run: per-family preview + totals, no writes
 *   ... --commit                → write
 *   ... --workspace=<id>        → one workspace only
 *   ... --since=<ISO date>      → roots active since then
 *   ... --session=<rootId>      → one family only
 *   ... --limit=<n>             → at most n families (default 500)
 */
import { attributionRepository } from '../lib/repositories/attribution.repository'
import { attributionService } from '../lib/services/attribution.service'
import {
  recomputeAttributionOnly,
  replayBackfilledEvents,
} from '../lib/attribution/trigger'
import { prisma } from '../lib/db/prisma'

/** Operator output (stdout), one line per call. */
function print(line: string): void {
  process.stdout.write(`${line}\n`)
}

interface Args {
  commit: boolean
  workspaceId?: string
  since?: Date
  sessionId?: string
  limit: number
}

function flag(name: string): string | undefined {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

function parseArgs(): Args {
  const sinceRaw = flag('since')
  const since = sinceRaw ? new Date(sinceRaw) : undefined
  if (since && Number.isNaN(since.getTime())) {
    throw new Error(`--since is not a date: ${sinceRaw}`)
  }
  const limit = Number(flag('limit') ?? 500)
  return {
    commit: process.argv.includes('--commit'),
    ...(flag('workspace') ? { workspaceId: flag('workspace') } : {}),
    ...(since ? { since } : {}),
    ...(flag('session') ? { sessionId: flag('session') } : {}),
    limit: Number.isFinite(limit) && limit > 0 ? limit : 500,
  }
}

async function main(): Promise<void> {
  const args = parseArgs()
  print(
    args.commit
      ? '[COMMIT] families will be recomputed'
      : '[DRY RUN] nothing will be written (add --commit)'
  )
  const roots = args.sessionId
    ? [args.sessionId]
    : await attributionRepository.listOrchestrationHostRootIds({
        ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
        ...(args.since ? { since: args.since } : {}),
        limit: args.limit,
      })
  print(`families: ${roots.length}`)

  const totals = {
    changed: 0,
    eventsRetagged: 0,
    eventsToNoTask: 0,
    openCrossingsMoved: 0,
    failed: 0,
  }
  for (const rootId of roots) {
    const preview = await attributionService.previewFamily(rootId)
    if (!preview) {
      print(`${rootId}  not found`)
      continue
    }
    const before = [...new Set(preview.rootTasksBefore)].length
    const after = [...new Set(preview.rootTasksAfter)].length
    print(
      `${rootId}  root tasks ${before} → ${after}  events retagged ${preview.eventsRetagged} (to no task ${preview.eventsToNoTask})  open crossings on them ${preview.openCrossingsMoved}${preview.segmentsChanged ? '' : '  (segments unchanged)'}`
    )
    if (preview.segmentsChanged || preview.eventsRetagged > 0) totals.changed++
    totals.eventsRetagged += preview.eventsRetagged
    totals.eventsToNoTask += preview.eventsToNoTask
    totals.openCrossingsMoved += preview.openCrossingsMoved
    if (!args.commit) continue
    const res = await recomputeAttributionOnly(rootId)
    if (!res || res.conflict) {
      totals.failed++
      print(`${rootId}  recompute failed or lost the version race — re-run`)
      continue
    }
    await replayBackfilledEvents(rootId, res)
    print(
      `${rootId}  written: segments ${res.written ? 'rewritten' : 'unchanged'}, events ${res.eventsUpdated}, crossings moved ${res.crossingsMoved} (to no task ${res.crossingsMovedToNull})`
    )
  }
  print(
    `${args.commit ? 'done' : 'would change'}: families ${totals.changed}/${roots.length}, events retagged ${totals.eventsRetagged} (to no task ${totals.eventsToNoTask}), open crossings on them ${totals.openCrossingsMoved}${args.commit ? `, failed ${totals.failed}` : ''}`
  )
}

main()
  .catch(error => {
    process.stderr.write(
      `${error instanceof Error ? error.stack : String(error)}\n`
    )
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

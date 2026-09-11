/**
 * LUM-764 — the four reads behind `HuntTaskContext`. Split out of
 * `security-hunt.service.ts` so the planner's task view is one small,
 * mockable module and the service keeps its sandbox/LLM shape.
 *
 * Every read is INDEPENDENTLY best-effort. The planner is a routing decision
 * that already has a deterministic floor under it, so a signal that cannot be
 * read is worth exactly one warn line — never a failed hunt layer. That is
 * also why nothing here throws: the caller has no repair to attempt.
 *
 * The strings this returns are untrusted by construction; rendering them into
 * a prompt is `renderHuntTaskContext`'s job and its trust rules apply there.
 */
import { logger } from '@/lib/logger'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { trapContentSchema } from '@/lib/memory/schemas'
import { L4_CROSSING_CATEGORIES } from '@/lib/security-scan/hunt/trigger'
import {
  EMPTY_HUNT_TASK_CONTEXT,
  TASK_CONTEXT_MAX_ITEMS,
  toContextLine,
  type HuntTaskContext,
} from '@/lib/security-scan/hunt/task-context'

/** How many rows each read may pull before the renderer's cap applies. */
const READ_LIMIT = TASK_CONTEXT_MAX_ITEMS * 2

async function bestEffort<T>(
  what: string,
  taskId: string,
  read: () => Promise<T[]>
): Promise<T[]> {
  try {
    return await read()
  } catch (error) {
    logger.warn(
      `[security-hunt] task-context ${what} read failed task=${taskId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    return []
  }
}

/**
 * The acceptance contract, as the planner's "what did this PR claim to do".
 * MACHINE / HUMAN is kept because it changes how much the statement is worth:
 * a MACHINE criterion names a check that ran, a HUMAN one names an intention
 * nobody has verified yet.
 */
async function readCriteria(taskId: string): Promise<string[]> {
  const rows = await bestEffort('criteria', taskId, () =>
    acceptanceCriterionRepository.listByTask(taskId)
  )
  return rows.map(r => toContextLine(`[${r.verifierType}] ${r.statement}`))
}

/**
 * TRAP memories for the task's project — "the team has walked into this
 * before". Content is JSON typed `unknown` end-to-end, so a row written
 * against an older schema is skipped rather than thrown over.
 */
async function readTraps(taskId: string): Promise<string[]> {
  const rows = await bestEffort('traps', taskId, async () => {
    const task = await taskRepository.findProjectId(taskId)
    if (!task?.projectId) return []
    return memoryRepository.findActiveTrapMemoriesByProject(
      task.projectId,
      READ_LIMIT
    )
  })
  const lines: string[] = []
  for (const row of rows) {
    const parsed = trapContentSchema.safeParse(row.content)
    if (!parsed.success) continue
    lines.push(toContextLine(`${parsed.data.trigger} → ${parsed.data.outcome}`))
  }
  return lines
}

/**
 * The OPEN L4 session-guard crossings. `evaluateHuntTrigger` already reads
 * these as a boolean ("something happened, run the hunt"); the planner gets
 * the categories and details, which is the part that can aim a task —
 * SENSITIVE_PATH_EDIT names a file, TEST_FILE_DELETED names what stopped
 * being checked.
 */
async function readCrossings(taskId: string): Promise<string[]> {
  const rows = await bestEffort('crossings', taskId, () =>
    boundaryCrossingRepository.findUndispositionedByTask(taskId)
  )
  return rows
    .filter(r =>
      (L4_CROSSING_CATEGORIES as readonly string[]).includes(r.category)
    )
    .map(r => toContextLine(`${r.category}: ${r.target ?? ''} ${r.detail}`))
}

/**
 * Verification send-backs — the work came back, and the reason says what a
 * human or a checkpointer found wanting. Newest first: an old round is
 * usually already fixed, the last one rarely is.
 *
 * Per-file rework ("this same file keeps bouncing") is deliberately NOT here:
 * a verification run points at a criterion, not a file, and inferring files
 * from rejection prose would be the planner reading untrusted text as fact.
 */
async function readRework(taskId: string): Promise<string[]> {
  const rows = await bestEffort('rework', taskId, () =>
    verificationRunRepository.listByTask(taskId)
  )
  return rows
    .filter(r => r.verdict === 'FAIL' && r.rejectionReason)
    .reverse()
    .slice(0, READ_LIMIT)
    .map(r => toContextLine(`round ${r.round}: ${r.rejectionReason ?? ''}`))
}

/**
 * Read everything the planner may know about the task behind this PR.
 * `null` taskId (a PR nobody linked) short-circuits to empty, which is what
 * keeps an unlinked PR on exactly LUM-758's cost and behaviour.
 */
export async function loadHuntTaskContext(
  taskId: string | null
): Promise<HuntTaskContext> {
  if (!taskId) return EMPTY_HUNT_TASK_CONTEXT
  const [criteria, traps, crossings, rework] = await Promise.all([
    readCriteria(taskId),
    readTraps(taskId),
    readCrossings(taskId),
    readRework(taskId),
  ])
  return { criteria, traps, crossings, rework }
}

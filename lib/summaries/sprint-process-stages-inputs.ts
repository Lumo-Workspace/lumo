/**
 * LUM-1280 — turn the batched rows read at sprint close into the pure
 * process-stage inputs and the verified count. Pure: the rows come in, the
 * DONE-gate and freshness rules come from their shared pure modules, nothing
 * is fetched here.
 */
import type { TaskStatus } from '@prisma/client'
import { activeIntervalsByTask } from '@/lib/agent-run/active-time'
import { parseStatusPayload } from '@/lib/summaries/burnup-replay'
import {
  isTaskVerified,
  summarizeTestTrust,
  verifiedAt,
  type GateState,
  type VerifiedCaseInput,
} from '@/lib/summaries/sprint-verified'
import type { StageTaskInput } from '@/lib/summaries/sprint-process-stages'
import type { CeilingEnvironment } from '@/lib/test-cases/provability'

export interface StageRows {
  statusEvents: Array<{ taskId: string; payload: unknown; createdAt: Date }>
  crossings: Array<{
    taskId: string | null
    detectedAt: Date
    dispositionedAt: Date | null
    disposition: string | null
    advisory: boolean
    severity: string
  }>
  pullRequests: Array<{
    id: string
    taskId: string | null
    number: number
    title: string
    url: string
    state: string
    headSha: string | null
    mergeCommitSha: string | null
    isDraft: boolean
    createdAt: Date
    mergedAt: Date | null
    closedAt: Date | null
  }>
  testCases: Array<{
    id: string
    taskId: string | null
    requiredEnvironment: CeilingEnvironment | null
    runs: Array<{
      id: string
      result: 'PASS' | 'FAIL' | 'BLOCKED'
      environment: CeilingEnvironment
      failureAttribution: string | null
      unprovenVerification: unknown
      evidence: unknown
      stepResults: unknown
      pullRequestId: string | null
      commitSha: string | null
      commitDirty: boolean | null
      createdAt: Date
      disposition: unknown | null
    }>
  }>
  turnEvents: Array<{
    sessionId: string | null
    taskId: string | null
    type: string
    createdAt: Date
  }>
  crossingGateEnabled: boolean
}

function groupBy<T>(rows: T[], key: (r: T) => string | null) {
  const out = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    if (k === null) continue
    const list = out.get(k)
    if (list) list.push(r)
    else out.set(k, [r])
  }
  return out
}

/**
 * Whether the task was verified at close, and when — through the shared
 * predicate (`./sprint-verified.ts`). The gate mirrors the DONE gate: open
 * non-advisory crossings (all of them when the workspace gate is on, else HIGH
 * only), plugin security blockers (`null` = unreadable → `unknown`, never
 * clear) and latest-run proven defects nobody has ruled on.
 */
function verification(
  status: string,
  crossings: StageRows['crossings'],
  pullRequests: StageRows['pullRequests'],
  testCases: StageRows['testCases'],
  statusEvents: StageRows['statusEvents'],
  gateEnabled: boolean,
  securityBlocking: number | null
): { verified: boolean; at: Date | null } {
  const crossingsBlocking = crossings.filter(
    c =>
      c.disposition === null &&
      !c.advisory &&
      (gateEnabled || c.severity === 'HIGH')
  ).length
  const testsBlocking = testCases.filter(tc => {
    const latest = tc.runs[0]
    return (
      latest?.failureAttribution === 'IMPLEMENTATION_DEFECT' &&
      latest.disposition === null
    )
  }).length
  const gate: GateState =
    crossingsBlocking + testsBlocking + (securityBlocking ?? 0) > 0
      ? 'blocked'
      : securityBlocking === null
        ? 'unknown'
        : 'clear'

  const cases: VerifiedCaseInput[] = testCases.map(tc => ({
    requiredEnvironment: tc.requiredEnvironment,
    latestRun: tc.runs[0] ?? null,
  }))
  const prsById = new Map(pullRequests.map(pr => [pr.id, pr]))
  const verified = isTaskVerified({
    status,
    gate,
    tests: summarizeTestTrust(cases, prsById),
  })

  let doneAt: Date | null = null
  for (const e of statusEvents) {
    if (parseStatusPayload(e.payload)?.to === 'DONE') doneAt = e.createdAt
  }
  return {
    verified,
    at: verifiedAt({
      verified,
      doneAt,
      latestRunAts: testCases.map(tc => tc.runs[0]?.createdAt ?? null),
    }),
  }
}

export function assembleStageInputs(
  tasks: Array<{ id: string; status: TaskStatus | string }>,
  rows: StageRows,
  /** Plugin security blockers per DONE task; `null` = the plane could not
   *  be read. A task missing from the map has none. */
  securityBlockingByTask: ReadonlyMap<string, number | null>
): { stageTasks: StageTaskInput[]; verifiedCount: number } {
  const statusByTask = groupBy(rows.statusEvents, r => r.taskId)
  const crossingsByTask = groupBy(rows.crossings, r => r.taskId)
  const prsByTask = groupBy(rows.pullRequests, r => r.taskId)
  const casesByTask = groupBy(rows.testCases, r => r.taskId)
  const agentByTask = activeIntervalsByTask(rows.turnEvents)

  let verifiedCount = 0
  const stageTasks = tasks.map(task => {
    const statusEvents = statusByTask.get(task.id) ?? []
    const crossings = crossingsByTask.get(task.id) ?? []
    const pullRequests = prsByTask.get(task.id) ?? []
    const { verified, at } = verification(
      task.status,
      crossings,
      pullRequests,
      casesByTask.get(task.id) ?? [],
      statusEvents,
      rows.crossingGateEnabled,
      securityBlockingByTask.has(task.id)
        ? (securityBlockingByTask.get(task.id) ?? null)
        : 0
    )
    if (verified) verifiedCount++
    const firstInProgress = statusEvents.find(
      e => parseStatusPayload(e.payload)?.to === 'IN_PROGRESS'
    )
    return {
      taskId: task.id,
      startedAt: firstInProgress?.createdAt ?? null,
      verifiedAt: at,
      crossings,
      agentIntervals: agentByTask.get(task.id) ?? [],
      pullRequests,
    }
  })
  return { stageTasks, verifiedCount }
}

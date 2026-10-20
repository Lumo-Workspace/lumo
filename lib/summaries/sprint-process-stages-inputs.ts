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
  verifiedAt,
  type VerifiedTaskInput,
} from '@/lib/summaries/sprint-verified'
import type { StageTaskInput } from '@/lib/summaries/sprint-process-stages'
import { deriveLatestVerdict } from '@/lib/test-cases/case-summary'
import { deriveRunFreshness } from '@/lib/test-cases/freshness'
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
 * The shared verified-predicate input for one task, as read at close. The
 * gate count mirrors the DONE gate: open non-advisory crossings (all of them
 * when the workspace gate is on, else HIGH only) + plugin security blockers +
 * latest-run proven defects nobody has ruled on.
 */
function verifiedInput(
  status: string,
  crossings: StageRows['crossings'],
  pullRequests: StageRows['pullRequests'],
  testCases: StageRows['testCases'],
  statusEvents: StageRows['statusEvents'],
  gateEnabled: boolean,
  securityBlocking: number
): VerifiedTaskInput {
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
  let doneAt: Date | null = null
  for (const e of statusEvents) {
    if (parseStatusPayload(e.payload)?.to === 'DONE') doneAt = e.createdAt
  }
  return {
    status,
    gateBlocking: crossingsBlocking + securityBlocking + testsBlocking,
    doneAt,
    testCases: testCases.map(tc => {
      const latest = tc.runs[0] ?? null
      const pr = latest?.pullRequestId
        ? (pullRequests.find(p => p.id === latest.pullRequestId) ?? null)
        : null
      return {
        verdict: deriveLatestVerdict(latest, tc.requiredEnvironment),
        freshness: latest ? deriveRunFreshness(latest, pr).state : null,
        latestRunAt: latest?.createdAt ?? null,
      }
    }),
  }
}

export function assembleStageInputs(
  tasks: Array<{ id: string; status: TaskStatus | string }>,
  rows: StageRows,
  securityBlockingByTask: ReadonlyMap<string, number>
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
    const input = verifiedInput(
      task.status,
      crossings,
      pullRequests,
      casesByTask.get(task.id) ?? [],
      statusEvents,
      rows.crossingGateEnabled,
      securityBlockingByTask.get(task.id) ?? 0
    )
    if (isTaskVerified(input)) verifiedCount++
    const firstInProgress = statusEvents.find(
      e => parseStatusPayload(e.payload)?.to === 'IN_PROGRESS'
    )
    return {
      taskId: task.id,
      startedAt: firstInProgress?.createdAt ?? null,
      verifiedAt: verifiedAt(input),
      crossings,
      agentIntervals: agentByTask.get(task.id) ?? [],
      pullRequests,
    }
  })
  return { stageTasks, verifiedCount }
}

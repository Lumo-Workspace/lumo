/**
 * LUM-750 — rollback of an AGENT-ISSUED disposition.
 *
 * The boundary detector matched `lumo crossing disposition …` /
 * `lumo finding disposition …` in the Bash hook stream of an agent session.
 * Whatever that command wrote is voided here: the referenced crossing /
 * finding(s) go back to OPEN, with an append-only activity carrying
 * `from`/`to`, `channel: 'SYSTEM'` and the reason `reverted: agent-issued`.
 *
 * Only a CLI-channel ruling is ever reverted — the latest disposition
 * activity on the row must be `channel: 'CLI'`. A human's web-panel ruling has
 * no CLI activity and is left exactly as it is, even when the agent's command
 * named it (the command was a no-op there, or refused by the CLI guard).
 *
 * Best-effort like the rest of the detector chain: every step owns its errors;
 * a rollback that cannot be confirmed is reported in `skipped`, never assumed.
 */
import { activityRepository } from '@/lib/repositories/activity.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { taskRepository } from '@/lib/repositories/task.repository'

export const AGENT_ISSUED_REVERT_REASON = 'reverted: agent-issued'

/** What the detector parsed out of the matched command segment. */
export interface SelfDispositionRef {
  kind: 'crossing' | 'finding'
  /** The positional id, or null for the bulk form (`--all-suggested-fp`). */
  id: string | null
  /** `--task <LUM-N>` when present. */
  taskIdentifier: string | null
  bulk: boolean
}

export interface SelfDispositionRollbackInput {
  /** The task the hook event was recorded against (the bound task). */
  taskId: string
  refs: SelfDispositionRef[]
  /** The SELF_DISPOSITION crossing row this rollback is attributed to. */
  selfDispositionCrossingId: string | null
  agentSessionId: string | null
  hookEventId: string | null
}

export interface SelfDispositionRollbackResult {
  crossings: string[]
  findings: string[]
  /** Refs that named nothing revertible (not dispositioned, not CLI-channel,
   *  not found) — listed so the outcome is honest, never inferred. */
  skipped: string[]
}

type Payload = Record<string, unknown>

function channelOf(payload: unknown): string {
  const p = (payload ?? {}) as Payload
  return typeof p.channel === 'string' ? p.channel : 'WEB'
}

/** The latest disposition activity for one row, by the payload key it carries. */
function latestFor(
  rows: Array<{ payload: unknown; createdAt: Date | string }>,
  key: 'boundaryCrossingId' | 'findingId',
  id: string
): Payload | null {
  let latest: Payload | null = null
  for (const r of rows) {
    const p = (r.payload ?? {}) as Payload
    if (p[key] === id) latest = p
  }
  return latest
}

/** Resolve `--task LUM-N` (or a cuid) in the bound task's workspace; falls
 *  back to the bound task when absent or unresolvable. */
async function resolveTargetTask(
  boundTaskId: string,
  identifier: string | null
): Promise<string> {
  if (!identifier) return boundTaskId
  const bound = await taskRepository.findWithProjectWorkspaceId(boundTaskId)
  const workspaceId = bound?.project?.workspaceId
  if (!workspaceId) return boundTaskId
  if (/^c[a-z0-9]{24}$/.test(identifier)) {
    const t = await taskRepository.findByIdForMention(identifier, workspaceId)
    return t?.id ?? boundTaskId
  }
  const m = /^([A-Za-z]+)-(\d+)$/.exec(identifier)
  if (!m) return boundTaskId
  const t = await taskRepository.findByWorkspaceIdentifier(
    workspaceId,
    m[1]!.toUpperCase(),
    parseInt(m[2]!, 10)
  )
  return t?.id ?? boundTaskId
}

export const selfDispositionRollbackService = {
  async rollback(
    input: SelfDispositionRollbackInput
  ): Promise<SelfDispositionRollbackResult> {
    const result: SelfDispositionRollbackResult = {
      crossings: [],
      findings: [],
      skipped: [],
    }
    for (const ref of input.refs) {
      try {
        if (ref.kind === 'crossing') {
          if (!ref.id) {
            result.skipped.push('crossing:<no id>')
            continue
          }
          const done = await revertCrossing(ref.id, input)
          if (done) result.crossings.push(ref.id)
          else result.skipped.push(`crossing:${ref.id}`)
          continue
        }
        if (ref.bulk || !ref.id) {
          const taskId = await resolveTargetTask(
            input.taskId,
            ref.taskIdentifier
          )
          const reverted = await revertCliFindingsOnTask(taskId, input)
          if (reverted.length === 0) result.skipped.push(`findings:${taskId}`)
          result.findings.push(...reverted)
          continue
        }
        const done = await revertFinding(ref.id, input)
        if (done) result.findings.push(ref.id)
        else result.skipped.push(`finding:${ref.id}`)
      } catch {
        result.skipped.push(`${ref.kind}:${ref.id ?? '<bulk>'} (error)`)
      }
    }
    return result
  },
}

async function revertCrossing(
  crossingId: string,
  input: SelfDispositionRollbackInput
): Promise<boolean> {
  const crossing = await boundaryCrossingRepository.findById(crossingId)
  if (!crossing || !crossing.taskId) return false
  const from = crossing.disposition
  if (from !== 'FALSE_POSITIVE' && from !== 'CONFIRMED') return false
  const rows = await activityRepository.listDispositionChangesByTask(
    crossing.taskId
  )
  const latest = latestFor(rows, 'boundaryCrossingId', crossingId)
  if (!latest || channelOf(latest) !== 'CLI') return false
  await boundaryCrossingRepository.disposition(
    crossingId,
    null,
    null,
    null,
    new Date()
  )
  await activityRepository.create({
    taskId: crossing.taskId,
    actorId: null,
    type: 'BOUNDARY_CROSSING_DISPOSITIONED',
    payload: {
      boundaryCrossingId: crossingId,
      category: crossing.category,
      detail: crossing.detail,
      from,
      to: null,
      disposition: null,
      note: null,
      channel: 'SYSTEM',
      reason: AGENT_ISSUED_REVERT_REASON,
      selfDispositionCrossingId: input.selfDispositionCrossingId,
      agentSessionId: input.agentSessionId,
      hookEventId: input.hookEventId,
    },
  })
  return true
}

async function revertFinding(
  findingId: string,
  input: SelfDispositionRollbackInput
): Promise<boolean> {
  const finding = await prSecurityScanRepository.findFindingWithScope(findingId)
  if (!finding || !finding.disposition) return false
  const taskId = finding.scan.pullRequest.taskId
  if (!taskId) return false
  const rows = await activityRepository.listByTaskAndType(
    taskId,
    'SECURITY_FINDING_DISPOSITIONED'
  )
  const latest = latestFor(rows, 'findingId', findingId)
  if (!latest || channelOf(latest) !== 'CLI') return false
  await revertFindingRow(taskId, finding, input)
  return true
}

/** Every finding on the task whose LATEST disposition activity is a CLI
 *  ruling still in force — the bulk form names no ids, so the trail does. */
async function revertCliFindingsOnTask(
  taskId: string,
  input: SelfDispositionRollbackInput
): Promise<string[]> {
  const rows = await activityRepository.listByTaskAndType(
    taskId,
    'SECURITY_FINDING_DISPOSITIONED'
  )
  const latestById = new Map<string, Payload>()
  for (const r of rows) {
    const p = (r.payload ?? {}) as Payload
    if (typeof p.findingId === 'string') latestById.set(p.findingId, p)
  }
  const reverted: string[] = []
  for (const [findingId, latest] of latestById) {
    if (channelOf(latest) !== 'CLI' || latest.to == null) continue
    const finding =
      await prSecurityScanRepository.findFindingWithScope(findingId)
    if (!finding || !finding.disposition) continue
    if (finding.scan.pullRequest.taskId !== taskId) continue
    await revertFindingRow(taskId, finding, input)
    reverted.push(findingId)
  }
  return reverted
}

async function revertFindingRow(
  taskId: string,
  finding: {
    id: string
    ruleId: string
    filePath: string
    line: number | null
    disposition: string | null
  },
  input: SelfDispositionRollbackInput
): Promise<void> {
  await prSecurityScanRepository.clearDisposition(finding.id)
  await activityRepository.create({
    taskId,
    actorId: null,
    type: 'SECURITY_FINDING_DISPOSITIONED',
    payload: {
      findingId: finding.id,
      ruleId: finding.ruleId,
      filePath: finding.filePath,
      line: finding.line,
      from: finding.disposition,
      to: null,
      disposition: null,
      note: null,
      channel: 'SYSTEM',
      reason: AGENT_ISSUED_REVERT_REASON,
      selfDispositionCrossingId: input.selfDispositionCrossingId,
      agentSessionId: input.agentSessionId,
      hookEventId: input.hookEventId,
    },
  })
}

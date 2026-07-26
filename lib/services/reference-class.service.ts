import {
  independenceSignal,
  parseSnapshotCriteria,
  type CriterionChange,
} from '@/lib/fidelity/change-pattern'
import {
  countPostStartContractTasks,
  crossingObservations,
  MAX_CLASS_SIZE,
  rejectionObservations,
  renderReferenceClassAnchor,
  selectReferenceClass,
  tallyByTask,
  type AnchorData,
  type CandidateLayers,
  type ClassLevel,
} from '@/lib/reference-class'
import { referenceClassRepository } from '@/lib/repositories/reference-class.repository'

/**
 * LUM-497 — assemble the outside-view anchor shown while an agent drafts a
 * task's acceptance criteria.
 *
 * Fail-soft by contract: the anchor decorates an existing nudge, so any error,
 * missing task or slow read yields '' and the caller renders the nudge exactly
 * as before. Session-start runs on a ~3s budget, hence the timeout.
 */

/** Default read budget. Session-start must not wait on history analytics. */
const DEFAULT_TIMEOUT_MS = 1_500

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('reference-class timeout')),
          ms
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Map a CRITERION_CHANGED payload to the fidelity module's change shape. */
function toCriterionChange(row: {
  payload: unknown
  createdAt: Date
}): CriterionChange | null {
  const p = row.payload
  if (p == null || typeof p !== 'object') return null
  const rec = p as Record<string, unknown>
  const op = rec.op
  if (op !== 'ADDED' && op !== 'UPDATED' && op !== 'DELETED') return null
  if (typeof rec.criterionId !== 'string') return null
  return {
    op,
    criterionId: rec.criterionId,
    round: typeof rec.round === 'number' ? rec.round : 0,
    causeTag: typeof rec.causeTag === 'string' ? rec.causeTag : null,
    at: row.createdAt,
  }
}

function scopeLabel(
  level: ClassLevel,
  scope: { milestoneName: string | null; projectName: string; teamName: string }
): string {
  if (level === 'MILESTONE') return scope.milestoneName ?? 'this milestone'
  if (level === 'PROJECT') return scope.projectName
  return scope.teamName
}

async function build(taskId: string): Promise<string> {
  const scope = await referenceClassRepository.taskScope(taskId)
  if (!scope) return ''

  const [milestone, project, team] = await Promise.all([
    scope.milestoneId
      ? referenceClassRepository.deliveredByMilestone(
          scope.milestoneId,
          MAX_CLASS_SIZE + 1
        )
      : Promise.resolve(null),
    referenceClassRepository.deliveredByProject(
      scope.projectId,
      MAX_CLASS_SIZE + 1
    ),
    referenceClassRepository.deliveredByTeam(scope.teamId, MAX_CLASS_SIZE + 1),
  ])

  const layers: CandidateLayers = { milestone, project, team }
  const selected = selectReferenceClass(layers, taskId)
  if (selected.kind === 'INSUFFICIENT') {
    return renderReferenceClassAnchor({ kind: 'INSUFFICIENT' })
  }

  const { taskIds, size, level } = selected
  const [rejections, withdrawals, crossings, snapshots, changes] =
    await Promise.all([
      referenceClassRepository.rejectionRows(taskIds),
      referenceClassRepository.withdrawnVerdictActions(taskIds),
      referenceClassRepository.crossingRows(taskIds),
      referenceClassRepository.latestSnapshots(taskIds),
      referenceClassRepository.criterionChanges(taskIds),
    ])

  const changesByTask = new Map<string, CriterionChange[]>()
  for (const row of changes) {
    const mapped = toCriterionChange(row)
    if (!mapped) continue
    const list = changesByTask.get(row.taskId) ?? []
    list.push(mapped)
    changesByTask.set(row.taskId, list)
  }

  // Same basis as `lumo fidelity show` — the independence signal is imported,
  // never reimplemented, so the anchor and the fidelity report can't diverge.
  const signals = snapshots.map(s =>
    independenceSignal(
      {
        snapshotId: s.taskId,
        frozenAt: s.frozenAt,
        trigger: 'REFERENCE_CLASS',
        sessionId: null,
        criteria: parseSnapshotCriteria(s.criteria),
      },
      changesByTask.get(s.taskId) ?? []
    )
  )

  const data: AnchorData = {
    level,
    label: scopeLabel(level, scope),
    size,
    rejections: tallyByTask(rejectionObservations(rejections, withdrawals)),
    crossings: tallyByTask(crossingObservations(crossings)),
    postStartContractTasks: countPostStartContractTasks(signals),
  }
  return renderReferenceClassAnchor({ kind: 'READY', ...data })
}

export const referenceClassService = {
  /**
   * Rendered anchor markdown, or '' when it cannot be produced. Never throws —
   * callers append the result unconditionally.
   */
  async buildAnchor(
    taskId: string,
    opts?: { timeoutMs?: number }
  ): Promise<string> {
    try {
      return await withTimeout(
        build(taskId),
        opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
      )
    } catch {
      return ''
    }
  },
}

import {
  criterionChangeFromPayload,
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
  type ClassLevel,
  type ReferenceClass,
} from '@/lib/reference-class'
import {
  referenceClassRepository,
  type TaskScope,
} from '@/lib/repositories/reference-class.repository'

/**
 * LUM-497 — assemble the outside-view anchor shown while an agent drafts a
 * task's acceptance criteria.
 *
 * Fail-soft by contract: the anchor decorates an existing nudge, so any error,
 * missing task or slow read yields '' and the caller renders the nudge exactly
 * as before. Session-start runs on a ~3s budget, hence the timeout.
 */

/**
 * Default read budget. Session-start must not wait on history analytics.
 *
 * WHY 600: `buildAnchor` is awaited AFTER the parallel fetch block in
 * `buildSessionStartSections` — it is a serial TAIL on that path's ~3s budget,
 * not one more branch of the fan-out (hoisting it into the block would cost
 * every opted-out workspace a query it never reads, which
 * __tests__/services/task-context-acceptance-mode-gate.test.ts pins). The
 * anchor is a nice-to-have decoration on a nudge that stands on its own, so a
 * slow read must be abandoned rather than allowed to delay the nudge; at the
 * previous 1_500 it could burn half the budget and then return '' anyway.
 *
 * Note `withTimeout` RACES, it does not cancel: the underlying queries keep
 * running after the anchor is abandoned. This number bounds how long
 * session-start waits, not how long the DB works.
 */
const DEFAULT_TIMEOUT_MS = 600

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

function scopeLabel(
  level: ClassLevel,
  scope: { milestoneName: string | null; projectName: string; teamName: string }
): string {
  if (level === 'MILESTONE') return scope.milestoneName ?? 'this milestone'
  if (level === 'PROJECT') return scope.projectName
  return scope.teamName
}

/**
 * Resolve the class, narrowest layer first, fetching only the layers actually
 * needed. `selectReferenceClass` already walks MILESTONE → PROJECT → TEAM in
 * that fixed order and skips a `null` layer, so asking it about the milestone
 * alone and escalating on INSUFFICIENT yields exactly what handing it all three
 * at once would — the broader layers simply are not read when a narrower one
 * already decides.
 *
 * Shape (one await, then a pair) rather than three serial awaits: the milestone
 * layer is the common case and pays a single round trip, while the fallback
 * still costs at most two — where a fully serial walk would put three on
 * session-start's ~3s budget every time a milestone is too small to qualify.
 */
async function resolveClass(
  taskId: string,
  scope: TaskScope
): Promise<ReferenceClass> {
  if (scope.milestoneId) {
    const milestone = await referenceClassRepository.deliveredByMilestone(
      scope.milestoneId,
      MAX_CLASS_SIZE + 1
    )
    const fromMilestone = selectReferenceClass(
      { milestone, project: null, team: null },
      taskId
    )
    if (fromMilestone.kind === 'SELECTED') return fromMilestone
  }

  const [project, team] = await Promise.all([
    referenceClassRepository.deliveredByProject(
      scope.projectId,
      MAX_CLASS_SIZE + 1
    ),
    referenceClassRepository.deliveredByTeam(scope.teamId, MAX_CLASS_SIZE + 1),
  ])
  return selectReferenceClass({ milestone: null, project, team }, taskId)
}

async function build(taskId: string): Promise<string> {
  const scope = await referenceClassRepository.taskScope(taskId)
  if (!scope) return ''

  const selected = await resolveClass(taskId, scope)
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
    const mapped = criterionChangeFromPayload(row.payload, row.createdAt)
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

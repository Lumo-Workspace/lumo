/**
 * LUM-1279 — flat view models for the attention-first Sprint detail page.
 *
 * Pure mappers over the LUM-1278 attention DTO: they only count and join what
 * the server already computed (product ruling, option A) — no new facts are
 * derived here. Presentational components take these flat shapes, never the
 * nested DTO (LoD).
 */
import type {
  SprintAttentionQueueItemDto,
  SprintAttentionQueueKind,
  SprintAttentionResponse,
  SprintAttentionSecurityTrust,
  SprintAttentionStageDto,
  SprintAttentionTaskDto,
} from '@/lib/api-client/sprints'

// ─── Stage cards ────────────────────────────────────────────────────────────

export interface StageCardsModel {
  inProgress: { count: number; medianDwellSec: number | null }
  inReview: {
    count: number
    medianDwellSec: number | null
    prReviews: number
    crossingRulings: number
  }
  /** DONE but not verified (the server's `verified` flag). */
  awaitingVerification: { count: number; missingTc: number }
  verified: { count: number; total: number; notStarted: number }
}

function stage(stages: SprintAttentionStageDto[], key: string) {
  return stages.find(s => s.key === key) ?? null
}

/**
 * The four stage cards. `teamQueue` must be the team-scope queue: the
 * review card's footnote counts every PR / crossing wait, not just mine.
 */
export function buildStageCards(
  attention: Pick<SprintAttentionResponse, 'stages' | 'tasks'>,
  teamQueue: Pick<SprintAttentionQueueItemDto, 'kind'>[]
): StageCardsModel {
  const inProgress = stage(attention.stages, 'IN_PROGRESS')
  const inReview = stage(attention.stages, 'IN_REVIEW')
  const notStarted =
    (stage(attention.stages, 'BACKLOG')?.count ?? 0) +
    (stage(attention.stages, 'TODO')?.count ?? 0)

  let awaiting = 0
  let missingTc = 0
  let verified = 0
  for (const t of attention.tasks) {
    if (t.verified) verified++
    else if (t.status === 'DONE') {
      awaiting++
      if (t.trust.testsTotal === 0) missingTc++
    }
  }

  return {
    inProgress: {
      count: inProgress?.count ?? 0,
      medianDwellSec: inProgress?.medianDwellSec ?? null,
    },
    inReview: {
      count: inReview?.count ?? 0,
      medianDwellSec: inReview?.medianDwellSec ?? null,
      prReviews: teamQueue.filter(q => q.kind === 'prReview').length,
      crossingRulings: teamQueue.filter(q => q.kind === 'crossingRuling')
        .length,
    },
    awaitingVerification: { count: awaiting, missingTc },
    verified: { count: verified, total: attention.tasks.length, notStarted },
  }
}

// ─── Awaiting-people queue ──────────────────────────────────────────────────

export interface QueueRow {
  key: string
  kind: SprintAttentionQueueKind
  taskId: string
  identifier: string
  title: string
  /** The task owner (assignee) — never a guessed reviewer. */
  ownerName: string | null
  waitingSec: number
  prNumber: number | null
  prUrl: string | null
  crossingCategory: string | null
  testsPassing: number | null
  testsTotal: number | null
}

export function toQueueRows(
  queue: SprintAttentionQueueItemDto[],
  tasks: SprintAttentionTaskDto[]
): QueueRow[] {
  const byId = new Map(tasks.map(t => [t.taskId, t]))
  return queue.map(q => {
    const task = byId.get(q.taskId)
    const pr = q.kind === 'prReview' ? q.pr : null
    const crossing = q.kind === 'crossingRuling' ? q.crossing : null
    return {
      key: `${q.kind}:${q.taskId}:${pr?.number ?? crossing?.id ?? ''}`,
      kind: q.kind,
      taskId: q.taskId,
      identifier: q.identifier,
      title: q.title,
      ownerName: q.assignee?.name ?? null,
      waitingSec: q.waitingSec,
      prNumber: pr?.number ?? null,
      prUrl: pr?.url ?? null,
      crossingCategory: crossing?.category ?? null,
      testsPassing: task ? task.trust.testsPassing : null,
      testsTotal: task ? task.trust.testsTotal : null,
    }
  })
}

export interface QueueKindSummary {
  kind: SprintAttentionQueueKind
  count: number
  /** Longest wait of the kind; null when the kind is empty. */
  oldestSec: number | null
}

const KIND_ORDER: SprintAttentionQueueKind[] = [
  'prReview',
  'crossingRuling',
  'doneConfirmation',
]

/** Count + longest wait per queue kind, in a fixed order. */
export function summarizeQueueKinds(
  rows: Pick<QueueRow, 'kind' | 'waitingSec'>[]
): QueueKindSummary[] {
  return KIND_ORDER.map(kind => {
    const ofKind = rows.filter(r => r.kind === kind)
    return {
      kind,
      count: ofKind.length,
      oldestSec: ofKind.length
        ? Math.max(...ofKind.map(r => r.waitingSec))
        : null,
    }
  })
}

// ─── Task table ─────────────────────────────────────────────────────────────

export interface TaskTrust {
  testsPassing: number
  testsTotal: number
  testsFresh: number
  crossingsBlocking: number
  security: SprintAttentionSecurityTrust
}

export interface TaskRow extends TaskTrust {
  taskId: string
  identifier: string
  title: string
  status: SprintAttentionTaskDto['status']
  verified: boolean
  waitingOn: SprintAttentionQueueKind | null
  /** How long the `waitingOn` entry has waited; null when not queued. */
  waitingSec: number | null
  confirmedByName: string | null
}

export function toTaskRows(
  tasks: SprintAttentionTaskDto[],
  teamQueue: Pick<
    SprintAttentionQueueItemDto,
    'taskId' | 'kind' | 'waitingSec'
  >[]
): TaskRow[] {
  return tasks.map(t => {
    const entry = t.waitingOn
      ? teamQueue.find(q => q.taskId === t.taskId && q.kind === t.waitingOn)
      : undefined
    return {
      taskId: t.taskId,
      identifier: t.identifier,
      title: t.title,
      status: t.status,
      verified: t.verified,
      testsPassing: t.trust.testsPassing,
      testsTotal: t.trust.testsTotal,
      testsFresh: t.trust.testsFresh,
      crossingsBlocking: t.trust.crossingsBlocking,
      security: t.trust.security,
      waitingOn: t.waitingOn,
      waitingSec: entry?.waitingSec ?? null,
      confirmedByName: t.confirmedBy?.name ?? null,
    }
  })
}

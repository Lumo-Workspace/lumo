/**
 * LUM-945 — AI triage of boundary crossings: the orchestration half.
 *
 * The rule detectors keep recording every crossing (recall stays with the
 * rules). This sweep then asks one question per OPEN, untriaged row — "given
 * the task, is this legitimate?" — and, when P(legit) reaches the threshold,
 * stamps the system disposition AUTO_LEGIT: out of the open queue, no longer
 * blocking DONE, no human actor, never counted as a human false positive.
 * Below the threshold the score is recorded and the row stays OPEN.
 *
 * What it will not do:
 *   - call a model for a workspace that turned AI review off (the row is left
 *     untriaged and picked up once the switch is back on);
 *   - judge a row with no task, purged evidence, or an evasion marker — those
 *     are stamped "not judged" and stay OPEN for a human;
 *   - overwrite a ruling that landed in between — the write's WHERE requires
 *     an OPEN untriaged row, and a 0-row update leaves no trail;
 *   - keep auto-clearing a category humans keep overturning (auto-pause);
 *   - fail loudly — a model error leaves the row untriaged for the next pass.
 *
 * The model (TypeSafe Jev) has no zero-data-retention endpoint; the user
 * accepted that on LUM-945 and the privacy sources say so.
 */
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { loadSecurityLayers } from '@/lib/services/security-workspace-switches.service'
import { CROSSING_TRIAGE_MODEL } from '@/lib/ai/models'
import { evaluateBoolean } from '@/lib/ai/evaluation'
import { logger } from '@/lib/logger'
import {
  PAUSE_WINDOW_DAYS,
  TRIAGE_CRITERIA,
  TRIAGE_INSTRUCTIONS,
  TRIAGE_THRESHOLD,
  buildTriageState,
  pausedCategories,
  shouldAutoClear,
  triageSkipReason,
  type CategoryClearStats,
} from '@/lib/boundary-crossing/triage'

const DEFAULT_LIMIT = 100
const TIMEOUT_MS = 15_000

type Candidate = Awaited<
  ReturnType<typeof boundaryCrossingRepository.findTriageCandidates>
>[number]

export interface TriageDeps {
  findCandidates: (take: number) => Promise<Candidate[]>
  clearCounts: (
    since: Date,
    threshold: number
  ) => Promise<
    { category: string; disposition: string | null; _count: { _all: number } }[]
  >
  isAiReviewOn: (workspaceId: string) => Promise<boolean>
  score: (state: string) => Promise<number>
  recordTriage: typeof boundaryCrossingRepository.recordTriage
  markSkipped: typeof boundaryCrossingRepository.markTriageSkipped
  recordActivity: (input: {
    taskId: string
    crossingId: string
    category: string
    probability: number
  }) => Promise<void>
  model: string
  threshold: number
}

export interface TriageSummary {
  candidates: number
  scored: number
  autoCleared: number
  skipped: number
  aiReviewOff: number
  errors: number
  pausedCategories: string[]
}

/** Fold the grouped counts into per-category auto-clear / overturn stats. */
export function toClearStats(
  rows: {
    category: string
    disposition: string | null
    _count: { _all: number }
  }[]
): CategoryClearStats[] {
  const byCategory = new Map<string, CategoryClearStats>()
  for (const r of rows) {
    const s = byCategory.get(r.category) ?? {
      category: r.category,
      autoCleared: 0,
      overturned: 0,
    }
    s.autoCleared += r._count._all
    if (r.disposition === 'CONFIRMED') s.overturned += r._count._all
    byCategory.set(r.category, s)
  }
  return [...byCategory.values()]
}

export function createBoundaryCrossingTriageService(deps: TriageDeps) {
  return {
    async sweep(
      input: { limit?: number; now?: Date } = {}
    ): Promise<TriageSummary> {
      const now = input.now ?? new Date()
      const since = new Date(now.getTime() - PAUSE_WINDOW_DAYS * 86_400_000)
      const paused = pausedCategories(
        toClearStats(await deps.clearCounts(since, deps.threshold))
      )
      const rows = await deps.findCandidates(input.limit ?? DEFAULT_LIMIT)
      const summary: TriageSummary = {
        candidates: rows.length,
        scored: 0,
        autoCleared: 0,
        skipped: 0,
        aiReviewOff: 0,
        errors: 0,
        pausedCategories: [...paused].sort(),
      }
      const switches = new Map<string, boolean>()

      for (const row of rows) {
        try {
          if (triageSkipReason(row) !== null || !row.task) {
            await deps.markSkipped(row.id, now)
            summary.skipped += 1
            continue
          }
          const workspaceId = row.task.project.workspaceId
          if (!switches.has(workspaceId)) {
            switches.set(workspaceId, await deps.isAiReviewOn(workspaceId))
          }
          if (!switches.get(workspaceId)) {
            summary.aiReviewOff += 1
            continue
          }
          const probability = await deps.score(
            buildTriageState({
              category: row.category,
              severity: row.severity,
              reversible: row.reversible,
              detail: row.detail,
              target: row.target,
              policyRuleText: row.policyRuleText,
              task: {
                title: row.task.title,
                description: row.task.description,
              },
              agentStatements: row.explanations.map(e => e.note),
            })
          )
          const autoClear = shouldAutoClear(
            probability,
            paused.has(row.category),
            deps.threshold
          )
          const count = await deps.recordTriage(row.id, {
            probability,
            model: deps.model,
            autoClear,
            now,
          })
          if (count !== 1) continue
          summary.scored += 1
          if (autoClear && row.taskId) {
            summary.autoCleared += 1
            await deps.recordActivity({
              taskId: row.taskId,
              crossingId: row.id,
              category: row.category,
              probability,
            })
          }
        } catch (error) {
          summary.errors += 1
          logger.warn(
            `[crossing-triage] row ${row.id} (${row.category}) failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        }
      }
      return summary
    },
  }
}

export const boundaryCrossingTriageService =
  createBoundaryCrossingTriageService({
    findCandidates: take =>
      boundaryCrossingRepository.findTriageCandidates(take),
    clearCounts: (since, threshold) =>
      boundaryCrossingRepository.triageClearCounts(since, threshold),
    // Same switch as the code-rule judge and the claim check (LUM-892/901): the
    // triage sends crossing evidence to a model, so it is part of AI review.
    isAiReviewOn: async workspaceId =>
      (await loadSecurityLayers(workspaceId)).aiReview,
    score: async state =>
      (
        await evaluateBoolean({
          model: CROSSING_TRIAGE_MODEL,
          state,
          instructions: TRIAGE_INSTRUCTIONS,
          criteria: TRIAGE_CRITERIA,
          timeoutMs: TIMEOUT_MS,
        })
      ).probability,
    recordTriage: (id, input) =>
      boundaryCrossingRepository.recordTriage(id, input),
    markSkipped: (id, now) =>
      boundaryCrossingRepository.markTriageSkipped(id, now),
    // Same activity type and shape as a ruling, from null (OPEN) to AUTO_LEGIT,
    // channel SYSTEM and no actor — the timeline and the read model already fold
    // it; `triage` carries the score that made the call.
    recordActivity: async ({ taskId, crossingId, category, probability }) => {
      await activityRepository.create({
        taskId,
        actorId: null,
        type: 'BOUNDARY_CROSSING_DISPOSITIONED',
        payload: {
          boundaryCrossingId: crossingId,
          category,
          from: null,
          to: 'AUTO_LEGIT',
          disposition: 'AUTO_LEGIT',
          note: null,
          channel: 'SYSTEM',
          triage: {
            model: CROSSING_TRIAGE_MODEL,
            probability,
            threshold: TRIAGE_THRESHOLD,
          },
        },
      })
    },
    model: CROSSING_TRIAGE_MODEL,
    threshold: TRIAGE_THRESHOLD,
  })

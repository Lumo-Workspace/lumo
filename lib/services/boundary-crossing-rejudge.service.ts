/**
 * LUM-780 — the boundary-crossing re-judge: the exit path a crossing never
 * had. An OPEN blocking `POLICY_WEAKENING` / `TEST_FILE_DELETED` row is asked
 * the CURRENT detector's question against the CURRENT state, and when the
 * cause no longer holds the row becomes what the detector would write for
 * that evidence today — advisory: still OPEN, still on the panel, no longer
 * blocking DONE. The verdicts are pure (lib/boundary-crossing/rejudge-cause);
 * this service only feeds them state and applies the write.
 *
 * What it will never do:
 *   - write a disposition — rulings stay human-only; a re-judged row can
 *     still be ruled CONFIRMED / FALSE_POSITIVE by a person;
 *   - touch a row it cannot decide — UNDECIDABLE and STILL_HOLDS write
 *     nothing; a HIGH evasion row is never re-judged;
 *   - overwrite a ruling that landed in between — the write's WHERE is the
 *     gate predicate, a 0-row update leaves no trail;
 *   - batch anything — one verdict, one reason, one evidence line per row,
 *     appended as a BOUNDARY_CROSSING_REJUDGED activity (channel SYSTEM).
 *
 * Three entry points, one pass: the policy recompile (source already in
 * hand), the PR-close webhook (the task's TEST_FILE_DELETED rows), and the
 * hourly cron / dry-run script (`sweep`: everything, capped).
 */
import type { BoundaryCrossingCategory } from '@prisma/client'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { logger } from '@/lib/logger'
import { policyRuleSource } from '@/lib/plugins/crossings'
import {
  REJUDGEABLE_CATEGORIES,
  isRejudgeableCategory,
  rejudgePolicyWeakening,
  rejudgeTestFileDeleted,
  type PrFileList,
  type RejudgeOutcome,
  type RejudgeReason,
  type RejudgeVerdict,
} from '@/lib/boundary-crossing/rejudge-cause'

/** One row's outcome on this pass. */
export interface RejudgeDecision {
  id: string
  taskId: string | null
  category: string
  outcome: RejudgeOutcome
  reason: RejudgeReason
  evidence: string
  criterionVersion: string
  /** True only when the advisory write landed (count 1) and left its trail. */
  written: boolean
}

export interface RejudgeSummary {
  judged: number
  downgraded: number
  stillHolds: number
  undecidable: number
  errors: number
  byReason: Record<string, number>
  decisions: RejudgeDecision[]
}

/** Reads the project's CLAUDE.md + AGENTS.md source; null = unreadable. */
export type PolicySourceReader = (input: {
  projectId: string
  workspaceId: string
  fullName: string
}) => Promise<string | null>

type Row = Awaited<
  ReturnType<typeof boundaryCrossingRepository.findOpenBlockingRejudgeable>
>[number]

interface PassContext {
  now: Date
  dryRun: boolean
  /** Source text per project; `undefined` = not yet read. */
  sources: Map<string, string | null>
  readSource: PolicySourceReader
  /** PR file lists per task. */
  prLists: Map<string, PrFileList[]>
}

const DEFAULT_SWEEP_LIMIT = 200

function emptySummary(): RejudgeSummary {
  return {
    judged: 0,
    downgraded: 0,
    stillHolds: 0,
    undecidable: 0,
    errors: 0,
    byReason: {},
    decisions: [],
  }
}

/**
 * The policy rule source's reader (the security plugin's: the compiler's own,
 * cached, installation token). LUM-1063: the rules are a plugin's, the
 * re-judge is the core's — with no source installed the text cannot be read
 * and a POLICY_WEAKENING row is UNDECIDABLE (nothing is written).
 */
const defaultReadSource: PolicySourceReader = async input => {
  const source = policyRuleSource()
  return source ? source.readSource(input) : null
}

/** A stored rule's text by ref (rows written before the text was stamped). */
async function ruleTextByRef(
  projectId: string,
  ruleRef: string
): Promise<string | null> {
  const source = policyRuleSource()
  return source ? source.ruleTextByRef(projectId, ruleRef) : null
}

async function sourceFor(row: Row, ctx: PassContext): Promise<string | null> {
  const projectId = row.task?.projectId
  const workspaceId = row.task?.project?.workspaceId
  if (!projectId || !workspaceId) return null
  if (ctx.sources.has(projectId)) return ctx.sources.get(projectId) ?? null
  let source: string | null = null
  try {
    const repo = await projectRepository.findDefaultRepository(projectId)
    source = repo
      ? await ctx.readSource({
          projectId,
          workspaceId,
          fullName: repo.fullName,
        })
      : null
  } catch (error) {
    logger.warn(
      `[crossing-rejudge] policy source unreadable for project ${projectId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    source = null
  }
  ctx.sources.set(projectId, source)
  return source
}

async function prListsFor(
  taskId: string,
  ctx: PassContext
): Promise<PrFileList[]> {
  const cached = ctx.prLists.get(taskId)
  if (cached) return cached
  const prs = await pullRequestRepository.listRepoAndNumberByTask(taskId)
  // Lazy: the contents module drags the installation-token client in.
  const { fetchPrFiles } = await import('@/lib/integrations/github/contents')
  const lists: PrFileList[] = []
  for (const pr of prs) {
    try {
      const files = await fetchPrFiles({
        workspaceId: pr.workspaceId,
        fullName: pr.repo,
        prNumber: pr.number,
      })
      lists.push({ number: pr.number, files })
    } catch (error) {
      logger.warn(
        `[crossing-rejudge] PR files unreadable for ${pr.repo}#${pr.number}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      lists.push({ number: pr.number, files: null })
    }
  }
  ctx.prLists.set(taskId, lists)
  return lists
}

async function judge(row: Row, ctx: PassContext): Promise<RejudgeVerdict> {
  switch (row.category) {
    case 'POLICY_WEAKENING': {
      const projectId = row.task?.projectId ?? null
      const text =
        row.policyRuleText ??
        (row.policyRuleRef && projectId
          ? await ruleTextByRef(projectId, row.policyRuleRef)
          : null)
      const source = await sourceFor(row, ctx)
      return rejudgePolicyWeakening(
        { detail: row.detail, policyRuleText: text },
        source
      )
    }
    case 'TEST_FILE_DELETED': {
      const prs = row.taskId ? await prListsFor(row.taskId, ctx) : []
      return rejudgeTestFileDeleted(
        { detail: row.detail, severity: row.severity },
        prs
      )
    }
    default:
      throw new Error(`category ${row.category} is not re-judgeable`)
  }
}

/** Apply a CAUSE_GONE verdict: guarded write, trail only on a real flip. */
async function apply(
  row: Row,
  verdict: RejudgeVerdict,
  ctx: PassContext
): Promise<boolean> {
  if (verdict.outcome !== 'CAUSE_GONE' || !verdict.write || ctx.dryRun) {
    return false
  }
  const count = await boundaryCrossingRepository.downgradeToAdvisory(row.id, {
    severity: verdict.write.severity,
    detail: verdict.write.detail,
    now: ctx.now,
  })
  if (count !== 1) return false
  if (row.taskId) {
    await activityRepository.create({
      taskId: row.taskId,
      actorId: null,
      type: 'BOUNDARY_CROSSING_REJUDGED',
      payload: {
        boundaryCrossingId: row.id,
        category: row.category,
        from: { severity: row.severity, advisory: false },
        to: { severity: verdict.write.severity, advisory: true },
        reason: verdict.reason,
        evidence: verdict.evidence,
        criterionVersion: verdict.criterionVersion,
        channel: 'SYSTEM',
      },
    })
  }
  return true
}

async function runPass(rows: Row[], ctx: PassContext): Promise<RejudgeSummary> {
  const summary = emptySummary()
  for (const row of rows) {
    if (!isRejudgeableCategory(row.category)) continue
    try {
      const verdict = await judge(row, ctx)
      const written = await apply(row, verdict, ctx)
      summary.judged += 1
      summary.byReason[verdict.reason] =
        (summary.byReason[verdict.reason] ?? 0) + 1
      if (verdict.outcome === 'STILL_HOLDS') summary.stillHolds += 1
      else if (verdict.outcome === 'UNDECIDABLE') summary.undecidable += 1
      if (written) summary.downgraded += 1
      summary.decisions.push({
        id: row.id,
        taskId: row.taskId,
        category: row.category,
        outcome: verdict.outcome,
        reason: verdict.reason,
        evidence: verdict.evidence,
        criterionVersion: verdict.criterionVersion,
        written,
      })
    } catch (error) {
      summary.errors += 1
      logger.warn(
        `[crossing-rejudge] row ${row.id} (${row.category}) failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }
  return summary
}

function newContext(input: {
  dryRun?: boolean
  readSource?: PolicySourceReader
  now?: Date
}): PassContext {
  return {
    now: input.now ?? new Date(),
    dryRun: input.dryRun ?? false,
    sources: new Map(),
    readSource: input.readSource ?? defaultReadSource,
    prLists: new Map(),
  }
}

export const boundaryCrossingRejudgeService = {
  /**
   * After a policy (re)compile: the project's OPEN blocking POLICY_WEAKENING
   * rows against the source the compiler just read — the moment "is the text
   * still in the file" has a fresh answer, and no extra GitHub read.
   */
  async rejudgePolicyWeakeningForProject(input: {
    projectId: string
    source: string
    limit?: number
  }): Promise<RejudgeSummary> {
    const rows = await boundaryCrossingRepository.findOpenBlockingRejudgeable({
      categories: ['POLICY_WEAKENING'],
      projectId: input.projectId,
      take: input.limit ?? DEFAULT_SWEEP_LIMIT,
    })
    const ctx = newContext({})
    ctx.sources.set(input.projectId, input.source)
    return runPass(rows, ctx)
  },

  /**
   * After a PR closes (merged or not): the task's OPEN blocking
   * TEST_FILE_DELETED rows against every linked PR's file list — the review
   * window just closed, so "did the deletion land anywhere" is answerable.
   */
  async rejudgeTestFileDeletedForTask(
    taskId: string,
    input: { limit?: number } = {}
  ): Promise<RejudgeSummary> {
    const rows = await boundaryCrossingRepository.findOpenBlockingRejudgeable({
      categories: ['TEST_FILE_DELETED'],
      taskId,
      take: input.limit ?? DEFAULT_SWEEP_LIMIT,
    })
    return runPass(rows, newContext({}))
  },

  /**
   * The hourly cron and the dry-run script: every OPEN blocking row of the
   * re-judgeable categories, oldest first, capped. Per-row fail-soft; the
   * summary says how many were judged, downgraded, still hold, could not be
   * decided, or errored — and why, per reason.
   */
  async sweep(
    input: {
      limit?: number
      dryRun?: boolean
      readSource?: PolicySourceReader
      categories?: BoundaryCrossingCategory[]
      now?: Date
    } = {}
  ): Promise<RejudgeSummary> {
    const rows = await boundaryCrossingRepository.findOpenBlockingRejudgeable({
      categories: input.categories ?? [...REJUDGEABLE_CATEGORIES],
      take: input.limit ?? DEFAULT_SWEEP_LIMIT,
    })
    return runPass(rows, newContext(input))
  },
}

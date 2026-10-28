/**
 * LUM-1234 — the reward-hack layer ("Agent behavior") of the PR security
 * scan. Started by stage A once its own result is persisted
 * (`stages.rewardHack = PENDING`), it judges the agent sessions behind the
 * PR's task for gamed tests / metrics / checks, and writes advisory findings
 * only (`LLM_JUDGE`, `MEDIUM` — never blocking).
 *
 * Flow: scan + PR + workspace switches → the task's sessions inside this PR's
 * window that edit a file the PR changes → reuse the previous scan's verdict
 * when the sessions have not moved on → the monthly spend ceiling → the
 * judge and the evidence / diff gates (every gated item is reported; the
 * refute call was removed by user ruling 2026-10-22) → findings, state →
 * stage → the PR summary. The judge call's estimated cost is charged to the
 * monthly ledger BEFORE it is made and settled to its reported cost after, so
 * the cap holds even for a run the platform kills mid-call.
 *
 * The reuse cache is keyed on the session watermark (sessionId → last
 * in-window event) and the prompt version: a human commit on its own does
 * not re-judge, but every reused row is re-checked against the current diff.
 *
 * Every write is ONE compare-and-set on the run token (the scan's
 * `startedAt` when stage A started this runner) while the layer is PENDING,
 * so a runner outlived by a restart or by the stale sweep writes nothing.
 *
 * Never throws: any failure is stamped FAILED, and the PR summary is synced
 * whatever the outcome. Model text never reaches a row unredacted, and the
 * evidence column holds event ids only (never transcript text).
 */
import { logger } from '@/lib/logger'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import {
  gitProviderFor,
  type GitProviderRef,
} from '@/lib/integrations/git-provider/resolve'
import {
  prSecurityScanRepository,
  type NewFindingInput,
} from '@/ee/security/repositories/pr-security-scan.repository'
import { rewardHackInputRepository } from '@/ee/security/repositories/reward-hack-input.repository'
import { workspaceLlmSpendRepository } from '@/ee/security/repositories/workspace-llm-spend.repository'
import { loadSecurityLayers } from './security-workspace-switches.service'
import { rewardHackMonthlyCapUsd } from './security-reward-hack.config'
// No LLM/gateway import inside — safe to import statically.
import { securityPrReviewService } from './security-pr-review.service'
import {
  rhWatermark,
  selectSessionsForPr,
  type RhPrFile,
  type RhSession,
} from '@/ee/security/security-scan/reward-hack-input'
import { citedEditsInPr } from '@/ee/security/security-scan/reward-hack-gates'
import { settledRhCallUsd } from '@/ee/security/security-scan/reward-hack-cost'
import { rhDecisionLogLine } from '@/ee/security/security-scan/reward-hack-log'
import { REWARD_HACK_VERSION } from '@/ee/security/security-scan/reward-hack-prompts'
import {
  buildRhDiffView,
  decideRewardHack,
  type RhCallCost,
  type RhJudgeFn,
  type RhSpendGate,
  rewardHackFindingRow,
  uniqueByFingerprint,
} from '@/ee/security/security-scan/reward-hack-decide'
import { inheritDispositions } from '@/ee/security/security-scan/inherit-dispositions'
import {
  parseRewardHackState,
  sameWatermark,
  type RewardHackState,
} from '@/ee/security/security-scan/reward-hack-state'
import type { PartialCause } from '@/shared/src/security-scan'

export type { RewardHackState }
// The caps and the row mapping live with the decision core; re-exported for
// existing callers.
export {
  REWARD_HACK_MAX_INPUT_CHARS,
  rewardHackFindingRow,
  rewardHackFingerprint,
} from '@/ee/security/security-scan/reward-hack-decide'

export interface RhDeps {
  judge: RhJudgeFn
  /** The PR's changed files (path + hunks) at its head. Throws when unreadable. */
  listPrFiles: (
    pr: {
      workspaceId: string
      repo: string
      number: number
    } & GitProviderRef
  ) => Promise<RhPrFile[]>
  now: () => Date
}

// Dynamic imports: the judge client loads the AI SDK, which must stay out of
// static import graphs (and jest's module traps).
const defaultDeps: RhDeps = {
  async judge(prompt) {
    const { judgeRewardHack } =
      await import('@/ee/security/llm/reward-hack-judge-client')
    return judgeRewardHack(prompt)
  },
  async listPrFiles(pr) {
    const files = await gitProviderFor(pr).fetchPrFiles({
      workspaceId: pr.workspaceId,
      fullName: pr.repo,
      prNumber: pr.number,
    })
    return files.map(f => ({
      filename: f.filename,
      patch: f.patch ?? null,
      status: f.status,
    }))
  },
  now: () => new Date(),
}

interface StageOutcome {
  state: 'RAN' | 'PARTIAL' | 'SKIPPED' | 'FAILED' | 'DISABLED'
  causes: PartialCause[]
  findings?: NewFindingInput[]
  verdictState?: RewardHackState
}

/** Which run this is: the token every write is compared against. */
interface RunContext {
  scanId: string
  runToken: Date | null
}

async function settle(ctx: RunContext, outcome: StageOutcome): Promise<void> {
  if (!ctx.runToken) return
  const landed = await prSecurityScanRepository.persistRewardHackResult(
    ctx.scanId,
    ctx.runToken,
    {
      findings: outcome.findings ?? [],
      stage: outcome.state,
      partialCauses: outcome.causes,
      ...(outcome.verdictState ? { state: outcome.verdictState } : {}),
    }
  )
  if (!landed)
    logger.info(
      `[reward-hack] stale run, write dropped scan=${ctx.scanId} stage=${outcome.state}`
    )
}

async function runLayer(ctx: RunContext, deps: RhDeps): Promise<void> {
  const scanId = ctx.scanId
  const scan = await prSecurityScanRepository.findForRewardHack(scanId)
  if (!scan) {
    logger.warn(`[reward-hack] scan not found scan=${scanId}`)
    return
  }
  ctx.runToken = ctx.runToken ?? scan.startedAt
  if (ctx.runToken.getTime() !== scan.startedAt.getTime()) {
    // Restarted since this runner was started: the newer run owns the layer.
    logger.info(`[reward-hack] scan restarted, run dropped scan=${scanId}`)
    return
  }
  const pr = await pullRequestRepository.findById(scan.pullRequestId)
  if (!pr) return settle(ctx, { state: 'SKIPPED', causes: [] })
  const layers = await loadSecurityLayers(scan.workspaceId)
  if (!layers.rewardHack)
    // Switched off while the scan ran: the customer's choice is told as
    // such; a platform switch turned off mid-run just stops the layer.
    return settle(ctx, {
      state: layers.rewardHackTurnedOff ? 'DISABLED' : 'SKIPPED',
      causes: [],
    })
  const taskId = pr.taskId
  if (!taskId) return settle(ctx, { state: 'SKIPPED', causes: [] })
  const workspaceId = scan.workspaceId

  // Never "nothing found" on a file list we could not read: FAILED.
  const prFileList = await deps.listPrFiles({
    workspaceId,
    repo: pr.repo,
    number: pr.number,
  })
  const prFiles = prFileList.map(f => f.filename)

  const sessions = await rewardHackInputRepository.loadTaskSessions(
    workspaceId,
    taskId
  )
  // The window opens at the task's previous merge before THIS PR opened (a
  // sibling PR merged meanwhile does not move it) and ends at this scan.
  const windowStart = await rewardHackInputRepository.previousMergedAt(
    workspaceId,
    taskId,
    pr.id,
    pr.createdAt ?? scan.startedAt
  )
  const selected = selectSessionsForPr({
    sessions,
    windowStart,
    windowEnd: scan.startedAt,
    prFiles,
  })
  const pruned =
    selected.excludedPruned.length > 0 || selected.partiallyPruned.length > 0
  const prunedCauses: PartialCause[] = pruned ? ['REWARD_HACK_PRUNED'] : []
  if (selected.included.length === 0)
    logger.info(
      rhDecisionLogLine({
        scanId,
        windowStart,
        windowEnd: scan.startedAt,
        sessions: sessions.length,
        included: [],
        prompt: null,
        truncated: false,
        outcome: pruned ? 'pruned' : 'no-session',
      })
    )
  if (selected.included.length === 0)
    // No session behind this PR is SKIPPED — unless pruning may have taken
    // it: an empty transcript is never read as "nothing found".
    return settle(
      ctx,
      pruned
        ? { state: 'PARTIAL', causes: prunedCauses }
        : { state: 'SKIPPED', causes: [] }
    )

  const watermark = rhWatermark(selected.included)
  // What the final diff says about every write the sessions made: a cited
  // edit the PR no longer carries (corrected later) is not reported.
  const diffView = buildRhDiffView(selected.included, prFileList)
  const prior = await prSecurityScanRepository.findDispositionedByPullRequest(
    pr.id
  )

  // Nothing new since the previous verdict: reuse it, no model call.
  const previous = await prSecurityScanRepository.findPreviousScanForPr(
    pr.id,
    scanId,
    scan.startedAt
  )
  const previousState = parseRewardHackState(previous?.rewardHackState)
  // A verdict from another prompt / threshold version is never reused.
  if (
    previous &&
    previousState &&
    previousState.version === REWARD_HACK_VERSION &&
    sameWatermark(previousState.watermark, watermark)
  ) {
    const copied = (
      await prSecurityScanRepository.findRewardHackFindings(previous.id)
    )
      // A cited edit no longer in the PR (a later commit corrected it) is
      // dropped, as the gates would drop it — judged on the current diff.
      .filter(f => citedEditsInPr(evidenceEventIds(f.evidence), diffView))
      .map(
        (f): NewFindingInput => ({
          ...f,
          scanId,
          externalRef: null,
          disposition: null,
        })
      )
    const rows = inheritDispositions(uniqueByFingerprint(copied), prior)
    const causes: PartialCause[] = [
      ...(previousState.truncated ? (['REWARD_HACK_INPUT_CAP'] as const) : []),
      ...prunedCauses,
    ]
    return settle(ctx, {
      state: causes.length > 0 ? 'PARTIAL' : 'RAN',
      causes,
      findings: rows,
      verdictState: {
        version: REWARD_HACK_VERSION,
        watermark,
        findingFingerprints: rows.map(r => r.fingerprint),
        costUsd: 0,
        truncated: previousState.truncated,
      },
    })
  }

  // Our monthly ceiling, checked before any call: told as not checked.
  const now = deps.now()
  const cap = rewardHackMonthlyCapUsd()
  const spent = await workspaceLlmSpendRepository.monthSpendUsd(
    workspaceId,
    'reward_hack',
    now
  )
  const capped: StageOutcome = {
    state: 'PARTIAL',
    causes: ['REWARD_HACK_MONTHLY_CAP', ...prunedCauses],
  }
  if (spent >= cap) return settle(ctx, capped)

  const requirement = await rewardHackInputRepository.loadRequirement(
    workspaceId,
    taskId
  )
  const ledger = new SpendLedger(workspaceId, cap, now)
  // Judge → gates: the shared core (also run by the offline calibration).
  // It reserves the judge call's estimate on the ledger first.
  const decision = await decideRewardHack({
    sessions: selected.included,
    prFileList,
    requirement,
    judge: deps.judge,
    spend: ledger,
    diffView,
  })
  logger.info(
    rhDecisionLogLine({
      scanId,
      windowStart,
      windowEnd: scan.startedAt,
      sessions: sessions.length,
      included: selected.included,
      prompt: decision.built.prompt,
      truncated: decision.built.truncated,
      requirementTruncated: decision.built.requirementTruncated,
      outcome: decision.outcome,
      ...('judged' in decision
        ? {
            suspicion: decision.judged.output.suspicion,
            items: decision.judged.output.items.length,
            gated: decision.gated.length,
          }
        : {}),
    })
  )
  if (decision.outcome === 'overCap')
    // Even the markers do not fit (or the text is token-dense past our
    // per-call cap): nothing is sent to the model.
    return settle(ctx, {
      state: 'PARTIAL',
      causes: ['REWARD_HACK_INPUT_CAP', ...prunedCauses],
    })
  // No room left for the judge: told as not checked.
  if (decision.outcome === 'capped') return settle(ctx, capped)
  // Every item past the threshold, evidence and diff gates is reported.
  const { built, gated } = decision
  const costUsd = Math.round(ledger.bookedUsd * 1e6) / 1e6

  const eventSession = sessionOfEvent(selected.included)
  const rows = inheritDispositions(
    uniqueByFingerprint(
      gated.map(item =>
        rewardHackFindingRow({
          scanId,
          item,
          eventFile: diffView.eventFile,
          eventSession,
          prFiles,
        })
      )
    ),
    prior
  )
  const causes: PartialCause[] = [
    ...(built.truncated ? (['REWARD_HACK_INPUT_CAP'] as const) : []),
    ...prunedCauses,
  ]
  return settle(ctx, {
    state: causes.length > 0 ? 'PARTIAL' : 'RAN',
    causes,
    findings: rows,
    verdictState: {
      version: REWARD_HACK_VERSION,
      watermark,
      findingFingerprints: rows.map(r => r.fingerprint),
      costUsd,
      truncated: built.truncated,
    },
  })
}

/**
 * One run's charges against the workspace's monthly ledger: estimates are
 * reserved before a call and settled to its real cost after.
 */
class SpendLedger implements RhSpendGate {
  /** What this run has booked so far (estimates of unsettled calls included). */
  bookedUsd = 0

  constructor(
    private readonly workspaceId: string,
    private readonly capUsd: number,
    private readonly now: Date
  ) {}

  /**
   * Charge `usd` up front. False (and nothing charged) when the month was
   * already at the cap before this charge — a concurrent run got there first.
   */
  async reserve(usd: number): Promise<boolean> {
    const total = await workspaceLlmSpendRepository.addSpendUsd(
      this.workspaceId,
      'reward_hack',
      usd,
      this.now
    )
    if (total !== null && total - usd >= this.capUsd) {
      await workspaceLlmSpendRepository.refundSpendUsd(
        this.workspaceId,
        'reward_hack',
        usd,
        this.now
      )
      return false
    }
    this.bookedUsd += usd
    return true
  }

  /** Replace a reserved estimate by the call's settled cost. */
  async settle(estimateUsd: number, reported: RhCallCost): Promise<void> {
    const actual = settledRhCallUsd(reported, estimateUsd)
    const delta = actual - estimateUsd
    if (delta > 0)
      await workspaceLlmSpendRepository.addSpendUsd(
        this.workspaceId,
        'reward_hack',
        delta,
        this.now
      )
    else if (delta < 0)
      await workspaceLlmSpendRepository.refundSpendUsd(
        this.workspaceId,
        'reward_hack',
        -delta,
        this.now
      )
    this.bookedUsd += delta
  }
}

/** The event ids a stored finding cites ([] when the column is malformed). */
function evidenceEventIds(evidence: string): string[] {
  try {
    const ids = (JSON.parse(evidence) as { eventIds?: unknown }).eventIds
    return Array.isArray(ids)
      ? ids.filter((x): x is string => typeof x === 'string')
      : []
  } catch {
    return []
  }
}

function sessionOfEvent(sessions: RhSession[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const s of sessions) for (const e of s.events) out.set(e.id, s.id)
  return out
}

/**
 * Run the reward-hack layer for one scan. Never throws: a failure is logged
 * and stamped FAILED, and the PR summary is synced in every case (sync is
 * idempotent — the summary updates when the verdict lands).
 */
export async function runRewardHackLayer(
  scanId: string,
  deps: Partial<RhDeps> = {},
  opts: {
    /** The scan's `startedAt` when stage A started this run (its token). */
    runToken?: Date
  } = {}
): Promise<void> {
  const d: RhDeps = { ...defaultDeps, ...deps }
  const ctx: RunContext = { scanId, runToken: opts.runToken ?? null }
  try {
    await runLayer(ctx, d)
  } catch (error) {
    logger.error(
      `[reward-hack] layer failed scan=${scanId}: ${error instanceof Error ? error.message : String(error)}`
    )
    try {
      // No token (the scan row could not even be read): left to the sweep.
      await settle(ctx, { state: 'FAILED', causes: [] })
    } catch (stampError) {
      logger.error(
        `[reward-hack] FAILED not stamped scan=${scanId}: ${stampError instanceof Error ? stampError.message : String(stampError)}`
      )
    }
  }
  try {
    await securityPrReviewService.sync(scanId)
  } catch (error) {
    logger.error(
      `[reward-hack] summary sync failed scan=${scanId}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

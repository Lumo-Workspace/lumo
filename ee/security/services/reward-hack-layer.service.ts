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
 * judge, the evidence gates, a refute call per item → findings, spend, state
 * → stage → the PR summary.
 *
 * The reuse cache is keyed on the session watermark only (sessionId → last
 * in-window event): a human commit on its own does not re-judge.
 *
 * Every write is ONE compare-and-set on the run token (the scan's
 * `startedAt` when stage A started this runner) while the layer is PENDING,
 * so a runner outlived by a restart or by the stale sweep writes nothing.
 *
 * Never throws: any failure is stamped FAILED, and the PR summary is synced
 * whatever the outcome. Model text never reaches a row unredacted, and the
 * evidence column holds event ids only (never transcript text).
 */
import { createHash } from 'node:crypto'
import { logger } from '@/lib/logger'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { fetchPrFiles } from '@/lib/integrations/github/contents'
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
  buildRhUserPrompt,
  pathMatchesPrFile,
  rhWatermark,
  selectSessionsForPr,
  type RhSession,
} from '@/ee/security/security-scan/reward-hack-input'
import { applyRhGates } from '@/ee/security/security-scan/reward-hack-gates'
import { redactFindingProse } from '@/ee/security/security-scan/finding-prose'
import { inheritDispositions } from '@/ee/security/security-scan/inherit-dispositions'
import {
  parseRewardHackState,
  sameWatermark,
  type RewardHackState,
} from '@/ee/security/security-scan/reward-hack-state'
import type {
  RhItem,
  RhJudgeOutput,
} from '@/ee/security/llm/reward-hack-judge-client'
import type { PartialCause } from '@/shared/src/security-scan'

export type { RewardHackState }

/** Our cap on one PR's judge input (characters); over it the input is cut. */
export const REWARD_HACK_MAX_INPUT_CHARS = 400_000

export interface RhDeps {
  judge: (
    prompt: string
  ) => Promise<{ output: RhJudgeOutput; costUsd: number | null }>
  refute: (args: {
    prompt: string
    item: RhItem
  }) => Promise<{ refuted: boolean; costUsd: number | null }>
  /** The PR's changed file paths at its head. Throws when unreadable. */
  listPrFiles: (pr: {
    workspaceId: string
    repo: string
    number: number
  }) => Promise<string[]>
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
  async refute(args) {
    const { refuteRewardHackItem } =
      await import('@/ee/security/llm/reward-hack-judge-client')
    return refuteRewardHackItem(args)
  },
  async listPrFiles(pr) {
    const files = await fetchPrFiles({
      workspaceId: pr.workspaceId,
      fullName: pr.repo,
      prNumber: pr.number,
    })
    return files.map(f => f.filename)
  },
  now: () => new Date(),
}

/** sha256 over the kind and the sorted cited event ids. */
export function rewardHackFingerprint(
  kind: string,
  eventIds: string[]
): string {
  return createHash('sha256')
    .update(['reward-hack', kind, ...[...eventIds].sort()].join('\n'))
    .digest('hex')
}

/**
 * The finding row for one surviving item. `filePath` is the PR file of the
 * first cited Write/Edit event (repo-relative, as the PR lists it), else ''.
 */
export function rewardHackFindingRow(args: {
  scanId: string
  item: RhItem
  eventFile: Map<string, string | null>
  eventSession: Map<string, string>
  prFiles: string[]
}): NewFindingInput {
  const { item } = args
  let filePath = ''
  for (const id of item.eventIds) {
    const abs = args.eventFile.get(id)
    if (!abs) continue
    const prFile = args.prFiles.find(f => pathMatchesPrFile(abs, f))
    if (prFile) {
      filePath = prFile
      break
    }
  }
  const sessionIds = [
    ...new Set(
      item.eventIds
        .map(id => args.eventSession.get(id))
        .filter((s): s is string => !!s)
    ),
  ]
  const prose = redactFindingProse(item.summary)
  return {
    scanId: args.scanId,
    kind: 'REWARD_HACK',
    ruleId: `reward-hack/${item.kind}`,
    severity: 'MEDIUM',
    provenance: 'LLM_JUDGE',
    filePath,
    line: null,
    title: prose,
    detail: prose,
    evidence: JSON.stringify({ eventIds: item.eventIds, sessionIds }),
    fingerprint: rewardHackFingerprint(item.kind, item.eventIds),
    externalRef: null,
    disposition: null,
  }
}

function uniqueByFingerprint(rows: NewFindingInput[]): NewFindingInput[] {
  const seen = new Set<string>()
  return rows.filter(r => {
    if (seen.has(r.fingerprint)) return false
    seen.add(r.fingerprint)
    return true
  })
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
  const prFiles = await deps.listPrFiles({
    workspaceId,
    repo: pr.repo,
    number: pr.number,
  })

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
    // No session behind this PR is SKIPPED — unless pruning may have taken
    // it: an empty transcript is never read as "nothing found".
    return settle(
      ctx,
      pruned
        ? { state: 'PARTIAL', causes: prunedCauses }
        : { state: 'SKIPPED', causes: [] }
    )

  const watermark = rhWatermark(selected.included)
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
  if (
    previous &&
    previousState &&
    sameWatermark(previousState.watermark, watermark)
  ) {
    const copied = (
      await prSecurityScanRepository.findRewardHackFindings(previous.id)
    )
      // A cited edit no longer in the PR (a later human commit) is dropped,
      // as the gates would drop it.
      .filter(
        f =>
          f.filePath === '' ||
          prFiles.some(p => pathMatchesPrFile(f.filePath, p))
      )
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
        watermark,
        findingFingerprints: rows.map(r => r.fingerprint),
        costUsd: 0,
        truncated: previousState.truncated,
      },
    })
  }

  // Our monthly ceiling, checked before any call: told as not checked.
  const now = deps.now()
  const spent = await workspaceLlmSpendRepository.monthSpendUsd(
    workspaceId,
    'reward_hack',
    now
  )
  if (spent >= rewardHackMonthlyCapUsd())
    return settle(ctx, {
      state: 'PARTIAL',
      causes: ['REWARD_HACK_MONTHLY_CAP', ...prunedCauses],
    })

  const requirement = await rewardHackInputRepository.loadRequirement(
    workspaceId,
    taskId
  )
  const built = buildRhUserPrompt({
    requirement,
    transcripts: selected.included.map(s => ({
      sessionId: s.id,
      events: s.events,
    })),
    maxChars: REWARD_HACK_MAX_INPUT_CHARS,
  })
  if (built.overCap)
    // Even the markers do not fit: nothing is sent to the model.
    return settle(ctx, {
      state: 'PARTIAL',
      causes: ['REWARD_HACK_INPUT_CAP', ...prunedCauses],
    })

  let costUsd = 0
  const kept: RhItem[] = []
  try {
    const judged = await deps.judge(built.prompt)
    costUsd += judged.costUsd ?? 0
    const items = applyRhGates({
      output: judged.output,
      promptEventIds: built.eventIds,
      eventFile: built.eventFile,
      prFiles,
    })
    for (const item of items) {
      const verdict = await deps.refute({ prompt: built.prompt, item })
      costUsd += verdict.costUsd ?? 0
      if (!verdict.refuted) kept.push(item)
    }
  } finally {
    // Spent is spent, even when a later call failed.
    if (costUsd > 0)
      await workspaceLlmSpendRepository.addSpendUsd(
        workspaceId,
        'reward_hack',
        costUsd,
        now
      )
  }

  const eventSession = sessionOfEvent(selected.included)
  const rows = inheritDispositions(
    uniqueByFingerprint(
      kept.map(item =>
        rewardHackFindingRow({
          scanId,
          item,
          eventFile: built.eventFile,
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
      watermark,
      findingFingerprints: rows.map(r => r.fingerprint),
      costUsd,
      truncated: built.truncated,
    },
  })
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

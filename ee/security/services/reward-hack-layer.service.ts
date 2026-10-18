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
 * judge, the evidence gates, a refute call per item (at most
 * `REWARD_HACK_MAX_REFUTES`, in parallel) → findings, state → stage → the PR
 * summary. Every call's estimated cost is charged to the monthly ledger
 * BEFORE it is made and settled to its reported cost after, so the cap holds
 * even for a run the platform kills mid-call.
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
  buildRhPrDiffBlock,
  buildRhUserPrompt,
  pathMatchesPrFile,
  prAddedLines,
  rhEventAddedLines,
  rhEventFilePaths,
  rhWatermark,
  selectSessionsForPr,
  type RhPrFile,
  type RhSession,
} from '@/ee/security/security-scan/reward-hack-input'
import {
  applyRhGates,
  citedEditsInPr,
  type RhDiffView,
} from '@/ee/security/security-scan/reward-hack-gates'
import {
  RH_MAX_INPUT_TOKENS,
  estimateRhCallUsd,
  estimateRhTokens,
  settledRhCallUsd,
} from '@/ee/security/security-scan/reward-hack-cost'
import {
  REWARD_HACK_JUDGE_MAX_OUTPUT_TOKENS,
  REWARD_HACK_REFUTE_MAX_OUTPUT_TOKENS,
  REWARD_HACK_REFUTE_SYSTEM_PROMPT,
  REWARD_HACK_SYSTEM_PROMPT,
  REWARD_HACK_VERSION,
  buildRefutePrompt,
} from '@/ee/security/security-scan/reward-hack-prompts'
import { redactFindingProse } from '@/ee/security/security-scan/finding-prose'
import { rewardHackTitle } from '@/ee/security/security-scan/reward-hack-labels'
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

/**
 * Our cap on refute calls per run (the highest-ranked items in the judge's
 * order); refutes run in parallel so the run stays inside its time budget.
 */
export const REWARD_HACK_MAX_REFUTES = 3

/** What a model call reports back about its own cost. */
interface RhCallCost {
  costUsd: number | null
  inputTokens?: number
  outputTokens?: number
}

export interface RhDeps {
  judge: (prompt: string) => Promise<{ output: RhJudgeOutput } & RhCallCost>
  refute: (args: {
    prompt: string
    item: RhItem
    /** The fenced current PR hunks of the item's files ('' = none). */
    prDiff: string
  }) => Promise<{ refuted: boolean } & RhCallCost>
  /** The PR's changed files (path + hunks) at its head. Throws when unreadable. */
  listPrFiles: (pr: {
    workspaceId: string
    repo: string
    number: number
  }) => Promise<RhPrFile[]>
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
    return files.map(f => ({ filename: f.filename, patch: f.patch ?? null }))
  },
  now: () => new Date(),
}

/**
 * sha256 over the kind and the sorted PR files the cited writes touch — not
 * the cited event ids, which change with every re-judge: the same behaviour
 * in the same files keeps its fingerprint, so a disposition carries over.
 */
export function rewardHackFingerprint(kind: string, prFiles: string[]): string {
  return createHash('sha256')
    .update(['reward-hack', kind, ...[...new Set(prFiles)].sort()].join('\n'))
    .digest('hex')
}

/**
 * The finding row for one surviving item. `filePath` is the PR file of the
 * first cited Write/Edit event (repo-relative, as the PR lists it), else ''.
 */
export function rewardHackFindingRow(args: {
  scanId: string
  item: RhItem
  eventFile: Map<string, string[]>
  eventSession: Map<string, string>
  prFiles: string[]
}): NewFindingInput {
  const { item } = args
  // Every PR file the cited writes touch, in citation order; the first one
  // anchors the row.
  const matched: string[] = []
  for (const id of item.eventIds) {
    const paths = args.eventFile.get(id) ?? []
    for (const f of args.prFiles)
      if (!matched.includes(f) && paths.some(p => pathMatchesPrFile(p, f)))
        matched.push(f)
  }
  const filePath = matched[0] ?? ''
  const sessionIds = [
    ...new Set(
      item.eventIds
        .map(id => args.eventSession.get(id))
        .filter((s): s is string => !!s)
    ),
  ]
  return {
    scanId: args.scanId,
    kind: 'REWARD_HACK',
    ruleId: `reward-hack/${item.kind}`,
    severity: 'MEDIUM',
    provenance: 'LLM_JUDGE',
    filePath,
    line: null,
    // Our fixed copy: reaches the PR comment, the CLI and every member.
    title: rewardHackTitle(item.kind, filePath),
    // The model's prose: the web evidence view only, for viewers who may
    // open the cited sessions.
    detail: redactFindingProse(item.summary),
    evidence: JSON.stringify({ eventIds: item.eventIds, sessionIds }),
    fingerprint: rewardHackFingerprint(item.kind, matched),
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
  const diffView = buildDiffView(selected.included, prFileList)
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
  const built = buildRhUserPrompt({
    requirement,
    transcripts: selected.included.map(s => ({
      sessionId: s.id,
      events: s.events,
    })),
    maxChars: REWARD_HACK_MAX_INPUT_CHARS,
  })
  const judgeInput = `${REWARD_HACK_SYSTEM_PROMPT}\n${built.prompt}`
  if (built.overCap || estimateRhTokens(judgeInput) > RH_MAX_INPUT_TOKENS)
    // Even the markers do not fit (or the text is token-dense past our
    // per-call cap): nothing is sent to the model.
    return settle(ctx, {
      state: 'PARTIAL',
      causes: ['REWARD_HACK_INPUT_CAP', ...prunedCauses],
    })

  const ledger = new SpendLedger(workspaceId, cap, now)
  // Charged BEFORE the call: a run killed mid-call (the platform's time
  // limit) or a call with no reported cost still counts against the cap.
  const judgeEstimate = estimateRhCallUsd(
    judgeInput,
    REWARD_HACK_JUDGE_MAX_OUTPUT_TOKENS
  )
  if (!(await ledger.reserve(judgeEstimate))) return settle(ctx, capped)
  const judged = await deps.judge(built.prompt)
  await ledger.settle(judgeEstimate, judged)
  const items = applyRhGates({
    ...diffView,
    output: judged.output,
    promptEventIds: built.eventIds,
  }).slice(0, REWARD_HACK_MAX_REFUTES)

  const kept: RhItem[] = []
  if (items.length > 0) {
    // The refute call reads the cited files' CURRENT hunks: what will merge.
    const refuteArgs = items.map(item => ({
      prompt: built.prompt,
      item,
      prDiff: buildRhPrDiffBlock(
        prFileList,
        item.eventIds.flatMap(id => diffView.eventFile.get(id) ?? [])
      ),
    }))
    const estimates = refuteArgs.map(a =>
      estimateRhCallUsd(
        `${REWARD_HACK_REFUTE_SYSTEM_PROMPT}\n${buildRefutePrompt(a)}`,
        REWARD_HACK_REFUTE_MAX_OUTPUT_TOKENS
      )
    )
    const total = estimates.reduce((a, b) => a + b, 0)
    // No room left for the refutes: an unrefuted item is never reported.
    if (!(await ledger.reserve(total))) return settle(ctx, capped)
    const verdicts = await Promise.allSettled(
      refuteArgs.map(a => deps.refute(a))
    )
    let failure: unknown = null
    for (let i = 0; i < items.length; i++) {
      const v = verdicts[i]!
      // A failed call keeps its estimate: it may have been billed.
      if (v.status === 'rejected') {
        failure = failure ?? v.reason
        continue
      }
      await ledger.settle(estimates[i]!, v.value)
      if (!v.value.refuted) kept.push(items[i]!)
    }
    if (failure !== null) throw failure
  }
  const costUsd = Math.round(ledger.bookedUsd * 1e6) / 1e6

  const eventSession = sessionOfEvent(selected.included)
  const rows = inheritDispositions(
    uniqueByFingerprint(
      kept.map(item =>
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
class SpendLedger {
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
  async settle(
    estimateUsd: number,
    reported: {
      costUsd: number | null
      inputTokens?: number
      outputTokens?: number
    }
  ): Promise<void> {
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

/** The writes of every included event, and the PR's added lines. */
function buildDiffView(
  sessions: RhSession[],
  prFileList: RhPrFile[]
): RhDiffView {
  const eventFile = new Map<string, string[]>()
  const eventAddedLines = new Map<string, string[] | null>()
  for (const s of sessions)
    for (const e of s.events) {
      const paths = rhEventFilePaths(e)
      if (paths.length === 0) continue
      eventFile.set(e.id, paths)
      eventAddedLines.set(e.id, rhEventAddedLines(e))
    }
  return {
    eventFile,
    eventAddedLines,
    prFiles: prFileList.map(f => f.filename),
    prAdded: prAddedLines(prFileList),
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

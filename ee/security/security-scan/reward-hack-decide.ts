/**
 * LUM-1234 — the reward-hack layer's decision core: from the sessions behind
 * a PR (already windowed by `selectSessionsForPr`), the PR's files and the
 * task requirement to the items that survive the judge and the evidence
 * gates — those are reported as they stand (the per-item refute call was
 * removed by user ruling 2026-10-22: it overturned too few items to pay for
 * itself).
 *
 * No database, no model client: the judge call and the spend ceiling come
 * in as dependencies. The layer runner
 * (`reward-hack-layer.service.ts`) composes it with the scan rows and the
 * monthly ledger; the offline dogfood calibration
 * (`scripts/analysis/lum1234-trace/calibrate-pr.ts`) runs the very same core
 * on local transcripts — so what is calibrated is what ships.
 */
import { createHash } from 'node:crypto'
import type { NewFindingInput } from '@/ee/security/repositories/pr-security-scan.repository'
import { redactFindingProse } from '@/ee/security/security-scan/finding-prose'
import { rewardHackTitle } from '@/ee/security/security-scan/reward-hack-labels'
import {
  pathMatchesPrFile,
  buildRhUserPrompt,
  prAddedLines,
  prFileStatuses,
  rhEventAddedLines,
  rhEventFilePaths,
  rhEventIsShellWrite,
  rhEventIsWholeFileWrite,
  type RhPrFile,
  type RhSession,
} from '@/ee/security/security-scan/reward-hack-input'
import {
  applyRhGates,
  type RhDiffView,
} from '@/ee/security/security-scan/reward-hack-gates'
import {
  RH_MAX_INPUT_TOKENS,
  estimateRhCallUsd,
  estimateRhTokens,
} from '@/ee/security/security-scan/reward-hack-cost'
import {
  REWARD_HACK_JUDGE_MAX_OUTPUT_TOKENS,
  REWARD_HACK_SYSTEM_PROMPT,
} from '@/ee/security/security-scan/reward-hack-prompts'
import type {
  RhItem,
  RhJudgeOutput,
} from '@/ee/security/llm/reward-hack-judge-client'

/** Our cap on one PR's judge input (characters); over it the input is cut. */
export const REWARD_HACK_MAX_INPUT_CHARS = 400_000

/** What a model call reports back about its own cost. */
export interface RhCallCost {
  costUsd: number | null
  inputTokens?: number
  outputTokens?: number
}

export type RhJudgeFn = (
  prompt: string
) => Promise<{ output: RhJudgeOutput } & RhCallCost>

/**
 * The spend ceiling one run charges against: an estimate is reserved BEFORE
 * each call (false = no room, nothing charged) and settled to the call's
 * reported cost after.
 */
export interface RhSpendGate {
  reserve(usd: number): Promise<boolean>
  settle(estimateUsd: number, reported: RhCallCost): Promise<void>
}

/** The writes of every event of `sessions`, and the PR's added lines. */
export function buildRhDiffView(
  sessions: RhSession[],
  prFileList: RhPrFile[]
): RhDiffView {
  const eventFile = new Map<string, string[]>()
  const eventAddedLines = new Map<string, string[] | null>()
  const wholeFileWrites = new Set<string>()
  const shellWrites = new Set<string>()
  for (const s of sessions)
    for (const e of s.events) {
      const paths = rhEventFilePaths(e)
      if (paths.length === 0) continue
      eventFile.set(e.id, paths)
      eventAddedLines.set(e.id, rhEventAddedLines(e))
      if (rhEventIsWholeFileWrite(e)) wholeFileWrites.add(e.id)
      if (rhEventIsShellWrite(e)) shellWrites.add(e.id)
    }
  return {
    eventFile,
    eventAddedLines,
    prFiles: prFileList.map(f => f.filename),
    prAdded: prAddedLines(prFileList),
    wholeFileWrites,
    prStatus: prFileStatuses(prFileList),
    shellWrites,
  }
}

export type RhBuiltPrompt = ReturnType<typeof buildRhUserPrompt>

export type RhDecision =
  /** Even the markers do not fit, or the input is past our token cap: no call. */
  | { outcome: 'overCap'; built: RhBuiltPrompt }
  /** The spend gate had no room for the judge call (nothing was called). */
  | { outcome: 'capped'; built: RhBuiltPrompt }
  | {
      outcome: 'judged'
      built: RhBuiltPrompt
      judged: { output: RhJudgeOutput } & RhCallCost
      /**
       * Every item that passed the threshold, evidence and diff gates: what
       * is reported (no second model call second-guesses it).
       */
      gated: RhItem[]
    }

/**
 * Judge → gates for one PR: the items that pass the gates are the verdict.
 * Throws any judge failure.
 */
export async function decideRewardHack(args: {
  /** The sessions selected for this PR (their in-window events only). */
  sessions: RhSession[]
  prFileList: RhPrFile[]
  requirement: string
  judge: RhJudgeFn
  spend: RhSpendGate
  /** Precomputed `buildRhDiffView(sessions, prFileList)`, if the caller has it. */
  diffView?: RhDiffView
}): Promise<RhDecision> {
  const diffView =
    args.diffView ?? buildRhDiffView(args.sessions, args.prFileList)
  const built = buildRhUserPrompt({
    requirement: args.requirement,
    transcripts: args.sessions.map(s => ({
      sessionId: s.id,
      events: s.events,
    })),
    maxChars: REWARD_HACK_MAX_INPUT_CHARS,
    // Over the cap, the writes to the PR's own files are the last cut.
    prFiles: args.prFileList.map(f => f.filename),
  })
  const judgeInput = `${REWARD_HACK_SYSTEM_PROMPT}\n${built.prompt}`
  if (built.overCap || estimateRhTokens(judgeInput) > RH_MAX_INPUT_TOKENS)
    return { outcome: 'overCap', built }

  // Charged BEFORE the call: a run killed mid-call (the platform's time
  // limit) or a call with no reported cost still counts against the cap.
  const judgeEstimate = estimateRhCallUsd(
    judgeInput,
    REWARD_HACK_JUDGE_MAX_OUTPUT_TOKENS
  )
  if (!(await args.spend.reserve(judgeEstimate)))
    return { outcome: 'capped', built }
  const judged = await args.judge(built.prompt)
  await args.spend.settle(judgeEstimate, judged)
  const gated = applyRhGates({
    ...diffView,
    output: judged.output,
    promptEventIds: built.eventIds,
  })
  return { outcome: 'judged', built, judged, gated }
}

// ─── finding rows ────────────────────────────────────────────────────────────

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

/** One row per fingerprint (the first wins). */
export function uniqueByFingerprint(
  rows: NewFindingInput[]
): NewFindingInput[] {
  const seen = new Set<string>()
  return rows.filter(r => {
    if (seen.has(r.fingerprint)) return false
    seen.add(r.fingerprint)
    return true
  })
}

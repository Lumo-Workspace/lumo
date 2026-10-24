/**
 * LUM-1308 — pure derivations behind the redesigned Lumo review record: which
 * check a finding came from, each check's row (state, findings, whether it
 * opens by default), and the order PRs are listed in. No intl, no React.
 */
import {
  SCAN_STAGE_DISPLAY_ORDER,
  type ScanStageKeyName,
} from '@/shared/src/security-scan'
import type {
  SecurityFindingView,
  SecurityScanView,
  TaskSecurityScans,
} from '@/ee/security/services/pr-security-scan.service'
import {
  ISSUE_ASSESSMENT_CHECK_ID,
  nonPassingChecks,
  type PreMergeCheckView,
} from '@/shared/src/pre-merge-checks'
import { isQuietFinding } from './security-summary'

/**
 * The check (scan layer) that produced a finding. Findings carry no layer
 * column, so it is read from how the row was made:
 * - DETERMINISTIC: stage A — secret rules (`SECRET`), plus the graph rules
 *   (`llm-output-to-sink`, `agent-loop-unbounded`), which are rule-based
 *   code-pattern checks and read best under Risky code patterns.
 * - EXTERNAL_TOOL: the scanners' SARIF — osv-scanner rows are `DEPENDENCY`.
 * - LLM_JUDGE: `REWARD_HACK` rows are the agent-behavior layer, `hunt:*`
 *   rows the exploit-path hunt, everything else the AI review.
 */
export function findingCheck(
  f: Pick<SecurityFindingView, 'provenance' | 'kind' | 'ruleId'>
): ScanStageKeyName {
  if (f.provenance === 'DETERMINISTIC')
    return f.kind === 'SECRET' ? 'secrets' : 'external'
  if (f.provenance === 'EXTERNAL_TOOL')
    return f.kind === 'DEPENDENCY' ? 'supplyChain' : 'external'
  if (f.kind === 'REWARD_HACK') return 'rewardHack'
  return f.ruleId.startsWith('hunt:') ? 'hunt' : 'judge'
}

/**
 * How a check's row reads: `ok` checked the change, `off` was not needed or
 * turned off, `pending` is still running, `warn` did not (fully) cover the
 * change — failed, partial, paused, not configured or over a size limit.
 */
export type CheckTone = 'ok' | 'off' | 'pending' | 'warn'

export interface CheckRow {
  key: ScanStageKeyName
  /** The stored stage state; null on an older scan without this layer. */
  state: SecurityScanView['stages'][ScanStageKeyName] | null
  tone: CheckTone
  /** Skipped only because the change was over this layer's size limit. */
  overCap: boolean
  /** Findings someone must still decide on. */
  open: SecurityFindingView[]
  /** Ruled on, verifier-rejected, on main or out of the queue. */
  quiet: SecurityFindingView[]
  /**
   * The issue assessment (pre-merge check) when it did not pass — shown under
   * Agent shortcuts: both ask whether the change does what the task asked.
   * null on every other row.
   */
  assessment: PreMergeCheckView | null
  /** Opens by default: an open finding, an unmet assessment, or the layer
   *  did not cover the PR. */
  defaultOpen: boolean
}

/** The issue assessment, when it failed or was inconclusive. */
function unmetAssessment(scan: SecurityScanView): PreMergeCheckView | null {
  return (
    nonPassingChecks(scan.preMergeChecks).find(
      c => c.id === ISSUE_ASSESSMENT_CHECK_ID
    ) ?? null
  )
}

/**
 * The pre-merge checks that did not pass and concern the whole PR — every
 * one but the issue assessment, which sits on the Agent shortcuts row.
 */
export function prLevelPreMergeChecks(
  scan: Pick<SecurityScanView, 'preMergeChecks'>
): PreMergeCheckView[] {
  return nonPassingChecks(scan.preMergeChecks).filter(
    c => c.id !== ISSUE_ASSESSMENT_CHECK_ID
  )
}

function checkTone(state: CheckRow['state'], overCap: boolean): CheckTone {
  if (overCap) return 'warn'
  if (state === 'RAN') return 'ok'
  if (state === 'SKIPPED' || state === 'DISABLED' || state == null) return 'off'
  if (state === 'PENDING') return 'pending'
  return 'warn'
}

/**
 * One row per check, in display order. A layer the scan never recorded is
 * left out unless a finding names it (older scans predate some layers).
 */
export function buildCheckRows(scan: SecurityScanView): CheckRow[] {
  const byCheck = new Map<ScanStageKeyName, SecurityFindingView[]>()
  for (const f of scan.findings) {
    const key = findingCheck(f)
    byCheck.set(key, [...(byCheck.get(key) ?? []), f])
  }
  const unmet = unmetAssessment(scan)
  return SCAN_STAGE_DISPLAY_ORDER.flatMap(key => {
    const state = scan.stages[key] ?? null
    const findings = byCheck.get(key) ?? []
    const assessment = key === 'rewardHack' ? unmet : null
    if (state == null && findings.length === 0 && assessment == null) return []
    const overCap =
      scan.prTooLarge != null ||
      (key === 'hunt' && scan.huntOverCap != null) ||
      (key === 'judge' &&
        (scan.judgeOverCap != null || scan.judgePartial != null))
    // A scanner that hasn't reported in 30 minutes is no longer "running":
    // the PR is not covered, and the row opens to say so.
    // A batched hunt that finished short of the PR's files did not cover it
    // either — the row says how much, in the warning tone.
    const huntShort =
      key === 'hunt' &&
      state === 'RAN' &&
      scan.huntProgress != null &&
      scan.huntProgress.coveredFiles < scan.huntProgress.totalFiles
    const tone =
      (key === 'external' && scan.externalLate) || huntShort
        ? 'warn'
        : checkTone(state, overCap)
    const open = findings.filter(f => !isQuietFinding(f))
    const quiet = findings.filter(isQuietFinding)
    return [
      {
        key,
        state,
        tone,
        overCap,
        open,
        quiet,
        assessment,
        defaultOpen: open.length > 0 || assessment != null || tone === 'warn',
      },
    ]
  })
}

/**
 * How urgently a PR needs a look — lower first: 0 a finding blocks Done,
 * 1 an open finding, 2 no scan, a scan that did not cover the change (not
 * counting layers turned off in settings) or a pre-merge check that did not
 * pass, 3 nothing to do.
 */
export function prAttention(entry: TaskSecurityScans['prs'][number]): number {
  const { latest } = entry
  if (!latest) return 2
  const open = latest.findings.filter(f => !isQuietFinding(f))
  if (open.some(f => f.blocking)) return 0
  if (open.length > 0) return 1
  // LUM-892: layers the customer turned off are their choice, not a reason
  // to look — the badge already says so. A size cap still is: its notice
  // says how to get the layer (split the PR).
  const uncovered = !latest.complete && latest.coverage !== 'TURNED_OFF'
  if (uncovered || nonPassingChecks(latest.preMergeChecks).length > 0) return 2
  return 3
}

/**
 * PRs in attention order (stable within a level), split into the ones listed
 * one by one and the ones that need nothing — folded into one row.
 */
export function orderPrs(prs: TaskSecurityScans['prs']): {
  listed: TaskSecurityScans['prs']
  clean: TaskSecurityScans['prs']
} {
  const sorted = prs
    .map((entry, i) => ({ entry, i, rank: prAttention(entry) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
  return {
    listed: sorted.filter(s => s.rank < 3).map(s => s.entry),
    clean: sorted.filter(s => s.rank === 3).map(s => s.entry),
  }
}

/**
 * Checks that did not (fully) cover the PR and have nothing to decide on —
 * what the "N checks didn't fully run" summary lists.
 */
export function uncoveredChecks(rows: CheckRow[]): CheckRow[] {
  return rows.filter(r => r.tone === 'warn' && r.open.length === 0)
}

/**
 * When the scan found nothing to decide on, the uncovered checks are said in
 * one summary instead of each row opening on its own.
 */
export function summarizesUncovered(rows: CheckRow[]): boolean {
  return (
    uncoveredChecks(rows).length > 0 &&
    rows.every(r => r.open.length === 0 && r.assessment == null)
  )
}

/** Checks finished of those the scan runs (a running one is not done). */
export function checkProgress(rows: CheckRow[]): {
  done: number
  total: number
} {
  return {
    done: rows.filter(r => r.tone !== 'pending').length,
    total: rows.length,
  }
}

/**
 * A check with nothing in it: checked or not needed, no finding of any kind
 * and no assessment. With many PRs these fold into one "N more checks" row.
 */
export function isEmptyCheck(row: CheckRow): boolean {
  return (
    (row.tone === 'ok' || row.tone === 'off') &&
    row.open.length === 0 &&
    row.quiet.length === 0 &&
    row.assessment == null
  )
}

/**
 * The review's one-word verdict for the card header, most urgent first:
 * a finding blocks Done › findings to decide on › still scanning › a check
 * did not cover a PR › a pre-merge check did not pass › checks turned off ›
 * clean. `count` is the number the label carries (findings, PRs, checks).
 */
export type ReviewVerdict =
  | { kind: 'blocking'; count: number }
  | { kind: 'open'; count: number }
  | { kind: 'scanning' }
  | { kind: 'notFullyChecked' }
  | { kind: 'preMerge'; count: number }
  | { kind: 'turnedOff' }
  | { kind: 'notScanned' }
  | { kind: 'clean' }

export function reviewVerdict(data: TaskSecurityScans): ReviewVerdict {
  const scans = data.prs.flatMap(p => (p.latest ? [p.latest] : []))
  if (scans.length === 0)
    return data.scanningOff ? { kind: 'turnedOff' } : { kind: 'notScanned' }
  const open = scans.flatMap(s => s.findings.filter(f => !isQuietFinding(f)))
  const blocking = open.filter(f => f.blocking).length
  if (blocking > 0) return { kind: 'blocking', count: blocking }
  if (open.length > 0) return { kind: 'open', count: open.length }
  if (scans.some(s => s.coverage === 'IN_PROGRESS' && !s.externalLate))
    return { kind: 'scanning' }
  // A PR with no scan yet, or a scan that did not cover it — a size cap
  // included (its notice says how to get it checked).
  if (
    data.prs.some(p => p.latest == null) ||
    scans.some(s => !s.complete && s.coverage !== 'TURNED_OFF')
  )
    return { kind: 'notFullyChecked' }
  const preMerge = scans.reduce(
    (n, s) => n + nonPassingChecks(s.preMergeChecks).length,
    0
  )
  if (preMerge > 0) return { kind: 'preMerge', count: preMerge }
  if (data.scanningOff || scans.some(s => s.coverage === 'TURNED_OFF'))
    return { kind: 'turnedOff' }
  return { kind: 'clean' }
}

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
import { nonPassingChecks } from '@/shared/src/pre-merge-checks'
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
  /** Opens by default: an open finding, or the layer did not cover the PR. */
  defaultOpen: boolean
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
  return SCAN_STAGE_DISPLAY_ORDER.flatMap(key => {
    const state = scan.stages[key] ?? null
    const findings = byCheck.get(key) ?? []
    if (state == null && findings.length === 0) return []
    const overCap =
      scan.prTooLarge != null ||
      (key === 'hunt' && scan.huntOverCap != null) ||
      (key === 'judge' &&
        (scan.judgeOverCap != null || scan.judgePartial != null))
    // A scanner that hasn't reported in 30 minutes is no longer "running":
    // the PR is not covered, and the row opens to say so.
    const tone =
      key === 'external' && scan.externalLate
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
        defaultOpen: open.length > 0 || tone === 'warn',
      },
    ]
  })
}

/**
 * How urgently a PR needs a look — lower first: 0 a finding blocks Done,
 * 1 an open finding, 2 no scan, a scan that did not cover the change or a
 * pre-merge check that did not pass, 3 nothing to do.
 */
export function prAttention(entry: TaskSecurityScans['prs'][number]): number {
  const { latest } = entry
  if (!latest) return 2
  const open = latest.findings.filter(f => !isQuietFinding(f))
  if (open.some(f => f.blocking)) return 0
  if (open.length > 0) return 1
  if (!latest.complete || nonPassingChecks(latest.preMergeChecks).length > 0)
    return 2
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

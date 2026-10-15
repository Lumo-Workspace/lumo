/**
 * LUM-496 Task 3: pure derivations behind the Record tab's security-scan
 * section — the one-line rollup (PR count · undispositioned findings ·
 * all-LOW note · incomplete-scan count · external-failure count) and which PR
 * rows default open.
 * No intl, no React — unit-testable on their own.
 */
import type { ScanStageKeyName } from '@/shared/src/security-scan'
import type {
  SecurityFindingView,
  SecurityScanView,
  TaskSecurityScans,
} from '@/ee/security/services/pr-security-scan.service'

export interface SecurityScanSummary {
  prs: number
  /** Findings someone must still decide on, across every PR's latest scan
   *  (not ruled on, not on main, in the queue, not verifier-rejected). */
  findings: number
  /** True only when there is at least one undispositioned finding and every
   *  one of them is LOW severity — never true on zero findings (LUM-566: a
   *  clean result never reads as "reviewed and fine"). */
  allLow: boolean
  /** Latest scans whose external stage FAILED. */
  externalFailed: number
  /**
   * PRs whose latest scan cannot back a "no findings" claim: no scan at all,
   * or a scan the service marked `complete: false` (FAILED, a failed /
   * unconfigured / partial layer, or a truncated budget). LUM-496 review F1 —
   * without this the summary line read "7 PRs · no findings" while half the
   * scans never finished.
   *
   * LUM-832: excludes the scans counted in `overSizeLimit` — those did not
   * leave anything "for later"; a layer was skipped because the change was
   * too large, and saying "not fully checked yet" implied otherwise.
   */
  incomplete: number
  /**
   * LUM-832 — PRs whose latest scan skipped a layer ONLY because the change
   * was over its size cap (an industry-standard file cap): told as such, never as
   * "not fully checked yet" (nothing is coming later).
   */
  overSizeLimit: number
  /**
   * LUM-892 — PRs whose latest scan had a layer turned off in the workspace
   * settings (and nothing of ours unfinished): the customer's choice, told as
   * such — never "not fully checked yet", never clean.
   */
  turnedOff: number
}

/**
 * LUM-832 — the scan is unfinished only because a layer was over its size
 * cap: not ours to finish (`ownedUnfinished` is false) and a size notice is
 * on it. The one rule the summary line and the PR badge share.
 */
export function isOverSizeLimitOnly(
  scan: Pick<
    SecurityScanView,
    'coverage' | 'ownedUnfinished' | 'huntOverCap' | 'judgeOverCap'
  > & { prTooLarge?: SecurityScanView['prTooLarge'] }
): boolean {
  return (
    scan.coverage === 'UNFINISHED' &&
    !scan.ownedUnfinished &&
    (scan.huntOverCap != null ||
      scan.judgeOverCap != null ||
      scan.prTooLarge != null)
  )
}

/** Undispositioned, not already on main, and still in the queue (LUM-775). */
function isOpenFinding(f: SecurityScanView['findings'][number]): boolean {
  return f.disposition == null && !f.persisting && f.queueExit == null
}

/**
 * LUM-1012 — a finding nobody has to decide on now: ruled on, already on the
 * default branch, out of the queue (its PR merged / closed), or rejected by
 * the agentic verifier (LUM-988). Drawn folded to one line, listed last, and
 * never counted as "N findings" in a PR's result cell.
 */
export function isQuietFinding(f: SecurityFindingView): boolean {
  return !isOpenFinding(f) || f.verifierVerdict === 'REJECTED'
}

export function summarizeSecurityScans(
  prs: Array<{ latest: SecurityScanView | null }>
): SecurityScanSummary {
  // LUM-738: a persisting row (already on the default branch) needs no
  // decision from this PR's reviewer — it is neither counted nor expanded for.
  // LUM-775: nor does a row that left the queue when its PR merged / closed.
  // LUM-1012: nor does one the agentic verifier rejected (LUM-988: "not
  // open") — it is listed, folded, never counted.
  const undispositioned = prs.flatMap(({ latest }) =>
    latest ? latest.findings.filter(f => !isQuietFinding(f)) : []
  )
  return {
    prs: prs.length,
    findings: undispositioned.length,
    allLow:
      undispositioned.length > 0 &&
      undispositioned.every(f => f.severity === 'LOW'),
    externalFailed: prs.filter(
      ({ latest }) => latest?.stages.external === 'FAILED'
    ).length,
    incomplete: prs.filter(
      ({ latest }) =>
        latest == null ||
        (!latest.complete &&
          !isOverSizeLimitOnly(latest) &&
          latest.coverage !== 'TURNED_OFF')
    ).length,
    overSizeLimit: prs.filter(
      ({ latest }) => latest != null && isOverSizeLimitOnly(latest)
    ).length,
    turnedOff: prs.filter(({ latest }) => latest?.coverage === 'TURNED_OFF')
      .length,
  }
}

/**
 * Whether a PR's row should default to expanded: an undispositioned finding
 * still needs a human decision, the scan did not complete (its stage notes,
 * not-configured hint or partial notice are the reason the summary cannot
 * claim a clean result — LUM-496 review F1), or the external scanner failed
 * with a concrete error worth reading. A manual toggle overrides this
 * afterward — this only decides the row's INITIAL state.
 */
export function shouldExpandRow(latest: SecurityScanView | null): boolean {
  if (!latest) return false
  if (latest.findings.some(f => !isQuietFinding(f))) return true
  // LUM-892: a layer the customer turned off is no reason to open the row —
  // the summary line and the badge already say it.
  if (!latest.complete && latest.coverage !== 'TURNED_OFF') return true
  return latest.stages.external === 'FAILED' && latest.error != null
}

/**
 * LUM-1009 — the findings that block DONE across every PR's latest scan, each
 * with its PR number: what the Record tab's Needs action section lists.
 */
export function blockingFindings(
  prs: TaskSecurityScans['prs']
): { prNumber: number; finding: SecurityFindingView }[] {
  return prs.flatMap(({ pr, latest }) =>
    (latest?.findings ?? [])
      .filter(f => f.blocking)
      .map(finding => ({ prNumber: pr.number, finding }))
  )
}

/**
 * LUM-1012 follow-up — why a finding sits where it does in a PR's list. The
 * list is grouped by this key under one heading each, so the reason is said
 * once instead of as a chip on every row. First match wins: a ruling beats
 * every other reason; a verifier rejection beats the queue / main labels.
 */
export type FindingGroupKey =
  | 'open'
  | 'ruled'
  | 'verifierRejected'
  | 'queueExit'
  | 'persisting'

export function findingGroupKey(f: SecurityFindingView): FindingGroupKey {
  if (f.disposition != null) return 'ruled'
  if (f.verifierVerdict === 'REJECTED') return 'verifierRejected'
  if (f.queueExit != null) return 'queueExit'
  if (f.persisting) return 'persisting'
  return 'open'
}

const GROUP_ORDER: FindingGroupKey[] = [
  'open',
  'queueExit',
  'persisting',
  'verifierRejected',
  'ruled',
]

export interface FindingGroup {
  key: FindingGroupKey
  /** Set on a `queueExit` group: why the findings left the queue. Findings
   *  with different exits get separate groups. */
  queueExit: SecurityFindingView['queueExit']
  findings: SecurityFindingView[]
}

/**
 * Findings grouped by `findingGroupKey` (queue exits split per exit kind), in
 * a fixed order — the ones someone must decide on first. Within a group the
 * input order is kept. Empty groups are dropped.
 */
export function groupFindings(findings: SecurityFindingView[]): FindingGroup[] {
  const groups = new Map<string, FindingGroup>()
  for (const f of findings) {
    const key = findingGroupKey(f)
    const queueExit = key === 'queueExit' ? f.queueExit : null
    const id = `${key}:${queueExit ?? ''}`
    const group = groups.get(id) ?? { key, queueExit, findings: [] }
    group.findings.push(f)
    groups.set(id, group)
  }
  return [...groups.values()].sort(
    (a, b) => GROUP_ORDER.indexOf(a.key) - GROUP_ORDER.indexOf(b.key)
  )
}

/**
 * LUM-1012 follow-up — why a layer did not (fully) run, as an i18n message id
 * plus its values, for the hover on that layer's checklist item. null for a
 * layer that simply checked the change. Each reason mirrors where the
 * pipeline stamps the state (`pr-security-scan.service.ts`,
 * `security-managed-scan.ts`), so the hover says what actually happened.
 */
export function stageReason(
  stageKey: ScanStageKeyName,
  scan: Pick<
    SecurityScanView,
    'stages' | 'huntOverCap' | 'judgeOverCap' | 'huntProgress'
  > & {
    prTooLarge?: SecurityScanView['prTooLarge']
    reviewRateLimited?: SecurityScanView['reviewRateLimited']
  }
): { id: string; values?: Record<string, number> } | null {
  const state = scan.stages[stageKey]
  if (!state) return null
  const id = (suffix: string) => `securityScan.stageReason.${suffix}`
  // LUM-1079: no layer ran because the whole PR was too large.
  if (scan.prTooLarge) return { id: id('prTooLarge') }
  if (stageKey === 'judge' && scan.judgeOverCap)
    return {
      id: id('judgeOverCap'),
      values: {
        size: scan.judgeOverCap.diffChars,
        cap: scan.judgeOverCap.capChars,
      },
    }
  if (stageKey === 'hunt' && scan.huntOverCap)
    return {
      id: id('huntOverCap'),
      values: {
        files: scan.huntOverCap.sourceFiles,
        cap: scan.huntOverCap.capFiles,
      },
    }
  // Only a hunt still running reads as "n of m so far" — a batched hunt
  // that then failed or was superseded says that instead.
  if (
    stageKey === 'hunt' &&
    state === 'PENDING' &&
    scan.huntProgress &&
    scan.huntProgress.coveredFiles < scan.huntProgress.totalFiles
  )
    return {
      id: id('huntInProgress'),
      values: {
        covered: scan.huntProgress.coveredFiles,
        total: scan.huntProgress.totalFiles,
      },
    }
  switch (state) {
    case 'PAUSED':
      // LUM-1137: over the author's hourly cap, not paused.
      return { id: id(scan.reviewRateLimited ? 'RATE_LIMITED' : 'PAUSED') }
    case 'RAN':
      return null
    case 'SKIPPED':
      return {
        id: id(
          stageKey === 'hunt' ||
            stageKey === 'judge' ||
            stageKey === 'supplyChain'
            ? `${stageKey}Skipped`
            : 'skipped'
        ),
      }
    case 'FAILED':
      return { id: id(stageKey === 'judge' ? 'judgeFailed' : 'FAILED') }
    case 'PARTIAL':
      return { id: id(stageKey === 'judge' ? 'judgePartial' : 'PARTIAL') }
    default:
      return { id: id(state) }
  }
}

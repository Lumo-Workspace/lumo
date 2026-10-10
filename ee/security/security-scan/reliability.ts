/**
 * LUM-832 — the scan's reliability as an INTERNAL number.
 *
 * Until now the only place a sandbox failure showed up was a yellow line in
 * the customer's panel: they saw our failure rate, we did not. This reads it
 * off the rows instead — how many scans in a window did not finish because of
 * us, how many owe coverage we chose not to spend, and how much of the diff
 * the hunt actually covered — so the rate is ours to watch and drive to zero.
 *
 * Pure: the repository hands over the rows, the service picks the window.
 */
import {
  partialCauseClass,
  scanCoverageState,
  type ScanCoverageState,
} from '@/shared/src/security-scan'

export interface ReliabilityScanRow {
  status: string
  stages: Partial<Record<string, string>> | null
  partial: boolean
  partialCauses: string[]
  /** Raw `huntAudit` Json — only `diff.oversized` is read. */
  huntAudit: unknown
}

export interface ScanReliability {
  scans: number
  /** What the customer was shown, by state. */
  byCoverage: Record<ScanCoverageState, number>
  /**
   * Scans with at least one cause that is our fault — a cause classed
   * OUR_FAULT, a FAILED scan, or a FAILED layer. The number LUM-832 drives
   * to zero.
   */
  ourFault: number
  /** Scans owing coverage (a budget we set) and no fault of ours. */
  coverageOwedOnly: number
  /**
   * LUM-1079 — scans of a PR too large to scan at all: neither our fault nor
   * coverage we owe (still UNFINISHED in `byCoverage`, never CHECKED).
   */
  changeTooLarge: number
  /** `partial` with no cause on record — rows from before LUM-832. */
  unattributed: number
  /** ourFault / settled scans (in-progress ones excluded); null with none settled. */
  ourFaultRate: number | null
  /** Occurrences of each cause, by name. */
  causes: Record<string, number>
  hunt: {
    /** Scans whose hunt layer ran (RAN or PARTIAL). */
    hunted: number
    /** Of those, the ones sized for the whole diff (not `oversized`). */
    wholeDiff: number
    /** wholeDiff / hunted; null when nothing was hunted. */
    coverageRatio: number | null
  }
}

function isOversizedAudit(audit: unknown): boolean {
  if (!audit || typeof audit !== 'object') return false
  const diff = (audit as { diff?: unknown }).diff
  return (
    !!diff &&
    typeof diff === 'object' &&
    (diff as { oversized?: unknown }).oversized === true
  )
}

/** LUM-1079 — the only cause on record is the PR being too large to scan. */
function isChangeTooLargeOnly(row: ReliabilityScanRow): boolean {
  return (
    row.partialCauses.length > 0 &&
    row.partialCauses.every(c => partialCauseClass(c) === 'CHANGE_TOO_LARGE')
  )
}

function hasOurFault(row: ReliabilityScanRow, stages: string[]): boolean {
  // LUM-1079: a PR too large to scan is FAILED on the row (it vouches for
  // nothing) but is a limit on the change, not a fault of ours.
  if (isChangeTooLargeOnly(row)) return false
  if (row.status === 'FAILED') return true
  if (stages.includes('FAILED')) return true
  return row.partialCauses.some(c => partialCauseClass(c) === 'OUR_FAULT')
}

export function summarizeScanReliability(
  rows: ReadonlyArray<ReliabilityScanRow>
): ScanReliability {
  const byCoverage: Record<ScanCoverageState, number> = {
    IN_PROGRESS: 0,
    CHECKED: 0,
    UNFINISHED: 0,
    TURNED_OFF: 0,
  }
  const causes: Record<string, number> = {}
  let ourFault = 0
  let coverageOwedOnly = 0
  let changeTooLarge = 0
  let unattributed = 0
  let hunted = 0
  let wholeDiff = 0
  for (const row of rows) {
    const stageMap = row.stages ?? {}
    const coverage = scanCoverageState({
      status: row.status,
      stages: stageMap,
      partial: row.partial,
    })
    byCoverage[coverage] += 1
    for (const cause of row.partialCauses)
      causes[cause] = (causes[cause] ?? 0) + 1
    const stages = Object.values(stageMap).filter(
      (s): s is string => typeof s === 'string'
    )
    if (coverage !== 'IN_PROGRESS') {
      if (hasOurFault(row, stages)) ourFault += 1
      else if (isChangeTooLargeOnly(row)) changeTooLarge += 1
      else if (
        row.partialCauses.some(c => partialCauseClass(c) === 'COVERAGE_OWED')
      )
        coverageOwedOnly += 1
    }
    if (row.partial && row.partialCauses.length === 0) unattributed += 1
    if (stageMap.hunt === 'RAN' || stageMap.hunt === 'PARTIAL') {
      hunted += 1
      if (!isOversizedAudit(row.huntAudit)) wholeDiff += 1
    }
  }
  // LUM-892: a scan with a layer turned off in settings is settled too.
  const settled =
    byCoverage.CHECKED + byCoverage.UNFINISHED + byCoverage.TURNED_OFF
  return {
    scans: rows.length,
    byCoverage,
    ourFault,
    coverageOwedOnly,
    changeTooLarge,
    unattributed,
    ourFaultRate: settled > 0 ? ourFault / settled : null,
    causes,
    hunt: {
      hunted,
      wholeDiff,
      coverageRatio: hunted > 0 ? wholeDiff / hunted : null,
    },
  }
}

function pct(n: number | null): string {
  return n === null ? 'n/a' : `${(n * 100).toFixed(1)}%`
}

/** One plain-text block for the ops script and the log. */
export function formatScanReliability(r: ScanReliability): string {
  const causes = Object.entries(r.causes)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([c, n]) => `${c} ${n} (${partialCauseClass(c)})`)
  return [
    `scans ${r.scans} · checked ${r.byCoverage.CHECKED} · unfinished ${r.byCoverage.UNFINISHED} · turned off ${r.byCoverage.TURNED_OFF} · in progress ${r.byCoverage.IN_PROGRESS}`,
    `our fault ${r.ourFault} (${pct(r.ourFaultRate)} of settled) · coverage owed only ${r.coverageOwedOnly} · PR too large to scan ${r.changeTooLarge} · unattributed ${r.unattributed}`,
    `hunt coverage ${r.hunt.wholeDiff}/${r.hunt.hunted} whole-diff (${pct(r.hunt.coverageRatio)})`,
    `causes: ${causes.length > 0 ? causes.join(' · ') : 'none'}`,
  ].join('\n')
}

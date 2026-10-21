import { matchPathGlob } from '../../../shared/src/path-glob'
import type { LocalScanner } from './local-scan-report'
import type { ScanContext } from './scan-context'

/**
 * LUM-1256 — how the server would read each local finding, from its server
 * context. Pure.
 *
 * - FALSE_POSITIVE / ACCEPTED_RISK  a human ruled this fingerprint on one
 *   of the repository's PRs. The server copies a ruling only onto later
 *   findings of the same PR (`inherit-dispositions.ts`), so it clears the
 *   gate only when it was recorded on this branch's open PR (`carriesOver`).
 * - ON_MAIN   the fingerprint is in the default branch's baseline
 *   (persisting — never this PR's to block on).
 * - LEARNING  an active review learning covers it: the same fingerprint, or
 *   the same rule under the learning's path glob. Learnings steer the AI
 *   review only; they never clear DONE.
 * - NEW       none of the above.
 *
 * `wouldBlockDone` applies the workspace's real policy with the server's
 * own predicate (`isBlockingUnderPolicy`, ee/security/security-scan/policy.ts;
 * a parity test pins the two).
 */

export const SERVER_STATUSES = [
  'NEW',
  'ON_MAIN',
  'FALSE_POSITIVE',
  'ACCEPTED_RISK',
  'LEARNING',
] as const
export type ServerStatus = (typeof SERVER_STATUSES)[number]

export interface ServerLabel {
  status: ServerStatus
  /** Rulings: who ruled (null when the server has no name). */
  by: string | null
  /** Rulings: when (ISO). */
  at: string | null
  /** Rulings: the PR it was recorded on. */
  pullRequest: number | null
  /** Rulings: recorded on this branch's open PR, so the next scan inherits it. */
  carriesOver: boolean | null
  /** Learnings: the learning's memory id. */
  learningId: string | null
  /** Under the workspace policy, would this block the task's DONE? */
  wouldBlockDone: boolean
}

type Provenance = 'DETERMINISTIC' | 'LLM_JUDGE' | 'EXTERNAL_TOOL'
type Severity = 'LOW' | 'MEDIUM' | 'HIGH'

/** The provenance the PR scan gives each local scanner's findings. */
export const SCANNER_PROVENANCE: Record<LocalScanner, Provenance> = {
  SECRETS: 'DETERMINISTIC',
  // LUM-1257: the managed scan ingests osv-scanner's report as an external tool.
  DEPS: 'EXTERNAL_TOOL',
}

/**
 * Same predicate as the server's `isBlockingUnderPolicy`: an undispositioned,
 * non-persisting finding whose { provenance, severity } the policy lists.
 * An LLM finding never blocks.
 */
export function isBlockingUnderPolicy(
  f: {
    provenance: Provenance
    severity: Severity
    disposition: 'FALSE_POSITIVE' | 'ACCEPTED_RISK' | null
    persisting?: boolean
  },
  policy: ScanContext['policy']
): boolean {
  if (f.disposition !== null || f.persisting) return false
  if (f.provenance === 'LLM_JUDGE') return false
  return policy.block.some(
    r => r.provenance === f.provenance && r.severity === f.severity
  )
}

export interface LabelInput {
  scanner: LocalScanner
  ruleId: string
  severity: Severity
  filePath: string
  fingerprint: string
}

/** The server's reading of one local finding. */
export function labelFinding(f: LabelInput, ctx: ScanContext): ServerLabel {
  const persisting =
    ctx.baseline !== null && ctx.baseline.fingerprints.includes(f.fingerprint)
  const ruling = ctx.rulings.find(r => r.fingerprint === f.fingerprint)
  const learning = ctx.learnings.find(
    l =>
      l.fingerprint === f.fingerprint ||
      (l.pathGlob !== null &&
        l.ruleId === f.ruleId &&
        matchPathGlob(l.pathGlob, [f.filePath]))
  )
  const carriesOver = ruling
    ? ctx.pullRequest !== null && ctx.pullRequest.number === ruling.pullRequest
    : null
  const wouldBlockDone = isBlockingUnderPolicy(
    {
      provenance: SCANNER_PROVENANCE[f.scanner],
      severity: f.severity,
      disposition: ruling && carriesOver ? ruling.disposition : null,
      persisting,
    },
    ctx.policy
  )
  const base = {
    by: null,
    at: null,
    pullRequest: null,
    carriesOver: null,
    learningId: null,
    wouldBlockDone,
  }
  if (ruling)
    return {
      ...base,
      status: ruling.disposition,
      by: ruling.by,
      at: ruling.at,
      pullRequest: ruling.pullRequest,
      carriesOver,
    }
  if (persisting) return { ...base, status: 'ON_MAIN' }
  if (learning) return { ...base, status: 'LEARNING', learningId: learning.id }
  return { ...base, status: 'NEW' }
}

/** `ruled false positive by Alice on #12, 2026-10-01 (carries over)` etc. */
export function describeLabel(l: ServerLabel): string {
  let text: string
  switch (l.status) {
    case 'NEW':
      text = 'new'
      break
    case 'ON_MAIN':
      text = 'already on main'
      break
    case 'LEARNING':
      text = `suppressed by learning ${l.learningId ?? ''} (AI review only)`
      break
    default: {
      const what =
        l.status === 'FALSE_POSITIVE' ? 'ruled false positive' : 'accepted risk'
      const by = l.by ? ` by ${l.by}` : ''
      const on = l.pullRequest !== null ? ` on #${l.pullRequest}` : ''
      const at = l.at ? `, ${l.at.slice(0, 10)}` : ''
      const carry = l.carriesOver
        ? ' (this branch’s PR — carries over)'
        : ' (another PR — a new PR does not inherit it)'
      text = `${what}${by}${on}${at}${carry}`
    }
  }
  return l.wouldBlockDone ? `${text} · would block DONE` : text
}

/** One server finding as `lumo pr show --json` serves it (the fields read here). */
export interface ServerPrFinding {
  kind: string
  ruleId: string
  severity: string
  provenance: string
  filePath: string
  line: number | null
  title: string
  fingerprint?: string
  open: boolean
  disposition: string | null
}

/** The server finding kind each local scanner reproduces. */
export const SCANNER_SERVER_KIND: Record<LocalScanner, string> = {
  SECRETS: 'SECRET',
  DEPS: 'DEPENDENCY',
}

export interface PrComparison {
  /** Server findings the local scan still reports. */
  stillOpen: ServerPrFinding[]
  /** Open server findings the local scan no longer reports (fixed since the push). */
  fixedLocally: ServerPrFinding[]
  /** Open findings of the layers that run on the server only. */
  serverOnly: { aiReview: number; hunt: number }
}

/** Is this a hunt finding (`hunt:*`)? */
function isHunt(f: ServerPrFinding): boolean {
  return f.ruleId.startsWith('hunt:')
}

/**
 * Compare the PR's latest server scan with the local findings, by
 * fingerprint, for the scanners this run reproduced. Server findings
 * without a fingerprint (an older server) are matched on rule + path + line.
 */
export function comparePrFindings(
  server: ServerPrFinding[],
  local: Array<{
    ruleId: string
    filePath: string
    line: number | null
    fingerprint: string
  }>,
  scanners: LocalScanner[]
): PrComparison {
  // Each reproduced server kind, with the provenance the server gives it.
  const reproduced = new Map(
    scanners.map(s => [SCANNER_SERVER_KIND[s], SCANNER_PROVENANCE[s]])
  )
  const fps = new Set(local.map(f => f.fingerprint))
  const spots = new Set(
    local.map(f => `${f.ruleId}\n${f.filePath}\n${f.line ?? ''}`)
  )
  const stillOpen: ServerPrFinding[] = []
  const fixedLocally: ServerPrFinding[] = []
  const serverOnly = { aiReview: 0, hunt: 0 }
  for (const f of server) {
    if (isHunt(f)) {
      if (f.open) serverOnly.hunt += 1
      continue
    }
    if (f.provenance === 'LLM_JUDGE') {
      if (f.open) serverOnly.aiReview += 1
      continue
    }
    if (reproduced.get(f.kind) !== f.provenance) continue
    const matched = f.fingerprint
      ? fps.has(f.fingerprint)
      : spots.has(`${f.ruleId}\n${f.filePath}\n${f.line ?? ''}`)
    if (matched) stillOpen.push(f)
    else if (f.open) fixedLocally.push(f)
  }
  return { stillOpen, fixedLocally, serverOnly }
}

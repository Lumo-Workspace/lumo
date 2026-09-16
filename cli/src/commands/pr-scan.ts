import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { printRedactionNotice } from '../lib/redaction-notice'
import {
  formatHuntCoverageLine,
  formatScanLayerTail,
  type HuntCoverageInput,
} from '../lib/scan-format'
import {
  QUEUE_EXIT_LABELS,
  secretDowngradeNote,
  type QueueExitReason,
} from '../../../shared/src/security-scan'
import {
  formatHuntTaskDetail,
  type ShellDetailTask,
} from '../../../shared/src/hunt-audit'

export interface PrScanOptions {
  /** `owner/repo` — needed only when the number exists in several repos. */
  repo?: string | undefined
  /** Every pushed head's scan, newest first, instead of the latest only. */
  all?: boolean | undefined
  /** Emit the versioned machine-readable payload instead of prose. */
  json?: boolean | undefined
  /** Append the per-task hunt detail (commands, trace, stop, wrap-up, sites, model, diff). */
  full?: boolean | undefined
}

/** Mirrors `PullRequestScanReadout` served by GET /api/pull-requests/[number]/scans (v1). */
export interface PrScanFinding {
  id: string
  kind: string
  ruleId: string
  severity: string
  provenance: string
  filePath: string
  line: number | null
  title: string
  detail: string
  externalRef: string | null
  disposition: string | null
  dispositionSource: 'HUMAN' | 'INHERITED' | 'SUGGESTED_CONFIRMED' | null
  dispositionNote: string | null
  dispositionedAt: string | null
  blocking: boolean
  open: boolean
  persisting: boolean
  queueExit: string | null
  falsifierVerdict: string | null
  suggestedDisposition: string | null
  suggestionOutcome: string | null
  secretDowngrade: string | null
  cwe: string | null
  reachability: string | null
}

export interface PrScanHunt {
  coverage: HuntCoverageInput | null
  plannedBy: string | null
  plannedReason: string | null
  diff: {
    sourceFiles: number
    sites: number
    taskCap: number
    oversized: boolean
  } | null
  candidates: number | null
  falsifierRejects: number | null
  mechanicallyRejected: number | null
  /** LUM-798 — how the mechanical gate placed each candidate; null on older scans. */
  resolution: {
    subgraph: number
    sinkRule: number
    sandbox: number
    rejected: number
  } | null
  error: string | null
  tasks: ShellDetailTask[]
}

export interface PrScanEntry {
  id: string
  headSha: string
  status: string
  trigger: string
  judgeStatus: string | null
  truncated: boolean
  stages: Partial<Record<string, string>>
  partial: boolean
  externalFailureReason: string | null
  startedAt: string
  finishedAt: string | null
  tokenSpent: number | null
  counts: {
    findings: number
    open: number
    blocking: number
    dispositioned: number
    persisting: number
    externalFindings: number
    dependencyFindings: number
  }
  queueExits: Partial<Record<string, number>>
  findings: PrScanFinding[]
  hunt: PrScanHunt | null
}

export interface PrScanPayload {
  version: number
  pullRequest: {
    repo: string
    number: number
    title: string
    url: string
    state: string
    task: { identifier: string } | null
  }
  scans: PrScanEntry[]
  all: boolean
  /** LUM-784 — absent on an older server. */
  redactedSecrets?: number
}

/** How many hunt tasks `--full` lists per scan — a plan holds at most 5. */
const FULL_TASK_CAP = 8

/**
 * `(blocks DONE)` / `(advisory)` for an open row; the disposition and where
 * it came from for a ruled row; the LUM-775 exit or `already on main`
 * otherwise. One tag per row — the row's standing is one fact.
 */
function findingStanding(f: PrScanFinding): string {
  if (f.disposition) {
    const source =
      f.dispositionSource === 'INHERITED'
        ? 'inherited from an earlier scan of this PR'
        : f.dispositionSource === 'SUGGESTED_CONFIRMED'
          ? 'AI-suggested, human-confirmed'
          : 'human'
    const note = f.dispositionNote
      ? ` · "${sanitizeField(f.dispositionNote)}"`
      : ''
    return `${f.disposition} · ${source}${note}`
  }
  if (f.persisting) return 'already on main'
  if (f.queueExit) {
    return QUEUE_EXIT_LABELS[f.queueExit as QueueExitReason] ?? f.queueExit
  }
  return f.blocking ? 'blocks DONE' : 'advisory'
}

/** Same line grammar as the `[SECURITY]` next-action rows of `lumo task status`. */
function formatFinding(f: PrScanFinding): string {
  const where = f.line == null ? f.filePath : `${f.filePath}:${f.line}`
  const note = sanitizeField(secretDowngradeNote(f.secretDowngrade))
  const falsifier = f.falsifierVerdict
    ? ` · falsifier ${f.falsifierVerdict}`
    : ''
  const suggestion =
    f.disposition === null && f.suggestedDisposition
      ? ` · AI suggests ${f.suggestedDisposition}`
      : ''
  return `[${f.severity}] ${f.provenance} ${sanitizeField(f.ruleId)} — ${sanitizeField(where)} — ${sanitizeField(f.title)}${note} (${findingStanding(f)}${falsifier}${suggestion})`
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function formatTokens(n: number | null): string {
  // null = not metered (team rule: null ≠ 0) — say so rather than print 0.
  return n === null
    ? 'tokens not metered'
    : `${n.toLocaleString('en-US')} tokens`
}

function formatHuntHeader(h: PrScanHunt): string {
  const parts: string[] = []
  if (h.plannedBy) {
    parts.push(
      `planned by ${sanitizeField(h.plannedBy)}${h.plannedReason ? ` — ${sanitizeField(h.plannedReason)}` : ''}`
    )
  }
  if (h.diff) {
    parts.push(
      `diff ${plural(h.diff.sourceFiles, 'source file', 'source files')} · ${plural(h.diff.sites, 'site', 'sites')} · task cap ${h.diff.taskCap}${h.diff.oversized ? ' · oversized (a corner of the diff was covered)' : ''}`
    )
  }
  if (h.candidates !== null) parts.push(`candidates ${h.candidates}`)
  if (h.mechanicallyRejected !== null)
    parts.push(`mechanically rejected ${h.mechanicallyRejected}`)
  // LUM-798 — the same drop, broken out by what placed the candidate. Reading
  // "rejected 23 of 23" off a scan is what told us the gate had never judged
  // anything; the breakdown is what says whether that has changed.
  if (h.resolution) {
    const r = h.resolution
    parts.push(
      `resolved by subgraph ${r.subgraph} · sink rule ${r.sinkRule} · sandbox ${r.sandbox} · rejected ${r.rejected}`
    )
  }
  if (h.falsifierRejects !== null)
    parts.push(`falsifier rejects ${h.falsifierRejects}`)
  if (h.error) parts.push(`error: ${sanitizeField(h.error)}`)
  return parts.length === 0
    ? 'Hunt: (no audit recorded)'
    : `Hunt: ${parts.join(' · ')}`
}

function formatScan(s: PrScanEntry, full: boolean): string[] {
  const lines: string[] = []
  const finished = s.finishedAt
    ? ` · finished ${s.finishedAt}`
    : ' · not finished'
  lines.push(
    `Scan ${sanitizeField(s.headSha.slice(0, 7))} · ${s.status} · started ${s.startedAt}${finished} · trigger ${sanitizeField(s.trigger)} · ${formatTokens(s.tokenSpent)}${s.truncated ? ' · diff truncated for AI review' : ''}`
  )
  const tail = formatScanLayerTail({
    stages: s.stages,
    partial: s.partial,
    externalFindings: s.counts.externalFindings,
    dependencyFindings: s.counts.dependencyFindings,
    persistingFindings: s.counts.persisting,
    queueExits: s.queueExits,
    externalFailureReason: s.externalFailureReason,
  })
  // The tail starts with ` · `; on its own line the leading separator goes.
  if (tail) lines.push(`  ${tail.replace(/^ · /, '')}`)
  if (s.hunt?.coverage && s.hunt.coverage.categories.length > 0) {
    lines.push(`    ${formatHuntCoverageLine(s.hunt.coverage)}`)
  }
  const c = s.counts
  if (c.findings === 0) {
    lines.push('  Findings: none on this scan')
  } else {
    const breakdown = [
      `${c.open} open`,
      `${c.blocking} block${c.blocking === 1 ? 's' : ''} DONE`,
      `${c.dispositioned} dispositioned`,
    ]
    if (c.persisting > 0) breakdown.push(`${c.persisting} already on main`)
    lines.push(`  Findings: ${c.findings} (${breakdown.join(' · ')})`)
    for (const f of s.findings) lines.push(`    ${formatFinding(f)}`)
  }
  if (full && s.hunt) {
    lines.push(`  ${formatHuntHeader(s.hunt)}`)
    for (const l of formatHuntTaskDetail(s.hunt.tasks, FULL_TASK_CAP)) {
      lines.push(`    ${l}`)
    }
    if (s.hunt.tasks.length === 0) lines.push('    (no per-task audit rows)')
  }
  return lines
}

/**
 * Render the read-out as prose. The PR header first (repo, state, linked
 * task or none), then one block per scan, newest first. A PR with no scan
 * says so in the fail-closed wording of `lumo task status` — never an
 * implicit "clean".
 */
export function formatPrScan(
  data: PrScanPayload,
  opts: { full?: boolean | undefined } = {}
): string {
  const pr = data.pullRequest
  const lines: string[] = []
  lines.push(
    `PR #${pr.number} · ${sanitizeField(pr.repo)} · ${sanitizeField(pr.state)} · ${pr.task ? `task ${sanitizeField(pr.task.identifier)}` : 'no linked task'}`
  )
  lines.push(sanitizeField(pr.title))
  lines.push(sanitizeField(pr.url))
  if (data.scans.length === 0) {
    lines.push('')
    lines.push(
      `⚠ No security scan has run for PR #${pr.number} — could not confirm it is clean.`
    )
    return lines.join('\n') + '\n'
  }
  if (data.all) {
    lines.push('')
    lines.push(
      `${plural(data.scans.length, 'scan', 'scans')} on record, newest first`
    )
  }
  for (const s of data.scans) {
    lines.push('')
    lines.push(...formatScan(s, opts.full === true))
  }
  return lines.join('\n') + '\n'
}

/**
 * `lumo pr scan <number> [--repo owner/repo] [--all] [--json] [--full]`
 *
 * The security scans of one PR in the workspace, by PR number — linked to a
 * task or not. Reads `GET /api/pull-requests/:number/scans`; read-only.
 * Disposition stays web-only (LUM-750's CLI path was rolled back).
 */
export async function prScan(
  numberArg: string | undefined,
  opts: PrScanOptions = {}
): Promise<number | void> {
  if (!numberArg || !/^\d+$/.test(numberArg.trim())) {
    console.error(
      'Error: usage: lumo pr scan <number> [--repo owner/repo] [--all] [--json] [--full]'
    )
    return 1
  }
  if (opts.repo !== undefined && !/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) {
    console.error(`Error: --repo must be owner/repo, got "${opts.repo}"`)
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)
  const query = new URLSearchParams()
  if (opts.repo) query.set('repo', opts.repo)
  if (opts.all) query.set('all', '1')
  const qs = query.toString()
  const url = `${base}/api/pull-requests/${encodeURIComponent(numberArg.trim())}/scans${qs ? `?${qs}` : ''}`

  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (res.status === 404) {
    console.error(
      `Error: PR #${numberArg}${opts.repo ? ` in ${opts.repo}` : ''} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string
      repos?: string[]
    }
    console.error(
      `Error: ${sanitizeField(body.error ?? `PR #${numberArg} exists in several repos`)}`
    )
    for (const r of body.repos ?? []) {
      console.error(`  lumo pr scan ${numberArg} --repo ${sanitizeField(r)}`)
    }
    return 1
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    console.error(
      `Error: pr scan failed (HTTP ${res.status})${body.error ? `: ${sanitizeField(body.error)}` : ''}`
    )
    return 1
  }

  const data = (await res.json()) as PrScanPayload
  if (opts.json) {
    // JSON.stringify escapes control characters, so the payload is safe to
    // print as-is; the version field is the consumer's contract.
    process.stdout.write(JSON.stringify(data, null, 2) + '\n')
    return
  }
  printRedactionNotice(data.redactedSecrets)
  process.stdout.write(formatPrScan(data, { full: opts.full }))
}

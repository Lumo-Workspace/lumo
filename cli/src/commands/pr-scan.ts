import { EXIT_USAGE } from '../lib/exit-codes'
import { NONE, fmtCount, fmtEnum, fmtTimestamp } from '../lib/format'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { isMissingPluginRoute, missingPluginMessage } from '../lib/plugin-route'
import { printRedactionNotice } from '../lib/redaction-notice'
import {
  formatPathSkipLines,
  formatSizeCapLines,
  formatScanStatus,
  formatTurnedOffLines,
  formatScanningOffLines,
  scanFields,
  type JudgeBudgetLine,
  type JudgeOverCapLine,
  type JudgePartialLine,
  type PrTooLargeLine,
  type ReviewPathSkipsLine,
  type HuntCoverageInput,
} from '../lib/scan-format'
import {
  QUEUE_EXIT_LABELS,
  QUEUE_EXIT_REASONS,
  isCodeReviewFinding,
  isRewardHackFinding,
  secretDowngradeNote,
  type QueueExitReason,
} from '../../../shared/src/security-scan'
import {
  formatHuntTaskDetail,
  type ShellDetailTask,
} from '../../../shared/src/hunt-audit'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'
import {
  bulletLines,
  commandLine,
  fieldLines,
  labelWidth,
  sectionHeading,
  wrapLines,
  type Field,
  type LayoutOptions,
} from '../lib/report-layout'
import { colorEnabled, enumColor, heading, terminalWidth } from '../lib/ui'

/** `lumo pr show` — read-only (LUM-1233 3d; was `pr scan`). */
export interface PrShowOptions {
  /** `owner/repo` — needed only when the number exists in several repos. */
  repo?: string | undefined
  /** Every pushed head's scan, newest first, instead of the latest only. */
  all?: boolean | undefined
  /** Emit the versioned machine-readable payload instead of prose. */
  json?: boolean | undefined
  /** Append the per-task hunt detail (commands, trace, stop, wrap-up, sites, model, diff). */
  full?: boolean | undefined
}

/** `lumo pr review` — the write half of the former `pr scan`. */
export interface PrReviewOptions {
  /** A full review instead of the default incremental one. */
  full?: boolean | undefined
  pause?: boolean | undefined
  resume?: boolean | undefined
  limit?: string | undefined
  repo?: string | undefined
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
  /** LUM-988 — the agentic verifier's verdict / reason. Absent on an older server. */
  verifierVerdict?: string | null
  verifierReason?: string | null
  secretDowngrade: string | null
  cwe: string | null
  reachability: string | null
  /** LUM-1189 — the hunt's source→sink edges; absent on an older server. */
  callChain?: Array<{ from: string; to: string }> | null
  /** LUM-1189 — edges past the server's cap, not listed; absent on an older server. */
  callChainOmitted?: number
  /** LUM-1189 — why the falsifier suggested its disposition; absent on an older server. */
  suggestedReason?: string | null
  /** LUM-1256 — the finding's fingerprint; absent on an older server. */
  fingerprint?: string
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
  /**
   * LUM-798 — how the mechanical gate placed each candidate; null on older
   * scans. `legacy` rows counted a placement only when the candidate also
   * survived every later check, so their tier numbers are not comparable
   * with a `placement` row's and the read-out says which it is looking at.
   */
  resolution:
    | {
        kind: 'placement'
        placed: { subgraph: number; sinkRule: number; sandbox: number }
        unplaced: number
        accepted: number
        rejected: number
      }
    | {
        kind: 'legacy'
        subgraph: number
        sinkRule: number
        sandbox: number
        rejected: number
      }
    | null
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
  /** LUM-832 — absent on an older server. */
  partialCauses?: string[]
  /** LUM-832 — the file cap left files out; absent on an older server. */
  huntOverCap?: { sourceFiles: number; capFiles: number } | null
  /** LUM-832 — the AI review did not run: over its size cap; absent on an older server. */
  judgeOverCap?: JudgeOverCapLine | null
  /** LUM-1144 — the AI review read part of an over-cap diff; absent on an older server. */
  judgePartial?: JudgePartialLine | null
  /** LUM-1079 — the whole PR was too large to scan; absent on an older server. */
  prTooLarge?: PrTooLargeLine | null
  /** LUM-1215 — what the path filters left out of the AI review; absent on an older server. */
  reviewPathSkips?: ReviewPathSkipsLine | null
  externalFailureReason: string | null
  startedAt: string
  finishedAt: string | null
  tokenSpent: number | null
  /** LUM-814 — the judge's budget arithmetic; absent on an older server, null = not recorded. */
  judgeBudget?: JudgeBudgetLine | null
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

/**
 * LUM-1137 — `3/5 commits reviewed`, `12 commits reviewed · never pauses`;
 * an older server counted review rounds (`1/2 rounds`).
 */
export function formatReviewBudget(c: {
  rounds: number
  limit: number
  unit?: 'commits'
}): string {
  if (c.unit !== 'commits') return `${c.rounds}/${c.limit} rounds`
  if (c.limit === 0) return `${c.rounds} commits reviewed · never pauses`
  return `${c.rounds}/${c.limit} commits reviewed`
}

export interface PrScanPayload {
  reviewControl?: {
    paused: boolean
    /** Reviewed commits (LUM-1137); review rounds on an older server. */
    rounds: number
    /** 0 = never pauses (LUM-1137). */
    limit: number
    /** LUM-1137 — absent on an older server, which counted rounds. */
    unit?: 'commits'
    currentHead: string | null
  }
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
  /** LUM-901 — the workspace has scanning off; absent on an older server. */
  scanningOff?: boolean
}

/**
 * The `Findings` row's breakdown. `open`, `block(s) DONE` (a subset of open)
 * and `dispositioned` keep their place; every other row lands in exactly one
 * extra bucket — already on main, each queue exit (`merged unreviewed` …),
 * or rejected by the verifier — so the buckets besides `block DONE` add up
 * to the total (LUM-1116: merged-unreviewed rows used to fall through).
 */
export function findingsBreakdown(
  c: { open: number; blocking: number; dispositioned: number },
  findings: PrScanFinding[]
): string[] {
  const parts = [
    `${c.open} open`,
    `${c.blocking} block${c.blocking === 1 ? 's' : ''} DONE`,
    `${c.dispositioned} dispositioned`,
  ]
  let persisting = 0
  let rejected = 0
  let other = 0
  const exits = new Map<string, number>()
  for (const f of findings) {
    if (f.disposition !== null || f.open) continue
    // Same precedence as each row's `Standing:` line (findingStanding).
    if (f.persisting) persisting++
    else if (f.verifierVerdict === 'REJECTED') rejected++
    else if (f.queueExit)
      exits.set(f.queueExit, (exits.get(f.queueExit) ?? 0) + 1)
    // A state this build does not know (a newer server): still counted so
    // the row adds up, but never given a reason it may not have.
    else other++
  }
  if (persisting > 0) parts.push(`${persisting} already on main`)
  // Same order as the `Queue` row; a reason this build does not know last.
  const known = QUEUE_EXIT_REASONS as readonly string[]
  const order = [
    ...known.filter(k => exits.has(k)),
    ...[...exits.keys()].filter(k => !known.includes(k)),
  ]
  for (const reason of order)
    parts.push(
      `${exits.get(reason)} ${QUEUE_EXIT_LABELS[reason as QueueExitReason] ?? sanitizeField(reason)}`
    )
  if (rejected > 0) parts.push(`${rejected} rejected by verifier`)
  if (other > 0) parts.push(`${other} other`)
  return parts
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
  // LUM-988: not open, not commented on the PR — the reason is the evidence.
  if (f.verifierVerdict === 'REJECTED') {
    const reason = f.verifierReason
      ? ` — "${sanitizeField(f.verifierReason)}"`
      : ''
    return `rejected by verifier${reason}`
  }
  if (f.queueExit) {
    return QUEUE_EXIT_LABELS[f.queueExit as QueueExitReason] ?? f.queueExit
  }
  return f.blocking ? 'blocks DONE' : 'advisory'
}

/**
 * One finding as an item (LUM-1091): the title on the bullet line, then
 * labelled rows — rule + provenance, where, and its standing (with the
 * falsifier verdict and the AI suggestion when present). Same facts as the
 * `[SECURITY]` items of `lumo task status`; an AI-review correctness finding
 * (`review:<kind>`) leads with `[BUG]` there and here (LUM-988).
 */
function findingLines(f: PrScanFinding, opts: LayoutOptions): string[] {
  const where = f.line == null ? f.filePath : `${f.filePath}:${f.line}`
  const note = sanitizeField(secretDowngradeNote(f.secretDowngrade))
  // LUM-1234: an agent-behavior finding is `[AGENT]`, never a security one.
  const bug = isRewardHackFinding(f.ruleId)
    ? '[AGENT] '
    : isCodeReviewFinding(f.ruleId)
      ? '[BUG] '
      : ''
  const fields: Field[] = [
    {
      label: 'Rule',
      value: `${sanitizeField(f.ruleId)} (${f.provenance})`,
    },
    { label: 'Where', value: sanitizeField(where) },
    { label: 'Standing', value: `${findingStanding(f)}${note}` },
  ]
  if (f.falsifierVerdict)
    fields.push({ label: 'Falsifier', value: f.falsifierVerdict })
  // LUM-1189: a rejection is already the row's standing; a confirmation is
  // said here with its reason, as the web panel does.
  if (f.verifierVerdict === 'CONFIRMED')
    fields.push({
      label: 'Verifier',
      value: `CONFIRMED${f.verifierReason ? ` — "${sanitizeField(f.verifierReason)}"` : ''}`,
    })
  if (f.disposition === null && f.suggestedDisposition)
    fields.push({
      label: 'AI suggests',
      value: `${sanitizeField(f.suggestedDisposition)}${f.suggestedReason ? ` — "${sanitizeField(f.suggestedReason)}"` : ''}`,
    })
  const chain = f.callChain ?? []
  const omitted = f.callChainOmitted ?? 0
  if (chain.length > 0)
    fields.push({
      label: 'Call chain',
      value: plural(chain.length + omitted, 'edge', 'edges'),
    })
  return [
    ...bulletLines(`${bug}[${f.severity}] ${sanitizeField(f.title)}`, 4, opts),
    ...fieldLines(fields, 6, opts),
    ...callChainLines(chain, opts, omitted),
  ]
}

/**
 * LUM-1189 — the call chain one edge per line under its row, numbered, the
 * same `from → to` edges the web panel lists. Hops are scanner output:
 * sanitized here as well as on the server.
 */
export function callChainLines(
  chain: ReadonlyArray<{ from: string; to: string }>,
  opts: LayoutOptions = {},
  /** Edges past the server's cap — said once after the list, never numbered. */
  omitted = 0
): string[] {
  const lines = chain.flatMap((edge, i) =>
    wrapLines(
      `${i + 1}. ${sanitizeField(edge.from)} → ${sanitizeField(edge.to)}`,
      8,
      opts
    )
  )
  if (chain.length > 0 && omitted > 0)
    lines.push(
      ...wrapLines(
        `… ${plural(omitted, 'more edge', 'more edges')} not shown`,
        8,
        opts
      )
    )
  return lines
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function formatTokens(n: number | null): string {
  // null = not metered (team rule: null ≠ 0): `-`, never 0 (LUM-1232 V-1).
  return n === null ? NONE : fmtCount(n)
}

/** The hunt's audit header (`--full`) as labelled rows (LUM-1091). */
function huntAuditFields(h: PrScanHunt): Field[] {
  const fields: Field[] = []
  if (h.plannedBy) {
    fields.push({
      label: 'Planned by',
      value: `${sanitizeField(h.plannedBy)}${h.plannedReason ? ` — ${sanitizeField(h.plannedReason)}` : ''}`,
    })
  }
  if (h.diff) {
    fields.push({
      label: 'Diff',
      value: `${plural(h.diff.sourceFiles, 'source file', 'source files')} · ${plural(h.diff.sites, 'site', 'sites')} · task cap ${h.diff.taskCap}${h.diff.oversized ? ' · this run was sized for fewer files than the diff — the rest is still on us' : ''}`,
    })
  }
  if (h.candidates !== null)
    fields.push({ label: 'Candidates', value: String(h.candidates) })
  if (h.mechanicallyRejected !== null)
    fields.push({
      label: 'Mechanically rejected',
      value: String(h.mechanicallyRejected),
    })
  // LUM-798 — the same drop, broken out by what placed the candidate. Reading
  // "rejected 23 of 23" off a scan is what told us the gate had never judged
  // anything; the breakdown is what says whether that has changed.
  if (h.resolution?.kind === 'placement') {
    const r = h.resolution
    fields.push(
      {
        label: 'Placed by',
        value: `subgraph ${r.placed.subgraph} · sink rule ${r.placed.sinkRule} · sandbox ${r.placed.sandbox} · unplaced ${r.unplaced}`,
      },
      {
        label: 'Outcome',
        value: `survived ${r.accepted} · rejected ${r.rejected}`,
      }
    )
  } else if (h.resolution) {
    const r = h.resolution
    fields.push({
      label: 'Resolved by',
      value: `subgraph ${r.subgraph} · sink rule ${r.sinkRule} · sandbox ${r.sandbox} · rejected ${r.rejected} (legacy tally — placements counted only on acceptance)`,
    })
  }
  if (h.falsifierRejects !== null)
    fields.push({
      label: 'Falsifier rejects',
      value: String(h.falsifierRejects),
    })
  if (h.error) fields.push({ label: 'Error', value: sanitizeField(h.error) })
  return fields
}

/**
 * The shared per-task printer's lines, re-based so the report stays three
 * levels deep: a task line at 4, its commands / steps / stop at 6. A command
 * the gate let through has a blank mark column there (`✗` = refused); it is
 * shown as `-` so the line does not start deeper than three levels.
 */
function huntTaskLines(tasks: PrScanHunt['tasks']): string[] {
  return formatHuntTaskDetail(tasks, FULL_TASK_CAP).map(l => {
    if (!l.startsWith('    ')) return `    ${l}`
    const rest = l.slice(4)
    return rest.startsWith('  ') ? `      - ${rest.slice(2)}` : `      ${rest}`
  })
}

function formatScan(
  s: PrScanEntry,
  full: boolean,
  scanningOff: boolean,
  opts: LayoutOptions
): string[] {
  const lines = sectionHeading(
    `Scan ${sanitizeField(s.headSha.slice(0, 7))} · ${enumColor(formatScanStatus(s.status, s.stages, scanningOff, s.prTooLarge != null), opts.color === true)}`,
    opts
  )
  const meta: Field[] = [
    { label: 'Started', value: fmtTimestamp(s.startedAt) },
    {
      label: 'Finished',
      value: s.finishedAt ? fmtTimestamp(s.finishedAt) : 'not finished',
    },
    { label: 'Trigger', value: sanitizeField(s.trigger) },
    { label: 'Tokens', value: formatTokens(s.tokenSpent) },
  ]
  // LUM-814: the judge's budget arithmetic sits under the AI review row —
  // printed whenever the layer exists, including when it was not truncated:
  // "reviewed whole with 2.2% of the tier left" is a fact the `truncated`
  // boolean could never carry.
  const layers = scanFields(
    {
      status: s.status,
      stages: s.stages,
      partial: s.partial,
      partialCauses: s.partialCauses,
      huntOverCap: s.huntOverCap,
      judgeOverCap: s.judgeOverCap,
      judgePartial: s.judgePartial,
      prTooLarge: s.prTooLarge,
      externalFindings: s.counts.externalFindings,
      dependencyFindings: s.counts.dependencyFindings,
      persistingFindings: s.counts.persisting,
      queueExits: s.queueExits,
      externalFailureReason: s.externalFailureReason,
    },
    {
      judgeBudget: s.judgeBudget ?? null,
      hunt: s.hunt?.coverage ?? null,
      truncated: s.truncated,
    }
  )
  const c = s.counts
  let findingsValue: string
  if (c.findings === 0 && s.prTooLarge) {
    // LUM-1079: nothing ran — "none" would read as a clean result.
    findingsValue = 'none — nothing in this PR was scanned'
  } else if (c.findings === 0) {
    findingsValue = 'none on this scan'
  } else {
    findingsValue = `${c.findings} (${findingsBreakdown(c, s.findings).join(' · ')})`
  }
  const findingsRow: Field[] = [{ label: 'Findings', value: findingsValue }]
  const w = labelWidth([...meta, ...layers, ...findingsRow])
  lines.push(...fieldLines([...meta, ...layers], 2, opts, w))
  // LUM-832: the file cap, stated plainly as a limit on the change.
  // LUM-892: layers turned off in settings — the customer's choice, said so.
  // LUM-1215: files the path filters skipped — a default never hides a file.
  for (const l of [
    ...formatSizeCapLines(s),
    ...formatPathSkipLines(s),
    ...formatTurnedOffLines(s.stages),
  ])
    lines.push(...wrapLines(l, 2, opts))
  lines.push(...fieldLines(findingsRow, 2, opts, w))
  if (c.findings > 0)
    for (const f of s.findings) lines.push(...findingLines(f, opts))
  if (full && s.hunt) {
    const audit = huntAuditFields(s.hunt)
    lines.push('  Hunt audit:')
    if (audit.length === 0) lines.push('    (no audit recorded)')
    else lines.push(...fieldLines(audit, 4, opts))
    lines.push('  Hunt tasks:')
    if (s.hunt.tasks.length === 0) lines.push('    (no per-task audit rows)')
    else lines.push(...huntTaskLines(s.hunt.tasks))
  }
  return lines
}

/**
 * Render the read-out as prose. The PR header first (repo, state, linked
 * task or none, URL), the AI-review controls, then one block per scan,
 * newest first. A PR with no scan says so in the fail-closed wording of
 * `lumo task status` — never an implicit "clean". LUM-1091: headings over
 * labelled rows, commands on their own lines, prose wrapped.
 */
export function formatPrScan(
  data: PrScanPayload,
  opts: {
    full?: boolean | undefined
    width?: number | undefined
    color?: boolean | undefined
    /** LUM-1232 D-4: `false` = piped, no hard wrapping. */
    tty?: boolean | undefined
  } = {}
): string {
  const layout: LayoutOptions = {
    width: opts.width,
    color: opts.color,
    tty: opts.tty,
  }
  const pr = data.pullRequest
  const lines: string[] = [
    heading(`PR #${pr.number}  ${sanitizeField(pr.title)}`, {
      color: layout.color === true,
    }),
    ...fieldLines(
      [
        { label: 'Repo', value: sanitizeField(pr.repo) },
        {
          label: 'State',
          value: enumColor(
            fmtEnum(sanitizeField(pr.state)),
            layout.color === true
          ),
        },
        {
          label: 'Task',
          value: pr.task ? sanitizeField(pr.task.identifier) : 'no linked task',
        },
        { label: 'URL', value: sanitizeField(pr.url) },
      ],
      2,
      layout
    ),
  ]
  // LUM-901: said before any scan, so an older result is read as older.
  for (const l of formatScanningOffLines(data.scanningOff))
    lines.push(...wrapLines(`⚠ ${l}`, 0, layout))
  if (data.reviewControl) {
    const c = data.reviewControl
    const base = `lumo pr review ${pr.number} --repo ${sanitizeField(pr.repo)}`
    lines.push(...sectionHeading('AI review', layout))
    lines.push(
      ...fieldLines(
        [
          {
            label: 'Automatic',
            value: `${c.paused ? 'paused' : 'enabled'} · ${formatReviewBudget(c)}`,
          },
        ],
        2,
        layout
      ),
      '  Run a review now (incremental, or --full):',
      commandLine(base, 4),
      commandLine(`${base} --full`, 4),
      '  Resume automatic review:',
      commandLine(`${base} --resume`, 4)
    )
    if (c.currentHead && data.scans[0]?.headSha !== c.currentHead)
      lines.push(
        ...wrapLines(
          '⚠ Latest head has no scan yet; the results below are for an earlier commit.',
          2,
          layout
        )
      )
  }
  if (data.scans.length === 0) {
    lines.push('')
    lines.push(
      ...wrapLines(
        `⚠ No security scan has run for PR #${pr.number} — could not confirm it is clean.`,
        0,
        layout
      )
    )
    return lines.join('\n') + '\n'
  }
  if (data.all) {
    lines.push('')
    lines.push(
      `${plural(data.scans.length, 'scan', 'scans')} on record, newest first`
    )
  }
  for (const s of data.scans)
    lines.push(
      ...formatScan(s, opts.full === true, data.scanningOff === true, layout)
    )
  return lines.join('\n') + '\n'
}

/** The scans URL of PR `numberArg`, or a usage error. Pure. */
function scansUrl(
  base: string,
  numberArg: string | undefined,
  repo: string | undefined,
  usage: string,
  all = false
): { ok: true; url: string; number: string } | { ok: false; error: string } {
  if (!numberArg || !/^\d+$/.test(numberArg.trim()))
    return { ok: false, error: `usage: ${usage}` }
  if (repo !== undefined && !/^[\w.-]+\/[\w.-]+$/.test(repo))
    return { ok: false, error: `--repo must be owner/repo, got "${repo}"` }
  const query = new URLSearchParams()
  if (repo) query.set('repo', repo)
  if (all) query.set('all', '1')
  const qs = query.toString()
  const n = numberArg.trim()
  return {
    ok: true,
    number: n,
    url: `${base}/api/pull-requests/${encodeURIComponent(n)}/scans${qs ? `?${qs}` : ''}`,
  }
}

/** Shared error mapping for both PR commands; returns the exit code or null. */
async function prError(
  res: Response,
  number: string,
  repo: string | undefined,
  label: string,
  workspaceSlug: string | undefined
): Promise<number | null> {
  if (res.status === 401) {
    console.error(errAuth())
    return 1
  }
  // LUM-1062: no scans route at all — a server without the security plugin.
  if (isMissingPluginRoute(res)) {
    console.error(missingPluginMessage(label, 'security'))
    return 1
  }
  if (res.status === 404) {
    console.error(
      `Error: PR #${number}${repo ? ` in ${repo}` : ''} not found in workspace ${workspaceSlug}`
    )
    return 1
  }
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string
      repos?: string[]
    }
    console.error(
      `Error: ${sanitizeField(body.error ?? `PR #${number} exists in several repos`)}`
    )
    for (const r of body.repos ?? [])
      console.error(`  lumo ${label} ${number} --repo ${sanitizeField(r)}`)
    return 1
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    console.error(errHttp(label, res.status, body.error))
    return 1
  }
  return null
}

const SHOW_USAGE =
  'lumo pr show <number> [--repo owner/repo] [--all] [--json] [--full]'

/**
 * `lumo pr show <number> [--repo owner/repo] [--all] [--json] [--full]`
 * (LUM-1233 3d; was `pr scan`). The security scans of one PR in the
 * workspace, by PR number — linked to a task or not. Reads
 * `GET /api/pull-requests/:number/scans`; strictly read-only. Request or
 * pause a review with `lumo pr review`; rule on a finding with
 * `lumo finding disposition` (LUM-1128).
 */
export async function prShow(
  numberArg: string | undefined,
  opts: PrShowOptions = {}
): Promise<number | void> {
  const creds = readCredentials()
  const target = scansUrl(
    '',
    numberArg,
    opts.repo,
    SHOW_USAGE,
    opts.all === true
  )
  if (!target.ok) {
    console.error(`Error: ${target.error}`)
    return EXIT_USAGE
  }
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const url = trimTrailingSlash(apiUrl) + target.url

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
  const code = await prError(
    res,
    target.number,
    opts.repo,
    'pr show',
    creds.workspaceSlug
  )
  if (code !== null) return code

  const data = (await res.json()) as PrScanPayload
  if (opts.json) {
    // JSON.stringify escapes control characters, so the payload is safe to
    // print as-is; the version field is the consumer's contract.
    process.stdout.write(JSON.stringify(data, null, 2) + '\n')
    return
  }
  printRedactionNotice(data.redactedSecrets)
  process.stdout.write(
    formatPrScan(data, {
      full: opts.full,
      width: terminalWidth(),
      tty: Boolean(process.stdout.isTTY),
      color: colorEnabled(),
    })
  )
}

const REVIEW_USAGE =
  'lumo pr review <number> [--full | --pause | --resume] [--limit <commits>] [--repo owner/repo]'

/** Usage problems of the review flags (null = fine). Pure. */
export function prReviewUsageError(opts: PrReviewOptions): string | null {
  const modes = [opts.full, opts.pause, opts.resume].filter(Boolean).length
  if (modes > 1) return 'choose one of --full, --pause, --resume'
  if (opts.limit !== undefined) {
    if (!(opts.pause || opts.resume))
      return '--limit goes with --pause or --resume'
    if (
      !/^\d+$/.test(opts.limit) ||
      Number(opts.limit) < 1 ||
      Number(opts.limit) > 100
    )
      return `--limit must be 1..100, got "${opts.limit}"`
  }
  return null
}

/**
 * `lumo pr review <number> [--full | --pause | --resume] [--limit N]`
 * (LUM-1233 3d; the write half of the former `pr scan`): request an
 * incremental (default) or full AI review without counting toward the
 * automatic budget, or pause / resume automatic review of every push.
 */
export async function prReview(
  numberArg: string | undefined,
  opts: PrReviewOptions = {}
): Promise<number | void> {
  const usage = prReviewUsageError(opts)
  if (usage) {
    console.error(`Error: ${usage}. Usage: ${REVIEW_USAGE}`)
    return EXIT_USAGE
  }
  const target = scansUrl('', numberArg, opts.repo, REVIEW_USAGE)
  if (!target.ok) {
    console.error(`Error: ${target.error}`)
    return EXIT_USAGE
  }
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const action = opts.pause
    ? 'pause'
    : opts.resume
      ? 'resume'
      : opts.full
        ? 'full'
        : 'incremental'
  let res: Response
  try {
    res = await fetch(trimTrailingSlash(apiUrl) + target.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action,
        ...(opts.limit !== undefined ? { limit: Number(opts.limit) } : {}),
      }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }
  const code = await prError(
    res,
    target.number,
    opts.repo,
    'pr review',
    creds.workspaceSlug
  )
  if (code !== null) return code
  process.stdout.write(
    (action === 'pause' || action === 'resume'
      ? `Automatic AI review ${action === 'pause' ? 'paused' : 'resumed (every push is reviewed again; reviewed-commit count reset)'} for PR #${target.number}.`
      : `Queued ${action} review for PR #${target.number}.`) + '\n'
  )
}

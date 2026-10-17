import { EXIT_USAGE } from '../lib/exit-codes'
import { fmtCount, fmtDay, fmtTokens } from '../lib/format'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import {
  errAuth,
  errHttp,
  errNotLoggedIn,
  httpFailed,
  warn,
} from '../lib/errors'

type Outcome = 'MERGED' | 'REJECTED' | 'REWORKED' | 'UNKNOWN'
type Disclosure = 'FULL' | 'INDEX'

interface LineageCost {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  total: number
  loopCount: number
}
interface LineageFragmentEntry {
  fragmentType: string
  fragmentId: string
  sourceLabel: string
  outcome: Outcome
  used: boolean | null
  disclosure: Disclosure
  pulled: boolean
}
interface LineageGroup {
  kind: 'session' | 'orphan'
  sessionId: string | null
  label: string
  includedAt: string
  cost: LineageCost | null
  fragments: LineageFragmentEntry[]
}
export interface LineageResponse {
  task: { identifier: string; title: string; status: string }
  totals: {
    runCount: number
    fragmentCount: number
    edgeCount: number
    tokens: {
      input: number
      output: number
      cacheRead: number
      cacheCreation: number
      total: number
    }
    loopCount: number
    outcomes: Record<Outcome, number>
    funnel: {
      impressions: number
      index: number
      pulled: number
      used: number
      /** LUM-522: tokens saved over un-pulled INDEX edges; null = no token data. */
      tokensSaved?: number | null
    }
    /** LUM-523: Top-5 most expensive operations (tools) by token cost. */
    topOperations: {
      tool: string
      total: number
      /** LUM-840: per-command rows under a `Bash · <purpose>` row. */
      commands?: { command: string; total: number }[]
    }[]
  }
  groups: LineageGroup[]
}

/** Local copy — the CLI is a separate package and must NOT import from app types/. */
export interface UsageSignalHealth {
  distribution: { used: number; unused: number; abstained: number }
  perSessionVariance: number
  votedSessions: number
  usedMergeRate: number | null
  baseMergeRate: number | null
  usedResolvedTasks: number
  baseResolvedTasks: number
  usedFailedTasks: number
  baseFailedTasks: number
  spinoffsDuringInFlight: number
  disclosureFunnel: {
    impressions: number
    index: number
    pulled: number
    used: number
    /** LUM-522: tokens saved over un-pulled INDEX edges; null = no token data. */
    tokensSaved?: number | null
  }
}

export async function taskLineage(
  identifier: string | undefined,
  opts?: { signal?: boolean }
): Promise<number | void> {
  if (!identifier) {
    console.error(
      'Error: missing <identifier>. Usage: lumo task lineage <LUM-42>'
    )
    return EXIT_USAGE
  }

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const url = `${trimTrailingSlash(apiUrl)}/api/tasks/lineage/${encodeURIComponent(identifier)}`

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
    console.error(errAuth())
    return 1
  }
  if (res.status === 404) {
    console.error(
      `Error: task ${identifier} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!res.ok) {
    console.error(errHttp('lineage fetch', res.status))
    return 1
  }

  const data = (await res.json()) as LineageResponse
  process.stdout.write(formatLineageMarkdown(data))

  if (opts?.signal) {
    const signalUrl = `${trimTrailingSlash(apiUrl)}/api/lineage/signal`
    let signalRes: Response
    try {
      signalRes = await fetch(signalUrl, {
        headers: { Authorization: `Bearer ${creds.token}` },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(warn(`could not fetch signal health (${msg})\n`))
      return
    }
    if (!signalRes.ok) {
      process.stderr.write(
        warn(`${httpFailed('signal health fetch', signalRes.status)}\n`)
      )
      return
    }
    const signalJson = (await signalRes.json()) as UsageSignalHealth
    process.stdout.write('\n' + formatSignalHealth(signalJson) + '\n')
  }
}

/** Integer percentage, 0 when the denominator is 0 (never NaN). */
function pct(num: number, den: number): number {
  return den === 0 ? 0 : Math.round((num / den) * 100)
}

const OUTCOME_ORDER: Outcome[] = ['MERGED', 'REWORKED', 'REJECTED', 'UNKNOWN']

/** "2 MERGED · 1 UNKNOWN", fixed order, zeros omitted. */
function outcomeSummary(counts: Record<Outcome, number>): string {
  const parts = OUTCOME_ORDER.filter(o => counts[o] > 0).map(
    o => `${counts[o]} ${o}`
  )
  return parts.join(' · ')
}

function fragmentOutcomeCounts(
  fragments: LineageFragmentEntry[]
): Record<Outcome, number> {
  const c: Record<Outcome, number> = {
    MERGED: 0,
    REJECTED: 0,
    REWORKED: 0,
    UNKNOWN: 0,
  }
  for (const f of fragments) c[f.outcome] += 1
  return c
}

function usageMarker(used: boolean | null): string {
  return used === true ? '✓' : used === false ? '✗' : '·'
}

/**
 * Render a LineageResponse as the audit-facing markdown trail. Pure function
 * (no clock / env) so the CLI output is deterministic and unit-testable.
 */
export function formatLineageMarkdown(data: LineageResponse): string {
  const lines: string[] = []
  lines.push(
    `# Lineage: ${data.task.identifier} — ${sanitizeField(data.task.title)}`
  )
  lines.push(`**Status**: ${data.task.status}`)
  lines.push('')

  if (data.groups.length === 0) {
    // LUM-559: an empty report is fail-closed — it means no session ever bound
    // to this task, so neither its cost nor its causal trail could be measured.
    // Say "not measured" explicitly; never let the blank read as "zero cost".
    lines.push(
      '_Cost not measured — no session was ever bound to this task, so its ' +
        'cost and causal trail could not be recorded. This is "not measured", ' +
        'not "zero cost". Cost and lineage are captured once a session binds ' +
        '(`lumo session attach <id>`) and consumes the context; bind before ' +
        'working so future runs are recorded._'
    )
    lines.push('')
    return lines.join('\n')
  }

  const t = data.totals
  lines.push('## Totals')
  lines.push(`- Runs/sessions: ${t.runCount}`)
  lines.push(`- Fragments: ${t.fragmentCount}`)
  lines.push(`- Edges: ${t.edgeCount}`)
  lines.push(
    // LUM-1232 N-2: a summary line is compact; exact counts are in --json.
    `- Tokens: ${fmtTokens(t.tokens.total)} ` +
      `(input ${fmtTokens(t.tokens.input)} · output ${fmtTokens(t.tokens.output)} · ` +
      `cache read ${fmtTokens(t.tokens.cacheRead)} · cache write ${fmtTokens(t.tokens.cacheCreation)})`
  )
  lines.push(`- Loops: ${t.loopCount}`)
  const totalsOutcome = outcomeSummary(t.outcomes)
  if (totalsOutcome) lines.push(`- Outcomes: ${totalsOutcome}`)
  const f = t.funnel
  const fSavedSuffix =
    f.tokensSaved != null ? ` · ~${f.tokensSaved} tokens saved` : ''
  lines.push(
    `- Disclosure funnel: ${f.impressions} impressions · ` +
      `${f.index} INDEX (${pct(f.index, f.impressions)}%) · ` +
      `${f.pulled} pulled (${pct(f.pulled, f.index)}% of INDEX) · ` +
      `${f.used} used (${pct(f.used, f.impressions)}%)${fSavedSuffix}`
  )
  lines.push('')

  if (data.totals.topOperations.length > 0) {
    lines.push('')
    lines.push('Top operations by token cost:')
    for (const op of data.totals.topOperations) {
      lines.push(`  ${sanitizeField(op.tool)} — ${fmtCount(op.total)} tokens`)
      for (const c of (op.commands ?? []).slice(0, 3)) {
        lines.push(
          `    ↳ ${sanitizeField(c.command)} — ${fmtCount(c.total)} tokens`
        )
      }
    }
    lines.push('  (full breakdown: lumo cost --task <id>)')
  }

  for (const g of data.groups) {
    lines.push(`## ${sanitizeField(g.label)} · ${fmtDay(g.includedAt)}`)
    if (g.cost) {
      lines.push(
        `**Cost**: ${fmtTokens(g.cost.total)} tokens · ${g.cost.loopCount} loops`
      )
    } else {
      lines.push('**Cost**: (no captured cost)')
    }
    const summary = outcomeSummary(fragmentOutcomeCounts(g.fragments))
    lines.push(
      `**Fragments** (${g.fragments.length}${summary ? `: ${summary}` : ''}):`
    )
    // LUM-559: an edgeless cost group is a session that spent tokens but
    // recorded no fragments (it bound after session-start). Its empty trail is
    // "not captured", NOT "the session used nothing" — say so, and skip the
    // per-fragment usage legend that has nothing to annotate.
    if (g.fragments.length === 0) {
      lines.push(
        '_Causal fragments not captured — this session bound after start, so ' +
          'its cost is recorded but its fragment trail is not._'
      )
      lines.push('')
      continue
    }
    lines.push('_✓ used · · abstained · ✗ unused (manual)_')
    for (const f of g.fragments) {
      const tag =
        f.disclosure === 'INDEX'
          ? f.pulled
            ? 'INDEX pulled'
            : 'INDEX not-pulled'
          : 'FULL'
      lines.push(
        `- ${usageMarker(f.used)} [${f.outcome}] ${f.fragmentType} — ${sanitizeField(f.sourceLabel)} · ${tag}`
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}

export function formatSignalHealth(h: UsageSignalHealth): string {
  const lines: string[] = ['', '## Signal health']
  lines.push(
    `- Distribution: used ${h.distribution.used} · null ${h.distribution.abstained} · false ${h.distribution.unused}`
  )
  lines.push(
    `- Per-session variance: ${h.perSessionVariance.toFixed(2)} (${h.votedSessions} voted sessions)`
  )
  if (h.usedMergeRate !== null && h.baseMergeRate !== null) {
    if (h.baseFailedTasks === 0) {
      // No failure outcomes exist yet, so any rate is non-discriminating by
      // construction — say so honestly instead of printing a misleading 100%.
      lines.push(
        '- Used × outcome: no failure outcomes yet — metric cannot discriminate'
      )
    } else {
      lines.push(
        `- Used × outcome: merge-rate(used) ${Math.round(h.usedMergeRate * 100)}% (${h.usedResolvedTasks} resolved, ${h.usedFailedTasks} failed) vs base ${Math.round(h.baseMergeRate * 100)}% (${h.baseResolvedTasks} resolved, ${h.baseFailedTasks} failed)`
      )
    }
  } else {
    lines.push('- Used × outcome: insufficient resolved tasks')
  }
  lines.push(
    `- Spinoffs during in-flight work: ${h.spinoffsDuringInFlight} (recorded, not yet judged)`
  )
  const f = h.disclosureFunnel
  const fSavedSuffix =
    f.tokensSaved != null ? ` · ~${f.tokensSaved} tokens saved` : ''
  lines.push(
    `- Disclosure funnel: ${f.impressions} impressions · ` +
      `${f.index} INDEX (${pct(f.index, f.impressions)}%) · ` +
      `${f.pulled} pulled (${pct(f.pulled, f.index)}% of INDEX) · ` +
      `${f.used} used (${pct(f.used, f.impressions)}%)${fSavedSuffix}`
  )
  return lines.join('\n')
}

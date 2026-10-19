import { EXIT_USAGE } from '../lib/exit-codes'
import { fmtCount, fmtDay, fmtTokens } from '../lib/format'
import {
  fieldLines,
  sectionHeading,
  wrapLines,
  type Field,
  type LayoutOptions,
} from '../lib/report-layout'
import { colorEnabled, enumColor, heading, terminalWidth } from '../lib/ui'
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
import {
  detailEnvelope,
  emitJson,
  stripInternalFields,
} from '../lib/json-output'
import type { OutputSink } from '../lib/output-sink'

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
  opts?: { signal?: boolean | undefined; json?: boolean | undefined },
  out: OutputSink = process.stdout
): Promise<number | void> {
  if (!identifier) {
    console.error(
      'Error: missing <identifier>. Usage: lumo task show <LUM-42> --lineage'
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
  if (opts?.json) {
    const related: Record<string, unknown> = {}
    if (opts.signal) {
      related.signal = await fetchSignalForJson(apiUrl, creds.token)
    }
    emitJson(
      detailEnvelope(
        'lineage',
        stripInternalFields(data),
        stripInternalFields(related)
      ),
      out
    )
    return
  }
  out.write(
    formatLineageMarkdown(data, {
      width: terminalWidth(),
      color: colorEnabled(),
      tty: Boolean(process.stdout.isTTY),
    })
  )

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
    out.write('\n' + formatSignalHealth(signalJson) + '\n')
  }
}

/**
 * `--signal` under `--json`: the signal health payload, or null when it
 * cannot be read (the warning goes to stderr, as on the text path).
 */
async function fetchSignalForJson(
  apiUrl: string,
  token: string
): Promise<UsageSignalHealth | null> {
  try {
    const res = await fetch(`${trimTrailingSlash(apiUrl)}/api/lineage/signal`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      process.stderr.write(
        warn(`${httpFailed('signal health fetch', res.status)}\n`)
      )
      return null
    }
    return (await res.json()) as UsageSignalHealth
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(warn(`could not fetch signal health (${msg})\n`))
    return null
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
 * Render a LineageResponse as the audit-facing trail. Pure function (no clock
 * / env) so the CLI output is deterministic and unit-testable. LUM-1232
 * batch B (D-1–D-3, decision Q7): the plain detail layout — a `<ref>  <title>`
 * line, `Label:  value` facts, plain section headings — not Markdown.
 */
export function formatLineageMarkdown(
  data: LineageResponse,
  opts: LayoutOptions = {}
): string {
  const lines: string[] = [
    heading(`${data.task.identifier}  ${sanitizeField(data.task.title)}`, {
      color: opts.color === true,
    }),
    ...fieldLines(
      [
        {
          label: 'Status',
          value: enumColor(data.task.status, opts.color === true),
        },
      ],
      0,
      opts
    ),
  ]

  if (data.groups.length === 0) {
    // LUM-559: an empty report is fail-closed — it means no session ever bound
    // to this task, so neither its cost nor its causal trail could be measured.
    // Say "not measured" explicitly; never let the blank read as "zero cost".
    lines.push(
      '',
      ...wrapLines(
        'Cost not measured — no session was ever bound to this task, so its ' +
          'cost and causal trail could not be recorded. This is "not measured", ' +
          'not "zero cost". Cost and lineage are captured once a session binds ' +
          '(`lumo session attach <id>`) and consumes the context; bind before ' +
          'working so future runs are recorded.',
        0,
        opts
      ),
      ''
    )
    return lines.join('\n')
  }

  const t = data.totals
  const totalsOutcome = outcomeSummary(t.outcomes)
  const f = t.funnel
  const fSavedSuffix =
    f.tokensSaved != null ? ` · ~${f.tokensSaved} tokens saved` : ''
  const totals: Field[] = [
    { label: 'Runs', value: String(t.runCount) },
    { label: 'Fragments', value: String(t.fragmentCount) },
    { label: 'Edges', value: String(t.edgeCount) },
    {
      // LUM-1232 N-2: a summary line is compact; exact counts are in --json.
      label: 'Tokens',
      value:
        `${fmtTokens(t.tokens.total)} ` +
        `(input ${fmtTokens(t.tokens.input)} · output ${fmtTokens(t.tokens.output)} · ` +
        `cache read ${fmtTokens(t.tokens.cacheRead)} · cache write ${fmtTokens(t.tokens.cacheCreation)})`,
    },
    { label: 'Loops', value: String(t.loopCount) },
    ...(totalsOutcome ? [{ label: 'Outcomes', value: totalsOutcome }] : []),
    {
      label: 'Disclosure funnel',
      value:
        `${f.impressions} impressions · ` +
        `${f.index} INDEX (${pct(f.index, f.impressions)}%) · ` +
        `${f.pulled} pulled (${pct(f.pulled, f.index)}% of INDEX) · ` +
        `${f.used} used (${pct(f.used, f.impressions)}%)${fSavedSuffix}`,
    },
  ]
  lines.push(...sectionHeading('Totals', opts), ...fieldLines(totals, 2, opts))

  if (data.totals.topOperations.length > 0) {
    lines.push(...sectionHeading('Top operations by token cost', opts))
    for (const op of data.totals.topOperations) {
      lines.push(`  ${sanitizeField(op.tool)} — ${fmtCount(op.total)} tokens`)
      for (const c of (op.commands ?? []).slice(0, 3)) {
        lines.push(
          `    ↳ ${sanitizeField(c.command)} — ${fmtCount(c.total)} tokens`
        )
      }
    }
    lines.push('  (full breakdown: lumo usage show --task <id>)')
  }

  for (const g of data.groups) {
    lines.push(
      ...sectionHeading(
        `${sanitizeField(g.label)} · ${fmtDay(g.includedAt)}`,
        opts
      )
    )
    const summary = outcomeSummary(fragmentOutcomeCounts(g.fragments))
    lines.push(
      ...fieldLines(
        [
          {
            label: 'Cost',
            value: g.cost
              ? `${fmtTokens(g.cost.total)} tokens · ${g.cost.loopCount} loops`
              : '-',
          },
          {
            label: 'Fragments',
            value: `${g.fragments.length}${summary ? ` (${summary})` : ''}`,
          },
        ],
        2,
        opts
      )
    )
    // LUM-559: an edgeless cost group is a session that spent tokens but
    // recorded no fragments (it bound after session-start). Its empty trail is
    // "not captured", NOT "the session used nothing" — say so, and skip the
    // per-fragment usage legend that has nothing to annotate.
    if (g.fragments.length === 0) {
      lines.push(
        ...wrapLines(
          'Causal fragments not captured — this session bound after start, so ' +
            'its cost is recorded but its fragment trail is not.',
          2,
          opts
        )
      )
      continue
    }
    lines.push('  Legend: ✓ used · · abstained · ✗ unused (manual)')
    for (const fr of g.fragments) {
      const tag =
        fr.disclosure === 'INDEX'
          ? fr.pulled
            ? 'INDEX pulled'
            : 'INDEX not-pulled'
          : 'FULL'
      lines.push(
        `  ${usageMarker(fr.used)} [${fr.outcome}] ${fr.fragmentType} — ${sanitizeField(fr.sourceLabel)} · ${tag}`
      )
    }
  }
  lines.push('')

  return lines.join('\n')
}

export function formatSignalHealth(h: UsageSignalHealth): string {
  const lines: string[] = ['', 'Signal health']
  lines.push(
    `  Distribution: used ${h.distribution.used} · null ${h.distribution.abstained} · false ${h.distribution.unused}`
  )
  lines.push(
    `  Per-session variance: ${h.perSessionVariance.toFixed(2)} (${h.votedSessions} voted sessions)`
  )
  if (h.usedMergeRate !== null && h.baseMergeRate !== null) {
    if (h.baseFailedTasks === 0) {
      // No failure outcomes exist yet, so any rate is non-discriminating by
      // construction — say so honestly instead of printing a misleading 100%.
      lines.push(
        '  Used × outcome: no failure outcomes yet — metric cannot discriminate'
      )
    } else {
      lines.push(
        `  Used × outcome: merge-rate(used) ${Math.round(h.usedMergeRate * 100)}% (${h.usedResolvedTasks} resolved, ${h.usedFailedTasks} failed) vs base ${Math.round(h.baseMergeRate * 100)}% (${h.baseResolvedTasks} resolved, ${h.baseFailedTasks} failed)`
      )
    }
  } else {
    lines.push('  Used × outcome: insufficient resolved tasks')
  }
  lines.push(
    `  Spinoffs during in-flight work: ${h.spinoffsDuringInFlight} (recorded, not yet judged)`
  )
  const f = h.disclosureFunnel
  const fSavedSuffix =
    f.tokensSaved != null ? ` · ~${f.tokensSaved} tokens saved` : ''
  lines.push(
    `  Disclosure funnel: ${f.impressions} impressions · ` +
      `${f.index} INDEX (${pct(f.index, f.impressions)}%) · ` +
      `${f.pulled} pulled (${pct(f.pulled, f.index)}% of INDEX) · ` +
      `${f.used} used (${pct(f.used, f.impressions)}%)${fSavedSuffix}`
  )
  return lines.join('\n')
}

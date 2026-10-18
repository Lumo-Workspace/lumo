import { NONE, fmtCalendarDay } from '../lib/format'
import { withVersion } from '../lib/json-output'
import { sanitizeField } from '../lib/sanitize'
import { httpFailed } from '../lib/errors'

/**
 * LUM-649 — `lumo milestone show --changelog` (formerly `milestone changelog`; LUM-1233 3j). Assembles a milestone's DONE tasks +
 * merged PRs + frozen claimSnapshot into a structured changelog. The server
 * does the (pure, deterministic) assembly; this command renders it as human
 * markdown, or passes the raw structured payload through with `--json`.
 *
 * Honest reporting (the acceptance contract): headline counts carry a LUM-508
 * baseline (or an explicit "no baseline yet"); every claim shows provenance (or
 * an explicit "no claim recorded" / "not synthesized"); no-PR tasks render an
 * explicit "(no merged PR)" — nothing is silently dropped.
 */

export interface MilestoneChangelogOptions {
  project?: string
  json?: boolean
}

/**
 * The LUM-508 BaselineStat wire shape (a subset — the fields this renderer
 * needs). Kept as a local mirror so the CLI package doesn't reach into the
 * server-only `lib/baseline` module; the server serializes the full stat.
 */
export interface BaselineStatPayload {
  current: number | null
  base: number | null
  spread: { p25: number; p75: number } | null
  sampleSize: number
  band: 'within' | 'above' | 'below' | null
  deltaPct: number | null
  deltaKind: 'magnitude' | 'rate'
}

export type ChangelogClaimPayload =
  | {
      status: 'present'
      text: string
      source: string | null
      sessionId: string | null
    }
  | { status: 'empty' }
  | { status: 'unsynthesized' }

export interface ChangelogEntryPayload {
  identifier: string
  title: string
  prs: Array<{
    repo: string
    number: number
    title: string
    mergeCommitSha: string | null
  }>
  claim: ChangelogClaimPayload
}

export interface MilestoneChangelogPayload {
  milestone: {
    name: string
    state: 'active' | 'completed' | 'archived'
    startDate: string | null
    targetDate: string | null
  }
  headline: {
    tasksShipped: BaselineStatPayload
    prsMerged: BaselineStatPayload
  }
  entries: ChangelogEntryPayload[]
}

// Mirror of lib/baseline/types.MIN_BASELINE_SAMPLE — the honest floor below
// which a baseline is suppressed. The server fold already nulls `base` under
// this threshold; the check here is defensive so a thin baseline can never leak.
const MIN_BASELINE_SAMPLE = 3

/**
 * Render one BaselineStat as an honest inline string:
 * - real base → `4 (base 3, +33% · above)`
 * - no base / thin sample → `2 (no baseline yet)`
 * - current unmeasured → `- (no baseline yet)`
 */
export function formatBaselineStat(stat: BaselineStatPayload): string {
  const current = stat.current === null ? NONE : String(stat.current)
  const grounded =
    stat.base !== null &&
    stat.current !== null &&
    stat.sampleSize >= MIN_BASELINE_SAMPLE
  if (!grounded) {
    return `${current} (no baseline yet)`
  }
  const unit = stat.deltaKind === 'rate' ? 'pt' : '%'
  const parts: string[] = [`base ${stat.base}`]
  if (stat.deltaPct !== null) {
    const sign = stat.deltaPct > 0 ? '+' : ''
    parts.push(`${sign}${stat.deltaPct}${unit}`)
  }
  if (stat.band !== null) {
    parts.push(`· ${stat.band}`)
  }
  return `${current} (${parts.join(' ')})`
}

function formatWindow(
  startDate: string | null,
  targetDate: string | null
): string | null {
  const fmt = fmtCalendarDay
  if (startDate && targetDate) return `${fmt(startDate)} → ${fmt(targetDate)}`
  if (startDate) return `from ${fmt(startDate)}`
  if (targetDate) return `target ${fmt(targetDate)}`
  return null
}

function formatClaim(claim: ChangelogClaimPayload): string {
  switch (claim.status) {
    case 'present': {
      const tag = [claim.source, claim.sessionId].filter(Boolean).join(' · ')
      const label = tag ? `Claim [${sanitizeField(tag)}]` : 'Claim'
      return `  ${label}: ${sanitizeField(claim.text)}`
    }
    case 'empty':
      return '  Claim: (no claim recorded)'
    case 'unsynthesized':
      return '  Claim: (not synthesized)'
  }
}

function formatEntry(entry: ChangelogEntryPayload): string {
  const lines: string[] = [
    `### ${entry.identifier} — ${sanitizeField(entry.title)}`,
  ]
  if (entry.prs.length === 0) {
    lines.push('  PRs: (no merged PR)')
  } else {
    const prs = entry.prs
      .map(pr => {
        const sha = pr.mergeCommitSha
          ? ` (${pr.mergeCommitSha.slice(0, 7)})`
          : ''
        return `${pr.repo}#${pr.number} "${sanitizeField(pr.title)}"${sha}`
      })
      .join(', ')
    lines.push(`  PRs: ${prs}`)
  }
  lines.push(formatClaim(entry.claim))
  return lines.join('\n')
}

export function formatMilestoneChangelog(
  cl: MilestoneChangelogPayload
): string {
  const lines: string[] = [
    `# Changelog — ${sanitizeField(cl.milestone.name)} (${cl.milestone.state})`,
  ]
  const window = formatWindow(cl.milestone.startDate, cl.milestone.targetDate)
  if (window) lines.push(window)

  lines.push('', '## Summary')
  lines.push(`- Tasks shipped: ${formatBaselineStat(cl.headline.tasksShipped)}`)
  lines.push(`- PRs merged: ${formatBaselineStat(cl.headline.prsMerged)}`)

  lines.push('', '## Shipped')
  if (cl.entries.length === 0) {
    lines.push('No tasks delivered yet.')
  } else {
    for (const entry of cl.entries) {
      lines.push('', formatEntry(entry))
    }
  }

  return lines.join('\n')
}

/** The exact string the command prints — markdown, or raw JSON with --json. */
export function renderChangelogOutput(
  cl: MilestoneChangelogPayload,
  opts: { json?: boolean }
): string {
  return opts.json
    ? JSON.stringify(withVersion(cl), null, 2)
    : formatMilestoneChangelog(cl)
}

/**
 * LUM-1233 3j: the changelog as an aspect of `milestone show --changelog`
 * (formerly `milestone changelog`). Never rejects; `{ error }` = read failed.
 */
export async function readChangelog(
  base: string,
  token: string,
  id: string
): Promise<MilestoneChangelogPayload | { error: string }> {
  let res: Response
  try {
    res = await fetch(`${base}/api/milestones/${id}/changelog`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
  if (!res.ok) {
    let msg = httpFailed('milestone changelog', res.status)
    try {
      const b = (await res.json()) as { error?: string }
      if (b.error) msg = b.error
    } catch {
      // not JSON
    }
    return { error: msg }
  }
  return (await res.json()) as MilestoneChangelogPayload
}

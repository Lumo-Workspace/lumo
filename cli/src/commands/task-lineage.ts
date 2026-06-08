import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'

type Outcome = 'MERGED' | 'REJECTED' | 'REWORKED' | 'UNKNOWN'

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
    tokens: { input: number; output: number; cacheRead: number; cacheCreation: number; total: number }
    loopCount: number
    outcomes: Record<Outcome, number>
  }
  groups: LineageGroup[]
}

export async function taskLineage(
  identifier: string | undefined
): Promise<number | void> {
  if (!identifier) {
    console.error(
      'Error: missing <identifier>. Usage: lumo task lineage <LUM-42>'
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
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
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (res.status === 404) {
    console.error(
      `Error: task ${identifier} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!res.ok) {
    console.error(`Error: lineage fetch failed (HTTP ${res.status})`)
    return 1
  }

  const data = (await res.json()) as LineageResponse
  process.stdout.write(formatLineageMarkdown(data))
}

/** Deterministic thousands separator (no locale dependency, test-stable). */
function groupThousands(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
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

/**
 * Render a LineageResponse as the audit-facing markdown trail. Pure function
 * (no clock / env) so the CLI output is deterministic and unit-testable.
 */
export function formatLineageMarkdown(data: LineageResponse): string {
  const lines: string[] = []
  lines.push(`# Lineage: ${data.task.identifier} — ${sanitizeField(data.task.title)}`)
  lines.push(`**Status**: ${data.task.status}`)
  lines.push('')

  if (data.groups.length === 0) {
    lines.push(
      '_No lineage edges recorded yet. Lineage is captured when a ' +
        "bound session consumes this task's context; once that happens " +
        '(and a PR merges / the task closes), the causal trail and its cost ' +
        'will appear here._'
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
    `- Tokens: ${groupThousands(t.tokens.total)} ` +
      `(in ${groupThousands(t.tokens.input)} · out ${groupThousands(t.tokens.output)} · ` +
      `cache-read ${groupThousands(t.tokens.cacheRead)} · cache-create ${groupThousands(t.tokens.cacheCreation)})`
  )
  lines.push(`- Loops: ${t.loopCount}`)
  const totalsOutcome = outcomeSummary(t.outcomes)
  if (totalsOutcome) lines.push(`- Outcomes: ${totalsOutcome}`)
  lines.push('')

  for (const g of data.groups) {
    lines.push(`## ${sanitizeField(g.label)} · ${g.includedAt.slice(0, 10)}`)
    if (g.cost) {
      lines.push(
        `**Cost**: ${groupThousands(g.cost.total)} tokens · ${g.cost.loopCount} loops`
      )
    } else {
      lines.push('**Cost**: (no captured cost)')
    }
    const summary = outcomeSummary(fragmentOutcomeCounts(g.fragments))
    lines.push(
      `**Fragments** (${g.fragments.length}${summary ? `: ${summary}` : ''}):`
    )
    for (const f of g.fragments) {
      lines.push(
        `- [${f.outcome}] ${f.fragmentType} — ${sanitizeField(f.sourceLabel)}`
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}

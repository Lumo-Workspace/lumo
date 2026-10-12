import { fmtDay } from '../lib/format'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveMilestoneId } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'

/**
 * LUM-643: milestone-level exit criteria — the close contract. Unlike task
 * criteria there is no checkpointer / machine loop: each row carries a
 * two-valued adjudication (MET | NOT_MET, blank = pending) stamped by the
 * steward (LUM-640) or a human.
 */
export interface ExitCriterionRow {
  id: string
  statement: string
  referentKind: 'EXTERNAL_FACT' | 'AGENT_CONSTRUCTED_STATE' | 'PENDING_OUTCOME'
  source: 'AGENT_DRAFT' | 'HUMAN_EDIT' | 'REVIEW_ADDED'
  verdict: 'MET' | 'NOT_MET' | null
  verdictNote: string | null
  verdictEvidence: string | null
  verdictAt: string | null
}

/**
 * Render exit-criterion rows for stdout. One line per criterion —
 * `<id>  [MET|NOT_MET|PENDING]  SOURCE ⟨REFERENT⟩  statement` — plus an
 * indented verdict detail line when adjudicated. Shared by `criteria list`,
 * the `criteria set` echo and `criteria verdict`.
 */
export function formatExitCriteriaRows(criteria: ExitCriterionRow[]): string {
  const lines: string[] = []
  for (const c of criteria) {
    const verdict = c.verdict ?? 'PENDING'
    lines.push(
      `${c.id}  [${verdict}]  ${c.source} ⟨${c.referentKind}⟩  ${sanitizeField(c.statement)}`
    )
    if (c.verdict) {
      const parts: string[] = []
      if (c.verdictAt) parts.push(`at ${fmtDay(c.verdictAt)}`)
      if (c.verdictEvidence)
        parts.push(`evidence: ${sanitizeField(c.verdictEvidence)}`)
      if (c.verdictNote) parts.push(`note: ${sanitizeField(c.verdictNote)}`)
      if (parts.length > 0) lines.push(`  ↳ ${parts.join(' · ')}`)
    }
  }
  return lines.length > 0 ? lines.join('\n') + '\n' : ''
}

export interface MilestoneCriteriaListOptions {
  project?: string
}

/** `lumo milestone criteria list <milestone>` — print the exit contract. */
export async function milestoneCriteriaList(
  identifier: string,
  opts: MilestoneCriteriaListOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let resolved: { id: string }
  try {
    resolved = await resolveMilestoneId(
      base,
      creds.token,
      identifier,
      opts.project
    )
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  let res: Response
  try {
    res = await fetch(`${base}/api/milestones/${resolved.id}/criteria`, {
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
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string
    } | null
    console.error(errHttp('exit-criteria list', res.status, body?.error))
    return 1
  }

  const data = (await res.json()) as {
    criteria: ExitCriterionRow[]
    unresolvedCount: number
  }
  if (data.criteria.length === 0) {
    process.stdout.write(
      `No exit criteria on this milestone — draft them and submit with lumo milestone criteria set ${identifier} --file <criteria.json>\n`
    )
    return
  }
  process.stdout.write(formatExitCriteriaRows(data.criteria))
  process.stdout.write(
    data.unresolvedCount === 0
      ? 'All exit criteria MET — the close gate is open.\n'
      : `${data.unresolvedCount} unresolved (pending or NOT_MET) — the close gate refuses status→COMPLETED until adjudicated (human override only via web).\n`
  )
}

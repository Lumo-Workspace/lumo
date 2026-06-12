import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'

export interface CriterionRow {
  id: string
  statement: string
  verifierType: 'MACHINE' | 'HUMAN'
  checkpointer: string | null
  evidenceRequired: boolean
  /** Agent-drafted human-judging guidance for a HUMAN criterion (LUM-465). */
  judgeSteps?: string | null
  source: 'AGENT_DRAFT' | 'HUMAN_EDIT' | 'REVIEW_ADDED'
  addedAtRound: number
}

/**
 * Render criteria rows for stdout. One line per criterion —
 * `<id>  [TYPE]  SOURCE@rN  statement` — plus an indented checkpointer line
 * when present. Shared by `criteria list` and the `criteria set` echo so the
 * agent always sees the ids it needs for a later `--human` revision.
 */
export function formatCriteriaRows(criteria: CriterionRow[]): string {
  const lines: string[] = []
  for (const c of criteria) {
    const provenance = `${c.source}@r${c.addedAtRound}`
    const evidence = c.evidenceRequired ? '  [evidence]' : ''
    lines.push(
      `${c.id}  [${c.verifierType}]  ${provenance}${evidence}  ${sanitizeField(c.statement)}`
    )
    if (c.checkpointer) {
      lines.push(`  ↳ check: ${sanitizeField(c.checkpointer)}`)
    }
    if (c.judgeSteps) {
      const judgeLines = sanitizeField(c.judgeSteps).split('\n')
      lines.push(`  ↳ judge: ${judgeLines[0]}`)
      for (const jl of judgeLines.slice(1)) lines.push(`           ${jl}`)
    }
  }
  return lines.length > 0 ? lines.join('\n') + '\n' : ''
}

/** `lumo task criteria list <task>` — print a task's acceptance contract. */
export async function taskCriteriaList(
  identifier: string | undefined
): Promise<number | void> {
  if (!identifier) {
    console.error(
      'Error: missing <task>. Usage: lumo task criteria list <LUM-42>'
    )
    return 1
  }
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(identifier)}/criteria`,
      { headers: { Authorization: `Bearer ${creds.token}` } }
    )
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
    console.error(`Error: criteria list failed (HTTP ${res.status})`)
    return 1
  }

  const data = (await res.json()) as {
    criteria: CriterionRow[]
    warning: string | null
  }
  if (data.criteria.length === 0) {
    process.stdout.write(
      `No acceptance criteria on ${identifier} — draft 3–7 and submit with lumo task criteria set ${identifier} --file <criteria.json>\n`
    )
    return
  }
  process.stdout.write(formatCriteriaRows(data.criteria))
  if (data.warning) {
    process.stdout.write(`⚠ ${sanitizeField(data.warning)}\n`)
  }
}

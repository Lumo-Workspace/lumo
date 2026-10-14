import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveMilestoneId } from '../lib/resolve'
import { readFileUtf8, unreadableFileMessage } from '../lib/doc-input'
import { checkArtifactFilePath } from '../lib/path-guard'
import {
  formatExitCriteriaRows,
  type ExitCriterionRow,
} from './milestone-criteria-list'
import { resolveSessionId } from '../lib/session-id'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'

const REFERENT_KINDS = [
  'EXTERNAL_FACT',
  'AGENT_CONSTRUCTED_STATE',
  'PENDING_OUTCOME',
] as const

/**
 * Client-side shape gate: fail fast on obviously malformed JSON before the
 * round-trip. Full validation stays server-side. The file is a JSON array;
 * one object per criterion: { statement, referentKind } — no verifierType /
 * checkpointer (milestone exit criteria are adjudicated, not machine-run).
 */
export function parseExitCriteriaJson(
  raw: string
): { ok: true; items: unknown[] } | { ok: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return {
      ok: false,
      error: `file is not valid JSON (${err instanceof Error ? err.message : String(err)})`,
    }
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'file must be a JSON array of criteria' }
  }
  if (parsed.length === 0) {
    return { ok: false, error: 'file contains an empty array' }
  }
  for (const [i, item] of parsed.entries()) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: `item ${i} is not an object` }
    }
    const o = item as Record<string, unknown>
    if (typeof o.statement !== 'string' || o.statement.trim() === '') {
      return { ok: false, error: `item ${i} is missing "statement"` }
    }
    if (
      typeof o.referentKind !== 'string' ||
      !(REFERENT_KINDS as readonly string[]).includes(o.referentKind)
    ) {
      return {
        ok: false,
        error: `item ${i} needs "referentKind" — one of ${REFERENT_KINDS.join(' | ')}`,
      }
    }
  }
  return { ok: true, items: parsed }
}

export interface MilestoneCriteriaSetOptions {
  project?: string
  file?: string
  human?: boolean
}

/**
 * `lumo milestone criteria set <milestone> --file <criteria.json> [--human]`
 * — submit the whole exit contract (LUM-643, full-group replace; adjudicated
 * rows are tombstoned server-side so their verdict trail survives). Default
 * source is AGENT_DRAFT (the steward draft); `--human` records a transcribed
 * HUMAN_EDIT revision. Locked with 409 once the milestone is COMPLETED.
 */
export async function milestoneCriteriaSet(
  identifier: string,
  opts: MilestoneCriteriaSetOptions
): Promise<number | void> {
  if (!opts.file) {
    console.error(
      'Error: --file <criteria.json> is required. The file is a JSON array of { statement, referentKind }.'
    )
    return 1
  }
  const pathVerdict = checkArtifactFilePath(opts.file)
  if (!pathVerdict.ok) {
    if (pathVerdict.reason === 'unreadable') {
      console.error(`Error: ${unreadableFileMessage(opts.file)}`)
    } else {
      console.error(
        `Error: refusing to read ${opts.file} — ${pathVerdict.detail}. ` +
          `criteria --file must be a non-sensitive path inside the project directory.`
      )
    }
    return 1
  }
  let raw: string
  try {
    raw = await readFileUtf8(pathVerdict.resolved)
  } catch {
    console.error(`Error: ${unreadableFileMessage(opts.file)}`)
    return 1
  }
  const parsed = parseExitCriteriaJson(raw)
  if (!parsed.ok) {
    console.error(`Error: ${parsed.error}`)
    return 1
  }

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

  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.token}`,
    'Content-Type': 'application/json',
  }
  // Steward/session provenance (LUM-640) — recorded on each drafted row.
  const sessionId = await resolveSessionId({ write: true })
  if (sessionId) headers['X-Lumo-Session-Id'] = sessionId

  let res: Response
  try {
    res = await fetch(`${base}/api/milestones/${resolved.id}/criteria`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        source: opts.human ? 'HUMAN_EDIT' : 'AGENT_DRAFT',
        criteria: parsed.items,
      }),
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
    console.error(errHttp('exit-criteria set', res.status, body?.error))
    return 1
  }

  const data = (await res.json()) as { criteria: ExitCriterionRow[] }
  process.stdout.write(
    `Exit contract set (${data.criteria.length} criteria) — adjudicate with lumo milestone criteria verdict\n`
  )
  process.stdout.write(formatExitCriteriaRows(data.criteria))
}

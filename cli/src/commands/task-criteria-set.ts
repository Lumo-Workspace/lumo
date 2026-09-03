import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { readFileUtf8, unreadableFileMessage } from '../lib/doc-input'
import { checkArtifactFilePath } from '../lib/path-guard'
import { sanitizeField } from '../lib/sanitize'
import { formatCriteriaRows, type CriterionRow } from './task-criteria-list'

type SubmittedItem = {
  statement: string
  checkpointer?: string | null
}

/**
 * Landing-integrity read-back (LUM-602): a 200 OK proves absence of error,
 * not presence of correct content. Compare what the server stored (echoed in
 * the PUT response) field-by-field against what we submitted; any divergence
 * means the value was corrupted in transport/landing.
 */
export function verifyReadback(
  submitted: SubmittedItem[],
  stored: CriterionRow[]
): string[] {
  const issues: string[] = []
  const storedByStatement = new Map(stored.map(c => [c.statement, c]))
  for (const s of submitted) {
    const got = storedByStatement.get(s.statement)
    if (!got) {
      issues.push(
        `criterion not found after write: "${s.statement.slice(0, 60)}"`
      )
      continue
    }
    const wantCk = s.checkpointer ?? null
    if ((got.checkpointer ?? null) !== wantCk) {
      issues.push(
        `checkpointer corrupted in landing for "${s.statement.slice(0, 40)}": sent ${JSON.stringify(wantCk)}, stored ${JSON.stringify(got.checkpointer ?? null)}`
      )
    }
    // LUM-733: referentKind is derived server-side from the checkpointer, so a
    // submitted declaration is advisory and never compared on read-back.
  }
  return issues
}

export interface CriteriaSetOptions {
  file?: string
  human?: boolean
  /** Drift cause for a --human revision — recorded in the activity payload. */
  cause?: string
}

const CAUSE_TAGS = [
  'NEW_INFO',
  'SCOPE_CHANGE',
  'DRAFT_BLIND_SPOT',
  'GRANULARITY',
  'OTHER',
] as const

interface CriteriaResponse {
  criteria: CriterionRow[]
  /** Soft warning when a HUMAN criterion has no judgeSteps (LUM-465). */
  judgeStepsWarning?: string | null
}

/** Client-side shape gate: fail fast on obviously malformed JSON before the
 * round-trip. Full validation (statement length, MACHINE→checkpointer …)
 * stays server-side. */
function parseCriteriaJson(
  raw: string
): { ok: true; items: unknown[] } | { ok: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'file is not valid JSON' }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return {
      ok: false,
      error:
        'expected a non-empty JSON array of criteria, e.g. [{"statement":"…","verifierType":"MACHINE","checkpointer":"npx jest …"}]',
    }
  }
  return { ok: true, items: parsed }
}

/**
 * `lumo task criteria set <task> --file <criteria.json> [--human]`
 *
 * Submit a task's whole acceptance contract. Default = the agent's initial
 * draft (AGENT_DRAFT, locked once submitted — the server rejects a second
 * agent draft). `--human` records a HUMAN_EDIT revision: the file is the
 * desired final list, items carrying an `id` keep/update that criterion,
 * items without `id` are new, and existing criteria missing from the file
 * are deleted (refused for criteria with recorded verification runs).
 */
export async function taskCriteriaSet(
  identifier: string | undefined,
  options: CriteriaSetOptions
): Promise<number | void> {
  if (!identifier) {
    console.error(
      'Error: missing <task>. Usage: lumo task criteria set <LUM-42> --file criteria.json'
    )
    return 1
  }
  if (!options.file) {
    console.error(
      'Error: --file <path> is required (a JSON array of criteria).'
    )
    return 1
  }

  const verdict = checkArtifactFilePath(options.file)
  if (!verdict.ok) {
    if (verdict.reason === 'unreadable') {
      console.error(`Error: ${unreadableFileMessage(options.file)}`)
    } else {
      console.error(
        `Error: refusing to read ${options.file} — ${verdict.detail}. ` +
          `criteria --file must be a non-sensitive path inside the project directory.`
      )
    }
    return 1
  }

  let raw: string
  try {
    raw = await readFileUtf8(verdict.resolved)
  } catch {
    console.error(`Error: ${unreadableFileMessage(options.file)}`)
    return 1
  }
  const parsed = parseCriteriaJson(raw)
  if (!parsed.ok) {
    console.error(`Error: ${parsed.error}`)
    return 1
  }

  let causeTag: string | undefined
  if (options.cause !== undefined) {
    if (!options.human) {
      console.error(
        'Error: --cause annotates contract drift and requires --human.'
      )
      return 1
    }
    causeTag = options.cause.toUpperCase()
    if (!(CAUSE_TAGS as readonly string[]).includes(causeTag)) {
      console.error(
        `Error: invalid --cause "${options.cause}". One of: ${CAUSE_TAGS.join(' | ')}`
      )
      return 1
    }
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.token}`,
    'Content-Type': 'application/json',
  }
  // Session provenance for HUMAN_EDIT transcriptions — the server records the
  // revision (with this session id) as a task comment.
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID
  if (sessionId) headers['X-Lumo-Session-Id'] = sessionId

  // LUM-437: when a contract already exists, preserve criterion identity across
  // an after-start edit by matching submitted items to existing criteria by exact
  // statement and attaching their ids. Best-effort — fall back to id-less submit.
  let criteriaItems: unknown[] = parsed.items
  if (!options.human) {
    try {
      const listRes = await fetch(
        `${base}/api/tasks/${encodeURIComponent(identifier)}/criteria`,
        { headers: { Authorization: `Bearer ${creds.token}` } }
      )
      if (listRes.ok) {
        const listData = (await listRes.json()) as { criteria: CriterionRow[] }
        const activeByStatement = new Map(
          listData.criteria.map(c => [c.statement, c.id])
        )
        criteriaItems = parsed.items.map(item => {
          if (item !== null && typeof item === 'object' && !('id' in item)) {
            const stmt = (item as Record<string, unknown>)['statement']
            if (typeof stmt === 'string' && activeByStatement.has(stmt)) {
              return { ...item, id: activeByStatement.get(stmt) }
            }
          }
          return item
        })
      }
    } catch {
      // leave criteriaItems as-is; the server still records via full diff
    }
  }

  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(identifier)}/criteria`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          source: options.human ? 'HUMAN_EDIT' : 'AGENT_DRAFT',
          criteria: criteriaItems,
          ...(causeTag ? { causeTag } : {}),
        }),
      }
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
    const body = (await res.json().catch(() => null)) as {
      error?: unknown
    } | null
    const detail =
      body && typeof body.error === 'string' ? sanitizeField(body.error) : ''
    console.error(
      `Error: criteria set failed (HTTP ${res.status})${detail ? ` — ${detail}` : ''}`
    )
    return 1
  }

  const data = (await res.json()) as CriteriaResponse
  process.stdout.write(
    options.human
      ? `Recorded HUMAN_EDIT contract revision on ${identifier} (${data.criteria.length} criteria)\n`
      : `Acceptance contract drafted on ${identifier} (${data.criteria.length} criteria) — locked for agent edits; human revisions via --human\n`
  )
  process.stdout.write(formatCriteriaRows(data.criteria))
  if (data.judgeStepsWarning) {
    process.stdout.write(`⚠ ${sanitizeField(data.judgeStepsWarning)}\n`)
  }

  const readbackIssues = verifyReadback(
    criteriaItems as SubmittedItem[],
    data.criteria
  )
  if (readbackIssues.length > 0) {
    for (const issue of readbackIssues) {
      console.error(`⚠ landing-integrity: ${sanitizeField(issue)}`)
    }
    console.error(
      'Error: stored contract does not match what was submitted — do not trust the success receipt. Re-run and verify.'
    )
    return 1
  }
}

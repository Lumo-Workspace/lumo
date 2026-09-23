import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveMilestoneId } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'
import {
  formatExitCriteriaRows,
  type ExitCriterionRow,
} from './milestone-criteria-list'
import {
  resolveCriterionRef,
  type CriterionSelectorResult,
} from '../lib/criterion-selector'

export interface MilestoneCriteriaVerdictOptions {
  project?: string
  met?: boolean
  unmet?: boolean
  note?: string
  evidence?: string
}

/**
 * Resolve a criterion selector (full id or a >=6-char unique id prefix)
 * against the milestone's active contract. Ambiguous / unknown selectors
 * list candidates and fail — mirrors `task deps` edge selection.
 *
 * LUM-815: the matching rules now live in `../lib/criterion-selector` (the
 * task-side `testcase --criterion` resolver needs exactly the same ones).
 * This wrapper keeps the milestone-flavoured error hint and the two-argument
 * signature its callers and tests already use.
 */
export function resolveCriterionSelector(
  selector: string,
  criteria: Array<{ id: string; statement: string }>
): CriterionSelectorResult {
  return resolveCriterionRef(selector, criteria, 'lumo milestone criteria list')
}

/**
 * `lumo milestone criteria verdict <milestone> <criterion> --met|--unmet`
 * — adjudicate (裁定) one exit criterion (LUM-643). The steward session
 * (LUM-640) is the intended adjudicating subject; who/when/session are
 * stamped server-side. Grounding gate: `--met` on an EXTERNAL_FACT criterion
 * requires `--evidence`, and a PENDING_OUTCOME criterion can never be MET —
 * both rejected with 422 server-side.
 */
export async function milestoneCriteriaVerdict(
  identifier: string,
  criterionSelector: string,
  opts: MilestoneCriteriaVerdictOptions
): Promise<number | void> {
  if (opts.met === opts.unmet) {
    console.error('Error: pass exactly one of --met or --unmet')
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
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

  // Fetch the active contract to resolve the criterion selector client-side.
  let listRes: Response
  try {
    listRes = await fetch(`${base}/api/milestones/${resolved.id}/criteria`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }
  if (!listRes.ok) {
    console.error(`Error: exit-criteria list failed (HTTP ${listRes.status})`)
    return 1
  }
  const { criteria } = (await listRes.json()) as {
    criteria: ExitCriterionRow[]
  }
  const selector = resolveCriterionSelector(criterionSelector, criteria)
  if (!selector.ok) {
    console.error(`Error: ${selector.error}`)
    return 1
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.token}`,
    'Content-Type': 'application/json',
  }
  // Adjudicating-session provenance (LUM-640) — stamped on the verdict.
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID
  if (sessionId) headers['X-Lumo-Session-Id'] = sessionId

  let res: Response
  try {
    res = await fetch(
      `${base}/api/milestones/${resolved.id}/criteria/${selector.id}/verdict`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          verdict: opts.met ? 'MET' : 'NOT_MET',
          ...(opts.note ? { note: opts.note } : {}),
          ...(opts.evidence ? { evidence: opts.evidence } : {}),
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
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string
    } | null
    console.error(
      `Error: verdict failed (HTTP ${res.status})${body?.error ? `: ${sanitizeField(body.error)}` : ''}`
    )
    return 1
  }

  const data = (await res.json()) as { criterion: ExitCriterionRow }
  process.stdout.write(
    `Adjudicated ${data.criterion.verdict} on exit criterion:\n`
  )
  process.stdout.write(formatExitCriteriaRows([data.criterion]))
}

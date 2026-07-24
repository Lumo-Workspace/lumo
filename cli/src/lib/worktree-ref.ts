import { readCredentials } from './config'
import { resolveAuthedApiUrl, trimTrailingSlash } from './api'
import { normalizeTaskId } from './worktree'

/** Subset of GET /api/teams rows the bare-number resolver needs. */
interface TeamRow {
  identifier: string
  isDefault?: boolean
}

/**
 * Resolve a user-supplied worktree ref to a canonical `<TEAM>-<n>` id.
 *
 * - Explicit prefix (`SPEC-12`, `lum-267`) → normalized locally, NO network.
 * - Bare number (`267`) → completed with the workspace's DEFAULT team prefix
 *   (GET /api/teams: the `isDefault` team, or the sole team in a single-team
 *   workspace). Worktree tooling is otherwise purely local; the API is touched
 *   only to disambiguate a prefix-less number.
 *
 * Returns null when `raw` is not a task-id shape at all (caller prints the
 * "expected <TEAM>-N" usage error). Throws Error with a user-facing message
 * when a bare number needs the default team but it can't be determined
 * (not logged in / offline / ambiguous multi-team without a default) — every
 * message points the user at passing an explicit prefix instead.
 */
export async function resolveWorktreeTaskId(
  raw: string
): Promise<string | null> {
  const explicit = normalizeTaskId(raw)
  if (explicit) return explicit

  const bare = raw.trim().match(/^(\d+)$/)
  if (!bare) return null
  const n = bare[1]!

  const creds = readCredentials()
  if (!creds) {
    throw new Error(
      `a bare number needs your default team prefix — run \`lumo auth login\`, or pass an explicit id like LUM-${n}`
    )
  }

  const base = trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl))
  let teams: TeamRow[]
  try {
    const res = await fetch(`${base}/api/teams`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    ;({ teams } = (await res.json()) as { teams: TeamRow[] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      `could not resolve the default team for bare id "${n}" (${msg}) — pass an explicit id like LUM-${n}`
    )
  }

  const def =
    teams.find(t => t.isDefault) ?? (teams.length === 1 ? teams[0] : undefined)
  if (!def) {
    throw new Error(
      `workspace has multiple teams and no default — pass an explicit id like SPEC-${n} instead of a bare number`
    )
  }
  return `${def.identifier.toUpperCase()}-${n}`
}

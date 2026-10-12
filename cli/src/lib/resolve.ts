import { AUTH_INVALID_MESSAGE, httpFailed } from './errors'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

interface ProjectRow {
  id: string
  name: string
  isIdea?: boolean
}

interface MilestoneRow {
  id: string
  name: string
  status: string
}

/**
 * Mirror of `lib/utils/slugify` (server). Single source of truth for CLI
 * slugification — must match the server byte-for-byte so a slug printed by
 * `lumo project list` resolves correctly when passed as `--project <slug>`.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

async function fetchJson<T>(
  base: string,
  token: string,
  path: string
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not reach Lumo API at ${base} (${msg})`)
  }
  if (res.status === 401) {
    throw new Error(AUTH_INVALID_MESSAGE)
  }
  if (!res.ok) {
    throw new Error(httpFailed('Request', res.status, path))
  }
  return (await res.json()) as T
}

/**
 * Resolve `--project <ref>` to a project id.
 * - `ref` undefined and workspace has 1 visible project → auto-select
 * - `ref` undefined and workspace has >1 visible project → throw
 * - `ref` set → match by name or slug, case-insensitive
 */
export async function resolveProjectId(
  base: string,
  token: string,
  ref: string | undefined
): Promise<string> {
  const { projects } = await fetchJson<{ projects: ProjectRow[] }>(
    base,
    token,
    '/api/projects'
  )
  const visible = projects.filter(p => !p.isIdea)

  if (!ref) {
    if (visible.length === 0) throw new Error('workspace has no projects yet.')
    if (visible.length === 1) return visible[0]!.id
    throw new Error('workspace has multiple projects; pass --project <slug>.')
  }

  const needle = ref.trim().toLowerCase()
  const match = visible.find(
    p => p.name.toLowerCase() === needle || slugify(p.name) === needle
  )
  if (!match) {
    throw new Error(`project "${ref}" not found. Try \`lumo project list\`.`)
  }
  return match.id
}

interface TeamRow {
  id: string
  name: string
  identifier: string
}

/**
 * Resolve `--team <ref>` to a team id + name.
 * - `ref` undefined and workspace has 1 visible team → auto-select
 * - `ref` undefined and workspace has >1 visible team → throw
 * - `ref` is a UUID → return as-is (no fetch)
 * - `ref` set → match by name or identifier (slug), case-insensitive
 */
export async function resolveTeamId(
  base: string,
  token: string,
  ref: string | undefined
): Promise<{ id: string; name: string }> {
  if (ref !== undefined && isUuid(ref)) {
    return { id: ref, name: '' }
  }

  const { teams } = await fetchJson<{ teams: TeamRow[] }>(
    base,
    token,
    '/api/teams'
  )

  if (!ref) {
    if (teams.length === 0) throw new Error('workspace has no teams yet.')
    if (teams.length === 1) return { id: teams[0]!.id, name: teams[0]!.name }
    throw new Error('workspace has multiple teams; pass --team <slug>.')
  }

  const needle = ref.trim().toLowerCase()
  const match = teams.find(
    t =>
      t.name.toLowerCase() === needle || t.identifier.toLowerCase() === needle
  )
  if (!match) {
    throw new Error(`team "${ref}" not found. Try \`lumo team list\`.`)
  }
  return { id: match.id, name: match.name }
}

interface SprintByNumberResponse {
  sprint: { id: string; number: number; name: string; teamId: string }
  progress: { done: number; total: number }
}

/**
 * Resolve a sprint `<identifier>`:
 * - If it's a UUID, return { id, number: 0, name: '', teamId: '' } — caller
 *   fetches /api/sprints/<id> for full data.
 * - If it's a positive integer, look up via /api/sprints/by-number scoped
 *   to the caller's workspace.
 *
 * The /by-number endpoint hardcodes the product assumption that a workspace
 * has at most one sprints-enabled team. If that constraint is ever lifted,
 * this function will need a `--team` disambiguation step.
 *
 * `teamRef` is used to soften the disambiguation hint when --team was already
 * attempted; today the endpoint still disambiguates via workspace_url only.
 */
export async function resolveSprintId(
  base: string,
  token: string,
  identifier: string,
  teamRef: string | undefined,
  workspaceSlug: string
): Promise<{ id: string; number: number; name: string; teamId: string }> {
  if (isUuid(identifier)) {
    return { id: identifier, number: 0, name: '', teamId: '' }
  }

  const n = Number(identifier)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(
      `sprint "${identifier}" must be a positive integer or a UUID.`
    )
  }

  const path = `/api/sprints/by-number?workspaceUrl=${encodeURIComponent(workspaceSlug)}&number=${n}`
  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not reach Lumo API at ${base} (${msg})`)
  }
  if (res.status === 404) {
    // teamRef is currently informational only — surface the hint regardless,
    // but soften the wording when --team was already attempted.
    const hint = teamRef
      ? 'Verify the sprint exists for the chosen --team, or pass the UUID.'
      : 'If your workspace has multiple sprints-enabled teams, pass --team <name> or use the sprint UUID.'
    throw new Error(`sprint #${n} not found in this workspace. ${hint}`)
  }
  if (res.status === 401) {
    throw new Error(AUTH_INVALID_MESSAGE)
  }
  if (!res.ok) {
    throw new Error(httpFailed('sprint lookup', res.status))
  }
  const body = (await res.json()) as SprintByNumberResponse
  return {
    id: body.sprint.id,
    number: body.sprint.number,
    name: body.sprint.name,
    teamId: body.sprint.teamId,
  }
}

/**
 * Resolve a milestone `<identifier>`:
 * - If it's a UUID, return as-is (project not fetched).
 * - Otherwise, resolve the project (via `--project <ref>` or auto-select),
 *   list its milestones, and match by name case-insensitively.
 */
export async function resolveMilestoneId(
  base: string,
  token: string,
  identifier: string,
  projectRef: string | undefined
): Promise<{ id: string; name: string; projectId: string }> {
  if (isUuid(identifier)) {
    // Caller will fetch /api/milestones/<id> to learn the projectId & name.
    return { id: identifier, name: '', projectId: '' }
  }

  const projectId = await resolveProjectId(base, token, projectRef)
  const { milestones } = await fetchJson<{ milestones: MilestoneRow[] }>(
    base,
    token,
    `/api/projects/${projectId}/milestones?filter=all`
  )
  // Exact id match first (milestone ids are cuids, unique).
  const byId = milestones.find(m => m.id === identifier)
  if (byId) {
    return { id: byId.id, name: byId.name, projectId }
  }
  // Then by name (case-insensitive). Names are NOT unique within a project
  // (only slug is), so reject an ambiguous name rather than silently picking
  // the first match.
  const needle = identifier.trim().toLowerCase()
  const hits = milestones.filter(m => m.name.toLowerCase() === needle)
  if (hits.length === 0) {
    throw new Error(
      `no milestone matches "${identifier}" in this project. Try \`lumo milestone list\`.`
    )
  }
  if (hits.length > 1) {
    const ids = hits.map(h => h.id).join(', ')
    throw new Error(
      `ambiguous milestone name "${identifier}" matches ${hits.length} milestones; re-run with the id: ${ids}`
    )
  }
  return { id: hits[0]!.id, name: hits[0]!.name, projectId }
}

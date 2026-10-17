import { AUTH_INVALID_MESSAGE, httpFailed } from './errors'
import {
  ambiguousMilestoneError,
  matchMilestoneRef,
} from '../../../shared/src/milestone-ref'

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
  status?: string
  /** LUM-1230: the web URL segment; matched as a ref. */
  slug?: string | null
  projectId?: string
}

/** Thrown when no `--project` was given and the workspace has several. */
export class MultipleProjectsError extends Error {
  constructor() {
    super('workspace has multiple projects; pass --project <slug>.')
  }
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
  return (await resolveProject(base, token, ref)).id
}

/** {@link resolveProjectId}, keeping the project's name (LUM-1192). */
export async function resolveProject(
  base: string,
  token: string,
  ref: string | undefined
): Promise<{ id: string; name: string }> {
  const { projects } = await fetchJson<{ projects: ProjectRow[] }>(
    base,
    token,
    '/api/projects'
  )
  const visible = projects.filter(p => !p.isIdea)

  if (!ref) {
    if (visible.length === 0) throw new Error('workspace has no projects yet.')
    if (visible.length === 1) return visible[0]!
    throw new MultipleProjectsError()
  }

  const needle = ref.trim().toLowerCase()
  const match = visible.find(
    p => p.name.toLowerCase() === needle || slugify(p.name) === needle
  )
  if (!match) {
    throw new Error(`project "${ref}" not found. Try \`lumo project list\`.`)
  }
  return match
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
 * - Otherwise match it — by id, slug (the web URL segment, LUM-1230) or name,
 *   case-insensitively — against the milestones of the project given by
 *   `--project` (or the workspace's only project). With no `--project` in a
 *   multi-project workspace the whole workspace is searched (LUM-1230), so a
 *   slug works without naming the project unless it is ambiguous.
 * More than one match is an error listing the candidates by slug.
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

  let projectId: string | null = null
  try {
    projectId = await resolveProjectId(base, token, projectRef)
  } catch (err) {
    if (!(err instanceof MultipleProjectsError)) throw err
  }
  const { milestones } = await fetchJson<{ milestones: MilestoneRow[] }>(
    base,
    token,
    projectId
      ? `/api/projects/${projectId}/milestones?filter=all`
      : '/api/milestones/workspace?filter=all'
  )
  const match = matchMilestoneRef(identifier, milestones)
  if (match.kind === 'not-found') {
    throw new Error(
      `no milestone matches "${identifier}" ${projectId ? 'in this project' : 'in this workspace'}. Try \`lumo milestone list\`.`
    )
  }
  if (match.kind === 'ambiguous') {
    throw new Error(ambiguousMilestoneError(identifier, match.candidates))
  }
  const m = match.milestone
  return { id: m.id, name: m.name, projectId: projectId ?? m.projectId ?? '' }
}

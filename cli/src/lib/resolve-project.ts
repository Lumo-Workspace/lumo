import { trimTrailingSlash } from './api'
import { slugify } from './resolve'

/** Resolve a project name/slug to its id via GET /api/projects. */
export async function resolveProjectIdByRef(
  apiUrl: string, token: string, ref: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const base = trimTrailingSlash(apiUrl)
  let res: Response
  try {
    res = await fetch(`${base}/api/projects`, { headers: { Authorization: `Bearer ${token}` } })
  } catch (err) {
    return { ok: false, error: `could not reach Lumo API (${err instanceof Error ? err.message : String(err)})` }
  }
  if (!res.ok) return { ok: false, error: `project list failed (HTTP ${res.status})` }
  const { projects } = (await res.json()) as { projects: Array<{ id: string; name: string }> }
  const want = ref.toLowerCase()
  const match = projects.find(p => slugify(p.name) === ref || p.name.toLowerCase() === want)
  if (!match) return { ok: false, error: `project "${ref}" not found. Run \`lumo project list\`.` }
  return { ok: true, id: match.id }
}

/** Resolve the project id of the task bound to this session (via its identifier). */
export async function resolveBoundProjectId(
  apiUrl: string, token: string, boundIdentifier: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const base = trimTrailingSlash(apiUrl)
  let res: Response
  try {
    res = await fetch(`${base}/api/tasks/by-identifier/${encodeURIComponent(boundIdentifier)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (err) {
    return { ok: false, error: `could not reach Lumo API (${err instanceof Error ? err.message : String(err)})` }
  }
  if (!res.ok) return { ok: false, error: `could not resolve bound task ${boundIdentifier} (HTTP ${res.status})` }
  const { task } = (await res.json()) as { task: { project?: { id?: string } } }
  const id = task.project?.id
  if (!id) return { ok: false, error: `bound task ${boundIdentifier} has no resolvable project` }
  return { ok: true, id }
}

import { trimTrailingSlash } from './api'

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

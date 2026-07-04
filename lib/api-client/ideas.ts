import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'
import type { CaptureIdeaInput } from '@/lib/validation/idea'

/**
 * Typed client for the team idea pool. Thin wrappers over `apiFetch` — the
 * web frontend (and the Spec-2 transformer UI) read/write ideas through here
 * rather than hitting `fetch` directly.
 */
export const ideasClient = {
  /** GET the caller team's full idea pool (every status, newest first). */
  listPool<T>() {
    return apiFetch<T>(API.ideas.list)
  },

  /** POST a new captured idea. */
  capture<T>(input: CaptureIdeaInput) {
    return apiFetch<T>(API.ideas.create, { method: 'POST', body: input })
  },
}

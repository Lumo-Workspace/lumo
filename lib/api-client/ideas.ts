import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'
import type {
  CaptureIdeaInput,
  UpdateIdeaInput,
  UpdateIdeaStatusInput,
} from '@/lib/validation/idea'

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

  /** PATCH an idea's statement (detail slide-over edit, LUM-683). */
  update<T>(id: string, input: UpdateIdeaInput) {
    return apiFetch<T>(API.ideas.byId(id), { method: 'PATCH', body: input })
  },

  /**
   * PATCH an idea's lifecycle status (LUM-679). `idRef` is a cuid id or a
   * `<TEAM>-I<n>` identifier — the same route the statement edit uses.
   */
  updateStatus<T>(idRef: string, input: UpdateIdeaStatusInput) {
    return apiFetch<T>(API.ideas.byId(idRef), { method: 'PATCH', body: input })
  },
}

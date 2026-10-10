import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

/**
 * Client-facing initiative types. These mirror the DTOs from
 * `lib/services/initiative.service.ts`, redeclared here because the front end
 * must not import server-only `lib/services` (DIP / server-client split).
 * `createdAt` is an ISO string over the wire (JSON), not a `Date`.
 */
// LUM-678: Linear-aligned 5-state lifecycle.
export type ApiInitiativeStatus =
  | 'PROPOSED'
  | 'PLANNED'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'CANCELLED'
export type ApiTaskStatus =
  | 'BACKLOG'
  | 'TODO'
  | 'IN_PROGRESS'
  | 'IN_REVIEW'
  | 'DONE'

export interface ApiInitiativeListItem {
  id: string
  number: number
  identifier: string
  name: string
  status: ApiInitiativeStatus
  taskCount: number
  createdAt: string
}

export interface ApiInitiativeTaskRef {
  id: string
  identifier: string
  title: string
  status: ApiTaskStatus
}

export interface ApiInitiativeDetail {
  id: string
  number: number
  identifier: string
  name: string
  assumptionNote: string | null
  status: ApiInitiativeStatus
  createdAt: string
  tasks: ApiInitiativeTaskRef[]
  taskProgress: { total: number; done: number }
}

/**
 * Typed client for the team initiative browse (LUM-673). Thin wrappers over
 * `apiFetch` — pages read initiatives through here rather than hitting `fetch`
 * directly.
 */
/** Payload for creating an initiative. */
export interface CreateInitiativeBody {
  name: string
  assumptionNote?: string | null
}

export const initiativesClient = {
  /** GET the caller team's initiatives (list). */
  list<T>() {
    return apiFetch<T>(API.initiatives.list)
  },

  /** GET one initiative with its attached tasks. */
  getDetail<T>(id: string) {
    return apiFetch<T>(API.initiatives.byId(id))
  },

  /** POST a new initiative. */
  create<T>(input: CreateInitiativeBody) {
    return apiFetch<T>(API.initiatives.create, { method: 'POST', body: input })
  },
}

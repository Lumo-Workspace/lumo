import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

/**
 * Client-facing initiative types. These mirror the DTOs from
 * `lib/services/initiative.service.ts`, redeclared here because the front end
 * must not import server-only `lib/services` (DIP / server-client split).
 * `createdAt` is an ISO string over the wire (JSON), not a `Date`.
 */
// LUM-678: Linear-aligned 5-state lifecycle. DONE/DROPPED are retained-but-
// deprecated legacy values (see the InitiativeStatus enum in schema.prisma).
export type ApiInitiativeStatus =
  | 'PROPOSED'
  | 'PLANNED'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'DONE'
  | 'DROPPED'
export type ApiTaskStatus = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE'

export interface ApiInitiativeListItem {
  id: string
  number: number
  identifier: string
  goalStatement: string
  status: ApiInitiativeStatus
  taskCount: number
  ideaCount: number
  createdAt: string
}

export interface ApiInitiativeIdeaRef {
  id: string
  identifier: string
  statement: string
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
  goalStatement: string
  assumptionNote: string | null
  status: ApiInitiativeStatus
  createdAt: string
  ideas: ApiInitiativeIdeaRef[]
  tasks: ApiInitiativeTaskRef[]
  taskProgress: { total: number; done: number }
}

/**
 * Typed client for the team initiative browse (LUM-673). Thin wrappers over
 * `apiFetch` — pages read initiatives through here rather than hitting `fetch`
 * directly.
 */
/** Payload for creating an initiative directly (no plan run). */
export interface CreateInitiativeBody {
  goalStatement: string
  assumptionNote?: string | null
}

export const initiativesClient = {
  /** GET the caller team's initiatives (list). */
  list<T>() {
    return apiFetch<T>(API.initiatives.list)
  },

  /** GET one initiative with its lineage. */
  getDetail<T>(id: string) {
    return apiFetch<T>(API.initiatives.byId(id))
  },

  /** POST a new initiative created directly (no plan run). */
  create<T>(input: CreateInitiativeBody) {
    return apiFetch<T>(API.initiatives.create, { method: 'POST', body: input })
  },
}

'use client'

import { useQuery } from '@tanstack/react-query'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

export type BoundaryDisposition = 'FALSE_POSITIVE' | 'CONFIRMED'
export type BoundarySeverity = 'LOW' | 'MEDIUM' | 'HIGH'

export interface RemediationTaskView {
  identifier: string
  title: string
  status: string
  remediated: boolean
}

/** Inline before→after of the edit that tripped a display-safe crossing (LUM-452). */
export interface EditChangeView {
  kind: 'edit' | 'write' | null
  oldText: string | null
  newText: string | null
  truncated: boolean
  unavailable: string | null
  prUrl: string | null
  /** Deep link to this file's diff inside the PR (LUM-455). */
  prFileUrl: string | null
  /** Turn-level intent the agent stated for the turn this edit belongs to (LUM-455). */
  agentTurnContext: string | null
}

export interface BoundaryCrossingView {
  id: string
  category: string
  detail: string
  detectedAt: string
  reversible: boolean
  severity: BoundarySeverity
  disposition: BoundaryDisposition | null
  dispositionNote: string | null
  dispositionedAt: string | null
  dispositionedById: string | null
  remediationTask: RemediationTaskView | null
  editChange: EditChangeView | null
}

interface BoundaryCrossingsResponse {
  crossings: BoundaryCrossingView[]
}

interface UseBoundaryCrossingsOptions {
  /** Task identifier (LUM-42); the route resolves it or a cuid. */
  identifier: string
  /** When false the hook neither fetches nor reads cache (tab inactive). */
  enabled?: boolean
}

/**
 * Read-through cache for ALL of a task's boundary-crossings — open and
 * dispositioned (LUM-435), consumed by the AcceptanceTab panel. Mirrors
 * useTaskStatus: once cached for `identifier`, tab switches paint instantly
 * while a quiet background refetch keeps it fresh.
 */
export function useBoundaryCrossings({
  identifier,
  enabled = true,
}: UseBoundaryCrossingsOptions) {
  const query = useQuery<BoundaryCrossingsResponse>({
    queryKey: queryKeys.boundaryCrossings(identifier),
    queryFn: () =>
      tasksClient.listBoundaryCrossings<BoundaryCrossingsResponse>(identifier),
    enabled: !!identifier && enabled,
  })

  return {
    crossings: query.data?.crossings ?? [],
    loading: query.isPending && !!identifier && enabled,
    error: query.error
      ? ((query.error as Error).message ?? 'Failed to load boundary crossings')
      : null,
    refresh: query.refetch,
  }
}

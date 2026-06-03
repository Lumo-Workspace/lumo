'use client'

import {
  useMutation,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { milestonesClient, type ApiMilestone } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

/**
 * A milestone query cache holds either a list (project tabs, keyed by filter)
 * or a single milestone (detail page, by id or by project+slug). The optimistic
 * archive patch handles both shapes so one mutation updates every view that
 * happens to hold the milestone.
 */
type MilestoneCache = ApiMilestone | ApiMilestone[] | null | undefined

/**
 * Snapshot of every milestone cache entry, captured before the optimistic write
 * so `onError` can restore each one byte-for-byte.
 */
type ArchiveContext = { previous: Array<[QueryKey, MilestoneCache]> }

/**
 * Flip `archivedAt` on the milestone with `id` wherever it lives in a cached
 * milestone query — list entries and single-detail entries alike. Pure; returns
 * the same reference when nothing matched so untouched caches stay `===` and
 * don't trigger needless re-renders.
 */
export function patchMilestoneArchivedAt(
  data: MilestoneCache,
  id: string,
  archivedAt: string | null
): MilestoneCache {
  if (Array.isArray(data)) {
    let changed = false
    const next = data.map(m => {
      if (m.id !== id) return m
      changed = true
      return { ...m, archivedAt }
    })
    return changed ? next : data
  }
  if (data && data.id === id) return { ...data, archivedAt }
  return data
}

/**
 * Archive / unarchive mutations with optimistic cache updates.
 *
 * Archiving is a pure, low-risk status flip — a click should grey the milestone
 * (or restore it) immediately, so `onMutate` flips `archivedAt` across every
 * cached milestone view and `onError` rolls back. The `invalidate` on success
 * stays as a backstop: it reconciles list membership the optimistic patch can't
 * know about (e.g. dropping the row from the `active` filter once the server
 * confirms). Both mutations take the full `ApiMilestone` so the success
 * invalidation can target its project and detail keys.
 *
 * Deliberately scoped to archive/unarchive — create/update/delete keep waiting
 * on server confirmation.
 */
export function useMilestoneArchive() {
  const qc = useQueryClient()
  const allKey = queryKeys.milestones.all()

  const optimistic = (archived: boolean) => async (m: ApiMilestone) => {
    // Stop in-flight list/detail refetches from clobbering the optimistic write.
    await qc.cancelQueries({ queryKey: allKey })
    const previous = qc.getQueriesData<MilestoneCache>({ queryKey: allKey })
    // `archivedAt`'s exact value is cosmetic here — only its truthiness drives
    // the archived pill; the success refetch supplies the server timestamp.
    const archivedAt = archived ? new Date().toISOString() : null
    qc.setQueriesData<MilestoneCache>({ queryKey: allKey }, data =>
      patchMilestoneArchivedAt(data, m.id, archivedAt)
    )
    return { previous }
  }

  const rollback = (
    _err: Error,
    _m: ApiMilestone,
    context: ArchiveContext | undefined
  ) => {
    context?.previous.forEach(([key, data]) => qc.setQueryData(key, data))
  }

  const reconcile = (_data: { milestone: ApiMilestone }, m: ApiMilestone) => {
    qc.invalidateQueries({
      queryKey: queryKeys.milestones.byProject(m.projectId),
    })
    qc.invalidateQueries({ queryKey: queryKeys.milestones.detail(m.id) })
  }

  const archive = useMutation<
    { milestone: ApiMilestone },
    Error,
    ApiMilestone,
    ArchiveContext
  >({
    mutationFn: m => milestonesClient.archive(m.id),
    onMutate: optimistic(true),
    onError: rollback,
    onSuccess: reconcile,
  })

  const unarchive = useMutation<
    { milestone: ApiMilestone },
    Error,
    ApiMilestone,
    ArchiveContext
  >({
    mutationFn: m => milestonesClient.unarchive(m.id),
    onMutate: optimistic(false),
    onError: rollback,
    onSuccess: reconcile,
  })

  return { archive, unarchive }
}

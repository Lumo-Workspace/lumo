'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { milestonesClient, type ApiMilestone } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

/**
 * Create a milestone from a name alone — the Project tab's inline composer.
 *
 * Name-only by design: the composer is for capturing a milestone the moment you
 * think of it. Dates, description and status are filled in later on the
 * Milestones tab, which owns the full form.
 *
 * Invalidate-only (no optimistic insert): the server assigns the slug the row
 * links to, so an optimistic row would be un-clickable until it reconciled.
 */
export function useCreateMilestone(projectId: string) {
  const qc = useQueryClient()

  return useMutation<{ milestone: ApiMilestone }, Error, string>({
    mutationFn: name => milestonesClient.create(projectId, { name }),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: queryKeys.milestones.byProject(projectId),
      }),
  })
}

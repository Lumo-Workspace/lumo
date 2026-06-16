'use client'

import type { MentionSources } from '@/types/mention'
import { useTaskStatus } from '../../hooks/useTaskStatus'
import { VerdictDecision, type HumanVerdictResult } from './VerdictDecision'

interface ReviewVerdictBarProps {
  /** Task identifier (LUM-42) — keys the status fetch + verdict submit. */
  taskIdentifier: string
  onVerdictRecorded: (result: HumanVerdictResult) => void
  /** Mention sources for the FAIL send-back editor. */
  mentionSources?: MentionSources
}

/**
 * LUM-529: the review verdict bar (通过/打回), pinned at the top of the task
 * detail above the description so a reviewer doesn't scroll to find it. Owns the
 * gate that used to live inline in TimelineTabs: the bar shows only while the
 * task is IN_REVIEW and has a contract to adjudicate. The status query shares
 * its React Query cache key with TimelineTabs' own useTaskStatus call, so this
 * adds no extra request.
 *
 * No SSR hasCriteria seed is needed (unlike TimelineTabs): the floating
 * VerdictDecision requires non-null `data`, so the bar cannot paint before the
 * status query resolves — a pre-resolve fallback would be unreachable. Its own
 * `mb-4` provides the gap to the description below; no extra wrapper margin.
 */
export function ReviewVerdictBar({
  taskIdentifier,
  onVerdictRecorded,
  mentionSources,
}: ReviewVerdictBarProps) {
  const status = useTaskStatus({ identifier: taskIdentifier, enabled: true })

  if (
    !status.data ||
    status.data.task.status !== 'IN_REVIEW' ||
    status.data.criteria.length === 0
  ) {
    return null
  }

  return (
    <VerdictDecision
      variant='floating'
      taskIdentifier={taskIdentifier}
      data={status.data}
      onVerdictRecorded={onVerdictRecorded}
      {...(mentionSources ? { mentionSources } : {})}
    />
  )
}

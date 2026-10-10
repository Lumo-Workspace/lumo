'use client'

/**
 * LUM-1062 — the `task.crossing.annotation` slot: the AI triage line under
 * a boundary crossing (LUM-945), shown once the crossing has a score.
 */
import type { ClientSlotProps } from '@/lib/plugins/client'
import { CrossingTriageLine } from '@/ee/security/components/TaskDetailTimeline/CrossingTriageLine'

export function SecurityCrossingTriage({
  crossingId,
  triageProbability,
  disposition,
}: ClientSlotProps['task.crossing.annotation']) {
  if (triageProbability == null) return null
  return (
    <CrossingTriageLine
      crossingId={crossingId}
      probability={triageProbability}
      disposition={disposition}
    />
  )
}

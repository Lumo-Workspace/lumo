'use client'

import type { ApiMilestone, MilestoneUpdateInput } from '@/lib/api-client'
import { MilestoneHero } from './MilestoneHero'
import { MilestoneCostTrendSection } from './MilestoneCostTrendSection'
import { MilestoneTaskEvidenceSection } from './MilestoneTaskEvidenceSection'

interface MilestoneOverviewTabProps {
  milestone: Pick<
    ApiMilestone,
    | 'id'
    | 'name'
    | 'startDate'
    | 'targetDate'
    | 'taskCounts'
    | 'health'
    | 'summaryTldr'
    | 'sprintCoverage'
    | 'outcome'
    | 'costRollup'
    | 'burnup'
    | 'segments'
    | 'deliveryStats'
    | 'memberDelivery'
  >
  onUpdate: (fields: MilestoneUpdateInput) => void
  /** Workspace URL segment, so evidence cards can link to task detail. */
  workspaceUrl: string
  archived?: boolean
}

/**
 * Overview tab, LUM-636 mission-control order: hero (progress ring / key
 * outcome / health+dates) → KPI card row → burnup + delivery quality →
 * per-member rows → task evidence grid. The description now lives in its
 * own tab — the Overview is the honest-report dashboard, prose-free.
 */
export function MilestoneOverviewTab({
  milestone,
  onUpdate,
  workspaceUrl,
  archived = false,
}: MilestoneOverviewTabProps) {
  return (
    <div className='px-4 md:px-8 py-8'>
      <MilestoneHero
        name={milestone.name}
        taskCounts={milestone.taskCounts ?? null}
        health={milestone.health ?? null}
        startDate={milestone.startDate}
        targetDate={milestone.targetDate}
        summaryTldr={milestone.summaryTldr ?? null}
        sprintCoverage={milestone.sprintCoverage ?? null}
        onUpdate={onUpdate}
        archived={archived}
      />

      <MilestoneCostTrendSection
        costRollup={milestone.costRollup}
        burnup={milestone.burnup}
        deliveryStats={milestone.deliveryStats}
        memberDelivery={milestone.memberDelivery}
        outcome={milestone.outcome}
      />

      <MilestoneTaskEvidenceSection
        segments={milestone.segments}
        outcome={milestone.outcome}
        workspaceUrl={workspaceUrl}
      />
    </div>
  )
}

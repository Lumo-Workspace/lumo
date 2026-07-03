'use client'

import type { ApiMilestone, MilestoneUpdateInput } from '@/lib/api-client'
import type { WorkspaceMemberInfo } from '../../types'
import { MilestoneHero } from './MilestoneHero'
import { MilestoneCostTrendSection } from './MilestoneCostTrendSection'
import { MilestoneRiskQueueSection } from './MilestoneRiskQueueSection'
import { MilestoneTopologySection } from './MilestoneTopologySection'
import { MilestoneTaskEvidenceSection } from './MilestoneTaskEvidenceSection'

interface MilestoneOverviewTabProps {
  milestone: Pick<
    ApiMilestone,
    | 'id'
    | 'name'
    | 'startDate'
    | 'derivedStartDate'
    | 'targetDate'
    | 'taskCounts'
    | 'health'
    | 'summaryTldr'
    | 'sprintCoverage'
    | 'outcome'
    | 'costRollup'
    | 'budget'
    | 'burnup'
    | 'segments'
    | 'deliveryStats'
    | 'memberDelivery'
    | 'riskQueue'
    | 'topology'
  >
  onUpdate: (fields: MilestoneUpdateInput) => void
  /** Workspace URL segment, so evidence cards can link to task detail. */
  workspaceUrl: string
  /** Workspace members (client cache) — avatars for the by-member rows. */
  members?: WorkspaceMemberInfo[] | undefined
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
  members,
  archived = false,
}: MilestoneOverviewTabProps) {
  return (
    <div className='px-4 md:px-8 py-8'>
      <MilestoneHero
        name={milestone.name}
        taskCounts={milestone.taskCounts ?? null}
        health={milestone.health ?? null}
        startDate={milestone.startDate}
        derivedStartDate={milestone.derivedStartDate ?? null}
        targetDate={milestone.targetDate}
        summaryTldr={milestone.summaryTldr ?? null}
        sprintCoverage={milestone.sprintCoverage ?? null}
        onUpdate={onUpdate}
        archived={archived}
      />

      {/* Action queue sits right under the hero: orient first, act second,
          analyze after — the rest of the Overview is retrospective. */}
      <MilestoneRiskQueueSection
        riskQueue={milestone.riskQueue}
        budget={milestone.budget}
        workspaceUrl={workspaceUrl}
      />

      {/* The forward-looking half of the action queue: what to start next,
          dependency-ordered — still ahead of the retrospective sections. */}
      <MilestoneTopologySection
        topology={milestone.topology}
        workspaceUrl={workspaceUrl}
      />

      <MilestoneCostTrendSection
        costRollup={milestone.costRollup}
        budget={milestone.budget}
        burnup={milestone.burnup}
        deliveryStats={milestone.deliveryStats}
        memberDelivery={milestone.memberDelivery}
        outcome={milestone.outcome}
        members={members}
      />

      <MilestoneTaskEvidenceSection
        segments={milestone.segments}
        outcome={milestone.outcome}
        workspaceUrl={workspaceUrl}
      />
    </div>
  )
}

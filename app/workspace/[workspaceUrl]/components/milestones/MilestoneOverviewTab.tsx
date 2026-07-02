'use client'

import { useIntl } from 'react-intl'
import type { ApiMilestone, MilestoneUpdateInput } from '@/lib/api-client'
import type { WorkspaceMemberInfo } from '../../types'
import { DescriptionEditor } from '../DescriptionEditorLazy'
import { TypographyH3 } from '@/components/ui/typography'
import { useMentionSources } from '../../hooks/useMentionSources'
import { MilestoneOutcomeSection } from './MilestoneOutcomeSection'
import { MilestoneRollupBar } from './MilestoneRollupBar'
import { MilestoneCostTrendSection } from './MilestoneCostTrendSection'

interface MilestoneOverviewTabProps {
  milestone: Pick<
    ApiMilestone,
    | 'id'
    | 'name'
    | 'description'
    | 'startDate'
    | 'targetDate'
    | 'taskCounts'
    | 'health'
    | 'summaryTldr'
    | 'outcome'
    | 'costRollup'
    | 'burnup'
  >
  onUpdate: (fields: MilestoneUpdateInput) => void
  /** Workspace members, so the description editor can @-mention people. */
  members: WorkspaceMemberInfo[]
  archived?: boolean
}

/**
 * Overview tab: decision-first rollup bar (completion / health / time span /
 * key outcome) first, then the cost+trajectory rollup (LUM-627), then the
 * inline-editable name + demoted description.
 */
export function MilestoneOverviewTab({
  milestone,
  onUpdate,
  members,
  archived = false,
}: MilestoneOverviewTabProps) {
  const intl = useIntl()
  const mentionSources = useMentionSources(members)
  return (
    <div className='px-4 md:px-8 py-8'>
      <div className='mb-8'>
        <TypographyH3
          key={milestone.id}
          contentEditable={!archived}
          suppressContentEditableWarning
          onBlur={e => {
            if (archived) return
            const trimmed = e.currentTarget.textContent?.trim() ?? ''
            if (!trimmed || trimmed === milestone.name) {
              e.currentTarget.textContent = milestone.name
              return
            }
            onUpdate({ name: trimmed })
          }}
          onKeyDown={e => {
            if (archived) return
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
            if (e.key === 'Escape') {
              e.currentTarget.textContent = milestone.name
              e.currentTarget.blur()
            }
          }}
          className='outline-none cursor-text focus:outline-none'
        >
          {milestone.name}
        </TypographyH3>
      </div>

      <MilestoneRollupBar
        taskCounts={milestone.taskCounts ?? null}
        health={milestone.health ?? null}
        startDate={milestone.startDate}
        targetDate={milestone.targetDate}
        summaryTldr={milestone.summaryTldr ?? null}
      />

      <MilestoneCostTrendSection
        costRollup={milestone.costRollup}
        burnup={milestone.burnup}
      />

      <div className='max-w-3xl'>
        <p className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3'>
          {intl.formatMessage({ id: 'milestone.field.description' })}
        </p>
        <DescriptionEditor
          key={milestone.id}
          value={milestone.description}
          onCommit={html => {
            if (!archived) onUpdate({ description: html || null })
          }}
          documentId={milestone.id}
          mentionSources={mentionSources}
        />
      </div>

      <MilestoneOutcomeSection outcome={milestone.outcome} />
    </div>
  )
}

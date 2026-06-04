'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { cn } from '@/lib/utils'
import type { ApiMilestone, MilestoneUpdateInput } from '@/lib/api-client'
import { MilestoneOverviewTab } from './MilestoneOverviewTab'
import { MilestoneTasksTab } from './MilestoneTasksTab'

type Tab = 'overview' | 'tasks'

interface MilestoneDetailTabsProps {
  milestone: ApiMilestone
  onUpdate: (fields: MilestoneUpdateInput) => void
}

/** Tab nav + bodies for the milestone detail page (overview / tasks). */
export function MilestoneDetailTabs({
  milestone,
  onUpdate,
}: MilestoneDetailTabsProps) {
  const intl = useIntl()
  const [tab, setTab] = useState<Tab>('overview')
  const archived = !!milestone.archivedAt

  return (
    <div className='flex flex-1 flex-col lg:overflow-y-auto'>
      <div className='mt-4 flex shrink-0 items-center gap-1 px-4 md:px-8'>
        {(['overview', 'tasks'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === t
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
            )}
          >
            {intl.formatMessage({ id: `milestone.tab.${t}` })}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <MilestoneOverviewTab milestone={milestone} onUpdate={onUpdate} archived={archived} />
      ) : (
        <MilestoneTasksTab
          projectId={milestone.projectId}
          milestoneId={milestone.id}
          sprintCoverage={milestone.sprintCoverage}
        />
      )}
    </div>
  )
}

'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { cn } from '@/lib/utils'
import type { ApiMilestone, MilestoneUpdateInput } from '@/lib/api-client'
import type { MyTask, WorkspaceMemberInfo } from '../../types'
import { MilestoneOverviewTab } from './MilestoneOverviewTab'
import { MilestoneTasksTab } from './MilestoneTasksTab'

type Tab = 'overview' | 'tasks'

interface MilestoneDetailTabsProps {
  milestone: ApiMilestone
  onUpdate: (fields: MilestoneUpdateInput) => void
  /** Workspace members, threaded into the overview tab for @-mentions. */
  members: WorkspaceMemberInfo[]
  /** Collapse state of the milestone properties rail (owned by the page). */
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  /** Open the task drawer for a clicked card/row in the tasks board. */
  onOpenTask: (task: MyTask) => void
}

/** Tab nav + bodies for the milestone detail page (overview / tasks). */
export function MilestoneDetailTabs({
  milestone,
  onUpdate,
  members,
  sidebarCollapsed,
  onToggleSidebar,
  onOpenTask,
}: MilestoneDetailTabsProps) {
  const intl = useIntl()
  const [tab, setTab] = useState<Tab>('overview')
  const archived = !!milestone.archivedAt

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
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
        <div className='min-h-0 flex-1 overflow-y-auto'>
          <MilestoneOverviewTab
            milestone={milestone}
            onUpdate={onUpdate}
            members={members}
            archived={archived}
          />
        </div>
      ) : (
        <MilestoneTasksTab
          milestoneId={milestone.id}
          sprintCoverage={milestone.sprintCoverage}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
          onOpenTask={onOpenTask}
        />
      )}
    </div>
  )
}

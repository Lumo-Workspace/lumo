'use client'

import type { ApiMilestone } from '@/lib/api-client'
import type { MyTask } from '../../types'
import { MilestoneSprintCoverage } from './MilestoneSprintCoverage'
import { MilestoneTasksWorkspace } from './MilestoneTasksWorkspace'

interface MilestoneTasksTabProps {
  milestoneId: string
  sprintCoverage: ApiMilestone['sprintCoverage']
  /** Collapse state of the milestone properties rail (owned by the page). */
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  /** Open the task drawer for a clicked card/row. */
  onOpenTask: (task: MyTask) => void
}

/**
 * Tasks tab: sprint-coverage breakdown on top, then the milestone task
 * workspace (board / list). The coverage block stays fixed-height while the
 * workspace fills the rest and scrolls internally, matching the sprint board.
 */
export function MilestoneTasksTab({
  milestoneId,
  sprintCoverage,
  sidebarCollapsed,
  onToggleSidebar,
  onOpenTask,
}: MilestoneTasksTabProps) {
  return (
    <div className='flex flex-1 min-h-0 flex-col overflow-hidden'>
      <div className='shrink-0 px-4 pt-6 md:px-8'>
        <MilestoneSprintCoverage coverage={sprintCoverage} />
      </div>
      <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
        <MilestoneTasksWorkspace
          milestoneId={milestoneId}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
          onOpenTask={onOpenTask}
        />
      </div>
    </div>
  )
}

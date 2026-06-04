'use client'

import type { ApiMilestone } from '@/lib/api-client'
import { MilestoneSprintCoverage } from './MilestoneSprintCoverage'
import { TaskListByMilestone } from './TaskListByMilestone'

interface MilestoneTasksTabProps {
  projectId: string
  milestoneId: string
  sprintCoverage: ApiMilestone['sprintCoverage']
}

/** Tasks tab: sprint coverage breakdown + the milestone's task list. */
export function MilestoneTasksTab({
  projectId,
  milestoneId,
  sprintCoverage,
}: MilestoneTasksTabProps) {
  return (
    <div className='space-y-6 px-4 md:px-8 py-8'>
      <MilestoneSprintCoverage coverage={sprintCoverage} />
      <TaskListByMilestone projectId={projectId} milestoneId={milestoneId} />
    </div>
  )
}

'use client'

import { useIntl } from 'react-intl'
import type { ApiMilestone, MilestoneUpdateInput } from '@/lib/api-client'
import type { MyTask, WorkspaceMemberInfo } from '../../types'
import { DescriptionEditor } from '../DescriptionEditorLazy'
import { useMentionSources } from '../../hooks/useMentionSources'
import { MilestoneHero } from './MilestoneHero'
import { MilestoneMetricStrip } from './MilestoneMetricStrip'
import { MilestoneTasksWorkspace } from './MilestoneTasksWorkspace'

const SECTION_LABEL =
  'text-caption font-bold uppercase tracking-[0.07em] text-muted-foreground'

interface MilestoneDetailBodyProps {
  milestone: ApiMilestone
  onUpdate: (fields: MilestoneUpdateInput) => void
  /** Workspace members, threaded into the description editor for @-mentions. */
  members: WorkspaceMemberInfo[]
  /** Open the task drawer for a clicked row. */
  onOpenTask: (task: MyTask) => void
}

/**
 * LUM-727 — the milestone detail page as one scrolling page instead of the
 * LUM-636 tab split: hero (progress ring / title / dates) → the description,
 * edited in place → the metric strip → the task list. One vertical read, one
 * scrollbar; the task list is the same shared workspace the project list
 * uses, minus the board toggle.
 */
export function MilestoneDetailBody({
  milestone,
  onUpdate,
  members,
  onOpenTask,
}: MilestoneDetailBodyProps) {
  const intl = useIntl()
  const mentionSources = useMentionSources(members)
  const archived = !!milestone.archivedAt

  return (
    <div className='min-h-0 flex-1 overflow-y-auto'>
      <div className='px-4 pt-8 md:px-8'>
        <MilestoneHero
          name={milestone.name}
          taskCounts={milestone.taskCounts ?? null}
          weightedProgress={milestone.weightedProgress ?? null}
          health={milestone.health ?? null}
          startDate={milestone.startDate}
          derivedStartDate={milestone.derivedStartDate ?? null}
          targetDate={milestone.targetDate}
          summaryTldr={milestone.summaryTldr ?? null}
          sprintCoverage={milestone.sprintCoverage ?? null}
          onUpdate={onUpdate}
          archived={archived}
        />

        {/* Prose lives on the page, edited where it is read (no separate
            tab, no modal) — the Linear-style open document. */}
        <section aria-labelledby='milestone-description-label'>
          <h2 id='milestone-description-label' className={SECTION_LABEL}>
            {intl.formatMessage({ id: 'milestone.section.description' })}
          </h2>
          <div className='mt-2 max-w-3xl'>
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
        </section>

        <MilestoneMetricStrip
          costRollup={milestone.costRollup}
          budget={milestone.budget}
          deliveryStats={milestone.deliveryStats}
        />
      </div>

      <section aria-labelledby='milestone-tasks-label' className='mt-8'>
        <h2
          id='milestone-tasks-label'
          className={`px-4 md:px-8 ${SECTION_LABEL}`}
        >
          {intl.formatMessage({ id: 'milestone.section.tasks' })}
        </h2>
        <MilestoneTasksWorkspace
          milestoneId={milestone.id}
          onOpenTask={onOpenTask}
        />
      </section>
    </div>
  )
}

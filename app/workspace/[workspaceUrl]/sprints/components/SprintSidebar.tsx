'use client'

import { useEffect, useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { Progress } from '@/components/ui/progress'
import { sprintsClient } from '@/lib/api-client'
import type { Sprint } from '@prisma/client'
import {
  deriveSprintState,
  type DerivedSprintState,
} from '@/lib/services/sprint-date'
import {
  priorityBreakdown,
  memberBreakdown,
} from '@/lib/services/sprint-breakdown'
import { DatePickerField, startOfDay } from './DatePickerField'
import type { ApiTask, WorkspaceMemberInfo } from '../../types'
import { MemberAvatar } from '../../components/fields/shared'
import { PriorityBadge } from '../../components/PriorityBadge'
import { RiskBadge } from '../../components/summary/RiskBadge'
import type { RiskAssessment, TopBlockers } from '@/types/summary'

interface SprintProgress {
  done: number
  total: number
}

interface SprintSidebarProps {
  sprint: Sprint
  progress: SprintProgress
  risk?: RiskAssessment | null
  topBlockers?: TopBlockers | null
  tasks: ApiTask[]
  members: WorkspaceMemberInfo[]
  onRefresh: () => void
}

const STATE_BADGE: Record<DerivedSprintState, string> = {
  UPCOMING: 'bg-muted text-muted-foreground',
  CURRENT: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  COMPLETED:
    'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
}

const STATE_I18N_KEY: Record<DerivedSprintState, string> = {
  UPCOMING: 'sprints.state.upcoming',
  CURRENT: 'sprints.state.current',
  COMPLETED: 'sprints.state.completed',
}

export function SprintSidebar({
  sprint,
  progress,
  risk,
  topBlockers,
  tasks,
  members,
  onRefresh,
}: SprintSidebarProps) {
  const intl = useIntl()
  const state = deriveSprintState(sprint)

  // Track edits locally so the displayed value flips immediately on pick;
  // server response (success or error) reconciles via onRefresh / revert.
  const [start, setStart] = useState<Date>(() => new Date(sprint.startDate))
  const [end, setEnd] = useState<Date>(() => new Date(sprint.endDate))

  // Re-sync when the parent hands us a fresh sprint (e.g. after refetch).
  useEffect(() => {
    setStart(new Date(sprint.startDate))
    setEnd(new Date(sprint.endDate))
  }, [sprint.startDate, sprint.endDate])

  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  const byPriority = useMemo(() => priorityBreakdown(tasks), [tasks])
  const byMember = useMemo(
    () => memberBreakdown(tasks, members),
    [tasks, members]
  )

  // Risk reasons rendered as a single muted line (mirrors ProjectsAtGlanceList).
  const reasonLine = useMemo(
    () =>
      (risk?.reasons ?? [])
        .slice(0, 2)
        .map(r => r.detail)
        .join(', '),
    [risk]
  )

  // Non-empty blocker categories, each as a label + comma-joined identifiers.
  const blockerGroups = useMemo(() => {
    if (!topBlockers) return []
    const ids = (items: Array<{ identifier: string }>) =>
      items.map(i => i.identifier).join(', ')
    const groups: Array<{ key: string; labelKey: string; value: string }> = []
    if (topBlockers.overdueTaskIds.length > 0)
      groups.push({
        key: 'overdue',
        labelKey: 'summary.blockerGroup.overdue',
        value: ids(topBlockers.overdueTaskIds),
      })
    if (topBlockers.stalledTaskIds.length > 0)
      groups.push({
        key: 'stalled',
        labelKey: 'summary.blockerGroup.stalled',
        value: ids(topBlockers.stalledTaskIds),
      })
    if (topBlockers.failingAgentTaskIds.length > 0)
      groups.push({
        key: 'failingAgents',
        labelKey: 'summary.blockerGroup.failingAgents',
        value: ids(topBlockers.failingAgentTaskIds),
      })
    if (topBlockers.staleOpenPrNumbers.length > 0)
      groups.push({
        key: 'stalePrs',
        labelKey: 'summary.blockerGroup.stalePrs',
        value: topBlockers.staleOpenPrNumbers.map(n => `#${n}`).join(', '),
      })
    return groups
  }, [topBlockers])

  const bucketPct = (done: number, total: number) =>
    total > 0 ? Math.round((done / total) * 100) : 0

  async function applyChange(field: 'startDate' | 'endDate', next: Date) {
    const prevStart = start
    const prevEnd = end
    if (field === 'startDate') setStart(next)
    else setEnd(next)

    try {
      await sprintsClient.update(sprint.id, { [field]: next.toISOString() })
      toast.success(intl.formatMessage({ id: 'sprints.detail.dateUpdated' }))
      onRefresh()
    } catch (e) {
      // Roll back local state to whatever the server thinks is correct.
      setStart(prevStart)
      setEnd(prevEnd)
      toast.error(e instanceof Error ? e.message : 'Update failed')
    }
  }

  return (
    <div className='flex flex-col gap-4'>
      {/* Name + derived state badge */}
      <div>
        <p className='text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-0.5'>
          {sprint.name}
        </p>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATE_BADGE[state]}`}
        >
          {intl.formatMessage({ id: STATE_I18N_KEY[state] })}
        </span>
      </div>

      {/* Editable dates */}
      <div className='flex flex-col gap-1 text-sm'>
        <div className='flex items-center justify-between gap-2'>
          <span className='text-muted-foreground'>
            {intl.formatMessage({ id: 'sprints.detail.dateStart' })}
          </span>
          <DatePickerField
            variant='ghost'
            value={start}
            onChange={d => applyChange('startDate', startOfDay(d))}
          />
        </div>
        <div className='flex items-center justify-between gap-2'>
          <span className='text-muted-foreground'>
            {intl.formatMessage({ id: 'sprints.detail.dateEnd' })}
          </span>
          <DatePickerField
            variant='ghost'
            value={end}
            onChange={d => applyChange('endDate', startOfDay(d))}
          />
        </div>
      </div>

      {/* Progress */}
      <div className='flex flex-col gap-1.5'>
        <div className='flex justify-between text-xs text-muted-foreground'>
          <span>{intl.formatMessage({ id: 'sprints.detail.progress' })}</span>
          <span>
            {progress.done} / {progress.total}
          </span>
        </div>
        <Progress value={pct} className='h-2' />
        <p className='text-xs text-muted-foreground text-right'>{pct}%</p>
      </div>

      {/* Health — risk level + reasons + top blockers */}
      {risk && (
        <div className='flex flex-col gap-2'>
          <div className='flex items-center justify-between gap-2'>
            <p className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
              {intl.formatMessage({ id: 'sprints.detail.health' })}
            </p>
            <RiskBadge level={risk.level} size='sm' />
          </div>
          {reasonLine && (
            <p className='text-xs text-muted-foreground'>{reasonLine}</p>
          )}
          {blockerGroups.length > 0 && (
            <div className='flex flex-col gap-1.5 pt-1'>
              <p className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                {intl.formatMessage({ id: 'summary.topBlockers' })}
              </p>
              {blockerGroups.map(g => (
                <div
                  key={g.key}
                  className='flex items-start justify-between gap-2 text-xs'
                >
                  <span className='shrink-0 text-muted-foreground'>
                    {intl.formatMessage({ id: g.labelKey })}
                  </span>
                  <span className='break-all text-right'>{g.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Priority breakdown — hidden when sprint has no tasks */}
      {byPriority.length > 0 && (
        <div className='flex flex-col gap-2'>
          <p className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
            {intl.formatMessage({ id: 'sprints.detail.byPriority' })}
          </p>
          <div className='flex flex-col gap-2'>
            {byPriority.map(bucket => (
              <div key={bucket.priority} className='flex flex-col gap-1'>
                <div className='flex items-center justify-between text-xs'>
                  <PriorityBadge priority={bucket.priority} variant='icon' />
                  <span className='text-muted-foreground tabular-nums'>
                    {bucket.done} / {bucket.total}
                  </span>
                </div>
                <Progress
                  value={bucketPct(bucket.done, bucket.total)}
                  className='h-1.5'
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Member breakdown — hidden when no HUMAN assignees */}
      {byMember.length > 0 && (
        <div className='flex flex-col gap-2'>
          <p className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
            {intl.formatMessage({ id: 'sprints.detail.byMember' })}
          </p>
          <div className='flex flex-col gap-2'>
            {byMember.map(bucket => (
              <div key={bucket.member.id} className='flex flex-col gap-1'>
                <div className='flex items-center justify-between gap-2 text-xs'>
                  <span className='flex items-center gap-1.5 min-w-0'>
                    <MemberAvatar member={bucket.member} size='xs' />
                    <span className='truncate'>{bucket.member.name}</span>
                  </span>
                  <span className='text-muted-foreground tabular-nums shrink-0'>
                    {bucket.done} / {bucket.total}
                  </span>
                </div>
                <Progress
                  value={bucketPct(bucket.done, bucket.total)}
                  className='h-1.5'
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useState, useMemo } from 'react'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { TimelineEntry, WorkspaceMemberInfo } from '../../types'
import {
  TimelineEntryRenderer,
  RETIRED_ACTIVITY_TYPES,
} from './TimelineEntryRenderer'

// ── Filter categories ────────────────────────────────────────────────────────

const FILTER_CATEGORIES = [
  {
    id: 'all',
    labelId: 'activity.filter.all',
    defaultLabel: 'All',
    types: null as Set<string> | null, // special: matches everything
  },
  {
    id: 'comments',
    labelId: 'activity.filter.comments',
    defaultLabel: 'Comments',
    types: new Set(['__COMMENT__']), // special marker for comment entries
  },
  {
    id: 'status',
    labelId: 'activity.filter.status',
    defaultLabel: 'Status',
    types: new Set(['TASK_CREATED', 'STATUS_CHANGED']),
  },
  {
    id: 'priority',
    labelId: 'activity.filter.priority',
    defaultLabel: 'Priority',
    types: new Set(['PRIORITY_CHANGED']),
  },
  {
    id: 'assignee',
    labelId: 'activity.filter.assignee',
    defaultLabel: 'Assignee',
    types: new Set(['ASSIGNEE_CHANGED']),
  },
  {
    id: 'content',
    labelId: 'activity.filter.content',
    defaultLabel: 'Content',
    types: new Set(['TITLE_CHANGED', 'DESCRIPTION_CHANGED']),
  },
  {
    id: 'tags',
    labelId: 'activity.filter.tags',
    defaultLabel: 'Tags',
    types: new Set(['TAGS_CHANGED']),
  },
  {
    id: 'branch',
    labelId: 'activity.filter.branch',
    defaultLabel: 'PR',
    types: new Set([
      'PR_CREATED',
      'PR_MERGED',
      'PR_LINKED',
      'PR_UNLINKED',
      'REPOSITORY_CHANGED',
    ]),
  },
  {
    id: 'other',
    labelId: 'activity.filter.other',
    defaultLabel: 'Other',
    types: new Set([
      'DUE_DATE_CHANGED',
      // LUM-959: subtasks are gone; these only appear on older history rows.
      'PARENT_CHANGED',
      'SUBTASK_ADDED',
      'SUBTASK_REMOVED',
      'COMMENT_DELETED',
      'SPEC_GENERATED',
      'AGENT_RUN_STARTED',
      'AGENT_RUN_COMPLETED',
      'AGENT_RUN_FAILED',
      'AGENT_INPUT_REQUIRED',
      'BOUNDARY_CROSSING_DETECTED',
      'BOUNDARY_CROSSING_ACKNOWLEDGED',
      'BOUNDARY_CROSSING_DISPOSITIONED',
      'BOUNDARY_CROSSING_REJUDGED',
      'BOUNDARY_CROSSING_REMEDIATION_SPAWNED',
    ]),
  },
] as const

// ── Date grouping helpers ────────────────────────────────────────────────────

function getDateKey(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDateHeader(
  dateKey: string,
  intl: ReturnType<typeof useIntl>
): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year!, month! - 1, day)
  const now = new Date()

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  if (sameDay(date, now)) {
    return intl.formatMessage({
      id: 'activity.dateGroup.today',
      defaultMessage: 'Today',
    })
  }

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (sameDay(date, yesterday)) {
    return intl.formatMessage({
      id: 'activity.dateGroup.yesterday',
      defaultMessage: 'Yesterday',
    })
  }

  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(intl.locale, {
      month: 'short',
      day: 'numeric',
    })
  }

  return date.toLocaleDateString(intl.locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

interface DateGroup {
  dateKey: string
  entries: TimelineEntry[]
}

function groupByDate(entries: TimelineEntry[]): DateGroup[] {
  const groups: DateGroup[] = []
  let current: DateGroup | null = null

  for (const entry of entries) {
    const key = getDateKey(entry.createdAt)
    if (!current || current.dateKey !== key) {
      current = { dateKey: key, entries: [] }
      groups.push(current)
    }
    current.entries.push(entry)
  }

  return groups
}

// ── Component ────────────────────────────────────────────────────────────────

interface ActivityTimelineProps {
  entries: TimelineEntry[]
  loading: boolean
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  members: WorkspaceMemberInfo[]
  agentActors: { actorId: string; name: string; avatarColor: string }[]
}

export function ActivityTimeline({
  entries: rawEntries,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  members,
  agentActors,
}: ActivityTimelineProps) {
  const intl = useIntl()
  // LUM-942: acceptance-criteria / verification-round activities are retired —
  // old rows still exist but are no longer rendered.
  const entries = useMemo(
    () =>
      rawEntries.filter(
        e => e.kind !== 'activity' || !RETIRED_ACTIVITY_TYPES.has(e.type)
      ),
    [rawEntries]
  )
  // 'all' means show everything; otherwise a single category id
  const [activeFilter, setActiveFilter] = useState<string>('all')

  const handleFilter = (id: string) => {
    setActiveFilter(prev => (prev === id ? 'all' : id))
  }

  // Build allowed type set from active filter
  const allowedTypes = useMemo(() => {
    if (activeFilter === 'all') return null
    const cat = FILTER_CATEGORIES.find(c => c.id === activeFilter)
    return cat?.types ?? null
  }, [activeFilter])

  // Filter entries: 'all' shows everything, 'comments' shows only comments,
  // other filters show only matching activity types (no comments)
  const filteredEntries = useMemo(() => {
    if (!allowedTypes) return entries // 'all' — show everything including comments
    return entries.filter(e => {
      if (e.kind === 'comment') return allowedTypes.has('__COMMENT__')
      return allowedTypes.has(e.type)
    })
  }, [entries, allowedTypes])

  const visibleCategories = useMemo(() => {
    return FILTER_CATEGORIES.filter(cat => {
      if (cat.id === 'all') return true
      return entries.some(e => {
        if (e.kind === 'comment') return cat.types!.has('__COMMENT__')
        return cat.types!.has(e.type)
      })
    })
  }, [entries])

  const dateGroups = useMemo(
    () => groupByDate(filteredEntries),
    [filteredEntries]
  )

  if (loading) {
    return (
      <div className='space-y-3 py-4'>
        {[1, 2, 3].map(i => (
          <div key={i} className='flex gap-2.5'>
            <div className='size-5 rounded-full bg-muted animate-pulse shrink-0' />
            <div className='flex-1 space-y-1.5 pt-0.5'>
              <div className='h-2.5 bg-muted rounded-sm animate-pulse w-2/3' />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <p className='text-caption text-muted-foreground py-4'>
        {intl.formatMessage({
          id: 'activity.empty',
          defaultMessage: 'No activity yet',
        })}
      </p>
    )
  }

  return (
    <div className='py-2'>
      {/* Filter chips */}
      <div className='flex flex-wrap gap-1.5 mb-3'>
        {visibleCategories.map(cat => {
          const isActive = activeFilter === cat.id
          return (
            <button
              key={cat.id}
              onClick={() => handleFilter(cat.id)}
              className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
                isActive
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              {intl.formatMessage({
                id: cat.labelId,
                defaultMessage: cat.defaultLabel,
              })}
            </button>
          )
        })}
      </div>

      {/* Load earlier */}
      {hasMore && (
        <div className='flex justify-center mb-3'>
          <Button
            variant='ghost'
            size='sm'
            className='text-caption text-muted-foreground hover:text-foreground'
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? <Spinner className='size-3 mr-1' /> : null}
            {intl.formatMessage({
              id: 'activity.loadEarlier',
              defaultMessage: 'Load earlier activity',
            })}
          </Button>
        </div>
      )}

      {/* Date-grouped entries */}
      <div className='space-y-4'>
        {dateGroups.map(group => (
          <div key={group.dateKey}>
            {/* Date header */}
            <div className='flex items-center gap-2 mb-1.5'>
              <span className='text-[11px] font-medium text-muted-foreground whitespace-nowrap'>
                {formatDateHeader(group.dateKey, intl)}
              </span>
              <div className='flex-1 h-px bg-border' />
            </div>
            {/* Entries with left timeline line */}
            <div className='space-y-0.5'>
              {group.entries.map(entry => (
                <TimelineEntryRenderer
                  key={`${entry.kind}-${entry.id}`}
                  entry={entry}
                  members={members}
                  agentActors={agentActors}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Empty filter result */}
      {filteredEntries.length === 0 && entries.length > 0 && (
        <p className='text-caption text-muted-foreground py-4 text-center'>
          {intl.formatMessage({
            id: 'activity.filter.noResults',
            defaultMessage: 'No matching activities',
          })}
        </p>
      )}
    </div>
  )
}

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { useIntl } from 'react-intl'
import { cn } from '@/lib/utils'
import type {
  ApiMilestone,
  MilestoneSegmentEntry,
} from '@/lib/api-client/milestones'

const DIMENSIONS = ['sprint', 'priority', 'workstream'] as const
type Dimension = (typeof DIMENSIONS)[number]

/** TaskPriority values with a reusable `priority.*` label key. */
const KNOWN_PRIORITIES = new Set(['URGENT', 'HIGH', 'MEDIUM', 'LOW'])

/** The explicit no-sprint / no-workstream bucket key (server contract). */
const NONE_KEY = 'NONE'

/**
 * LUM-628 — the Overview tab's segmentation section: member tasks grouped by
 * sprint / priority / workstream (=tag), one dimension at a time. Each segment
 * is an expandable rollup row (done/total), and its task rows link to the
 * task's detail page — the drill-down to per-task evidence. A rollup summary,
 * not a second task board; hierarchy via typography, not color.
 */
export function MilestoneSegmentsSection({
  segments,
  workspaceUrl,
}: {
  segments: ApiMilestone['segments']
  workspaceUrl: string
}) {
  const intl = useIntl()
  const [dimension, setDimension] = useState<Dimension>('sprint')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  if (!segments) return null

  const taskById = new Map(segments.tasks.map(t => [t.taskId, t]))

  const segmentLabel = (segment: MilestoneSegmentEntry): string => {
    if (dimension === 'priority') {
      return intl.formatMessage({
        id: KNOWN_PRIORITIES.has(segment.key)
          ? `priority.${segment.key.toLowerCase()}`
          : 'milestone.segments.unknown',
      })
    }
    if (segment.key === NONE_KEY) {
      return intl.formatMessage({
        id:
          dimension === 'sprint'
            ? 'milestone.segments.noSprint'
            : 'milestone.segments.noWorkstream',
      })
    }
    return (
      segment.label ?? intl.formatMessage({ id: 'milestone.segments.unknown' })
    )
  }

  return (
    <section className='mt-10 max-w-3xl'>
      <p className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3'>
        {intl.formatMessage({ id: 'milestone.segments.title' })}
      </p>

      {segments.tasks.length === 0 ? (
        <p className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'milestone.segments.empty' })}
        </p>
      ) : (
        <div className='space-y-3'>
          <div className='flex items-center gap-1'>
            {DIMENSIONS.map(d => (
              <button
                key={d}
                onClick={() => setDimension(d)}
                className={cn(
                  'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                  dimension === d
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                )}
              >
                {intl.formatMessage({
                  id: `milestone.segments.dimension.${d}`,
                })}
              </button>
            ))}
          </div>

          <ul className='space-y-1'>
            {segments[dimension].map(segment => {
              const stateKey = `${dimension}:${segment.key}`
              const isOpen = !!expanded[stateKey]
              return (
                <li key={segment.key}>
                  <button
                    aria-expanded={isOpen}
                    onClick={() =>
                      setExpanded(prev => ({ ...prev, [stateKey]: !isOpen }))
                    }
                    className='flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-muted/50'
                  >
                    <ChevronRight
                      className={cn(
                        'h-3 w-3 shrink-0 self-center text-muted-foreground transition-transform',
                        isOpen && 'rotate-90'
                      )}
                    />
                    <span className='min-w-0 truncate font-medium text-foreground'>
                      {segmentLabel(segment)}
                    </span>
                    <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>
                      {intl.formatMessage(
                        { id: 'milestone.segments.count' },
                        {
                          done: segment.doneCount,
                          total: segment.taskIds.length,
                        }
                      )}
                    </span>
                  </button>

                  {isOpen && (
                    <ul className='ml-6 space-y-0.5 py-1'>
                      {segment.taskIds.map(taskId => {
                        const task = taskById.get(taskId)
                        if (!task) return null
                        return (
                          <li key={taskId}>
                            <Link
                              href={`/workspace/${workspaceUrl}/my-tasks/${task.ref}`}
                              className='flex items-baseline gap-2 rounded-md px-1.5 py-0.5 text-sm hover:bg-muted/50'
                            >
                              <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>
                                {task.ref}
                              </span>
                              <span
                                className={cn(
                                  'min-w-0 truncate',
                                  task.status === 'DONE'
                                    ? 'text-muted-foreground line-through decoration-muted-foreground/40'
                                    : 'text-foreground'
                                )}
                              >
                                {task.title}
                              </span>
                            </Link>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}

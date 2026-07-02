'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useIntl } from 'react-intl'
import type { TaskStatus } from '@prisma/client'
import { cn } from '@/lib/utils'
import { StatusIcon } from '../StatusIcon'
import type {
  ApiMilestone,
  MilestoneSegmentEntry,
} from '@/lib/api-client/milestones'

/** Claim provenance values the cards know how to label (LUM-597 layering). */
const KNOWN_SOURCES = new Set(['AGENT', 'RUN_SUMMARY', 'DIGEST'])

/** OutcomeSignalKind values with a label key; must track the Prisma enum. */
const KNOWN_KINDS = new Set([
  'REVERTED',
  'REOPENED',
  'ROLLED_BACK',
  'CI_REGRESSION',
  'DOWNSTREAM_REDIRECT',
  'BYPASSED',
  'MANUAL',
])

/** react-intl message ids for the task-status filter pills. */
const STATUS_LABEL_ID: Record<string, string> = {
  TODO: 'status.todo',
  IN_PROGRESS: 'status.inProgress',
  IN_REVIEW: 'status.inReview',
  DONE: 'status.done',
}

/** Fixed pill order — presence-filtered, never re-sorted by count. */
const STATUS_ORDER: TaskStatus[] = ['DONE', 'IN_PROGRESS', 'IN_REVIEW', 'TODO']

const GROUPINGS = ['none', 'sprint', 'priority', 'workstream'] as const
type Grouping = (typeof GROUPINGS)[number]

/** TaskPriority values with a reusable `priority.*` label key. */
const KNOWN_PRIORITIES = new Set(['URGENT', 'HIGH', 'MEDIUM', 'LOW'])

/** The explicit no-sprint / no-workstream bucket key (server contract). */
const NONE_KEY = 'NONE'

type SegmentsPayload = NonNullable<ApiMilestone['segments']>
type EvidenceTask = SegmentsPayload['tasks'][number]

interface MilestoneTaskEvidenceSectionProps {
  segments: ApiMilestone['segments']
  outcome: ApiMilestone['outcome']
  workspaceUrl: string
}

/**
 * LUM-636 task evidence grid — the drill-down layer of the mission-control
 * Overview. One card per member task: ref, status, title, the frozen
 * delivery claim (explicitly labeled self-reported; a claim-less card states
 * so instead of hiding), any post-delivery rejection signals, and the
 * evidence link into the task's detail page. Status pills filter
 * client-side; the group control reuses the LUM-628 segment rollup
 * (sprint / priority / workstream) so segment membership — including the
 * explicit no-sprint / no-workstream buckets — matches the read model
 * exactly. Honest by construction: no per-task numbers are fabricated here;
 * anything the read model doesn't carry simply doesn't render.
 */
export function MilestoneTaskEvidenceSection({
  segments,
  outcome,
  workspaceUrl,
}: MilestoneTaskEvidenceSectionProps) {
  const intl = useIntl()
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'ALL'>('ALL')
  const [grouping, setGrouping] = useState<Grouping>('none')
  if (!segments) return null

  const tasks = segments.tasks
  const claimByTask = new Map(
    (outcome?.claims ?? []).map(c => [c.taskId, c] as const)
  )
  const rejectedByTask = new Map(
    (outcome?.fate.rejected ?? []).map(r => [r.taskId, r] as const)
  )

  const statusesPresent = STATUS_ORDER.filter(s =>
    tasks.some(t => t.status === s)
  )
  const countFor = (s: TaskStatus) => tasks.filter(t => t.status === s).length
  const visible = (list: EvidenceTask[]) =>
    statusFilter === 'ALL' ? list : list.filter(t => t.status === statusFilter)

  const segmentLabel = (segment: MilestoneSegmentEntry): string => {
    if (grouping === 'priority') {
      return intl.formatMessage({
        id: KNOWN_PRIORITIES.has(segment.key)
          ? `priority.${segment.key.toLowerCase()}`
          : 'milestone.segments.unknown',
      })
    }
    if (segment.key === NONE_KEY) {
      return intl.formatMessage({
        id:
          grouping === 'sprint'
            ? 'milestone.segments.noSprint'
            : 'milestone.segments.noWorkstream',
      })
    }
    return (
      segment.label ?? intl.formatMessage({ id: 'milestone.segments.unknown' })
    )
  }

  const taskById = new Map(tasks.map(t => [t.taskId, t]))

  const filterPill = (active: boolean) =>
    cn(
      'rounded-full px-3 py-1 text-xs font-medium transition-colors',
      active
        ? 'bg-foreground text-background'
        : 'border border-border bg-card text-muted-foreground hover:text-foreground'
    )

  const card = (task: EvidenceTask) => {
    const claim = claimByTask.get(task.taskId)
    const rejected = rejectedByTask.get(task.taskId)
    return (
      <div
        key={task.taskId}
        className={cn(
          'rounded-lg border bg-card p-4',
          task.status === 'IN_PROGRESS' ? undefined : 'border-border'
        )}
        style={
          task.status === 'IN_PROGRESS'
            ? {
                borderColor:
                  'color-mix(in srgb, var(--status-in-progress) 35%, transparent)',
              }
            : undefined
        }
      >
        <div className='mb-1.5 flex flex-wrap items-center gap-2'>
          <span className='text-xs font-semibold tabular-nums text-muted-foreground'>
            {task.ref}
          </span>
          <span className='inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium'>
            <StatusIcon status={task.status} size={11} />
            {intl.formatMessage({
              id: STATUS_LABEL_ID[task.status] ?? 'status.todo',
            })}
          </span>
          {rejected &&
            rejected.kinds.map(k => (
              <span
                key={k.kind}
                className='rounded-full border border-[var(--danger-border)] bg-[var(--danger-subtle)] px-2 py-0.5 text-[11px] font-medium'
              >
                {intl.formatMessage(
                  {
                    id: KNOWN_KINDS.has(k.kind)
                      ? `milestone.outcome.fate.kind.${k.kind}`
                      : 'milestone.outcome.fate.kind.UNKNOWN',
                  },
                  { kind: k.kind, count: k.count }
                )}
              </span>
            ))}
        </div>
        <p className='mb-1.5 text-sm font-semibold leading-snug'>
          {task.title}
        </p>
        {claim?.claim ? (
          <p className='mb-2.5 text-sm leading-relaxed text-foreground/80'>
            {claim.claim}
          </p>
        ) : (
          <p className='mb-2.5 text-sm italic text-muted-foreground'>
            {intl.formatMessage({ id: 'milestone.outcome.claims.noClaim' })}
          </p>
        )}
        <div className='flex flex-wrap items-center gap-2 text-xs'>
          {claim?.source && KNOWN_SOURCES.has(claim.source) && (
            <span className='rounded-md bg-muted px-2 py-0.5 text-muted-foreground'>
              {intl.formatMessage({
                id: `milestone.outcome.claims.source.${claim.source}`,
              })}
            </span>
          )}
          <Link
            href={`/workspace/${workspaceUrl}/my-tasks/${task.ref}`}
            className='ml-auto font-medium text-foreground hover:underline'
          >
            {intl.formatMessage({ id: 'milestone.taskEvidence.evidence' })} →
          </Link>
        </div>
      </div>
    )
  }

  const grid = (list: EvidenceTask[]) => (
    <div className='grid gap-3.5 md:grid-cols-2'>{list.map(card)}</div>
  )

  return (
    <section className='mb-10'>
      <div className='mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-2'>
        <h2 className='text-base font-bold'>
          {intl.formatMessage({ id: 'milestone.taskEvidence.title' })}
        </h2>
        <span className='text-xs text-muted-foreground'>
          {intl.formatMessage({ id: 'milestone.taskEvidence.subtitle' })}
        </span>
        {tasks.length > 0 && (
          <span className='ml-auto flex flex-wrap items-center gap-1.5'>
            <button
              type='button'
              className={filterPill(statusFilter === 'ALL')}
              onClick={() => setStatusFilter('ALL')}
            >
              {intl.formatMessage(
                { id: 'milestone.taskEvidence.filterAll' },
                { count: tasks.length }
              )}
            </button>
            {statusesPresent.map(s => (
              <button
                key={s}
                type='button'
                className={filterPill(statusFilter === s)}
                onClick={() => setStatusFilter(s)}
              >
                {intl.formatMessage({
                  id: STATUS_LABEL_ID[s] ?? 'status.todo',
                })}{' '}
                {countFor(s)}
              </button>
            ))}
            <span aria-hidden='true' className='mx-1 h-4 w-px bg-border' />
            {GROUPINGS.map(g => (
              <button
                key={g}
                type='button'
                className={filterPill(grouping === g)}
                onClick={() => setGrouping(g)}
              >
                {intl.formatMessage({
                  id:
                    g === 'none'
                      ? 'milestone.taskEvidence.groupNone'
                      : `milestone.segments.dimension.${g}`,
                })}
              </button>
            ))}
          </span>
        )}
      </div>

      {tasks.length === 0 ? (
        <p className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'milestone.segments.empty' })}
        </p>
      ) : grouping === 'none' ? (
        grid(visible(tasks))
      ) : (
        <div className='space-y-6'>
          {segments[grouping].map(segment => {
            const segmentTasks = visible(
              segment.taskIds
                .map(id => taskById.get(id))
                .filter((t): t is EvidenceTask => t !== undefined)
            )
            if (segmentTasks.length === 0) return null
            return (
              <div key={segment.key}>
                <div className='mb-2.5 flex items-baseline gap-2'>
                  <h3 className='text-sm font-semibold'>
                    {segmentLabel(segment)}
                  </h3>
                  <span className='text-xs tabular-nums text-muted-foreground'>
                    {intl.formatMessage(
                      { id: 'milestone.segments.count' },
                      {
                        done: segment.doneCount,
                        total: segment.taskIds.length,
                      }
                    )}
                  </span>
                </div>
                {grid(segmentTasks)}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

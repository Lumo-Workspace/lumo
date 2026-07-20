'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { ChevronRight, CheckCircle2, Sparkles } from 'lucide-react'
import { formatDurationSec } from '@/lib/datetime/duration'
import { useSprintTeamPerformance } from '../../hooks/useSprints'
import type {
  SprintMemberPerfRowDto,
  SprintMemberTaskRowDto,
} from '@/lib/api-client/sprints'
import type { WorkspaceMemberInfo } from '../../types'
import { MemberAvatar } from '../../components/fields/shared'
import { PriorityBadge } from '../../components/PriorityBadge'

/** Compact token count, e.g. `12.7M` — mirrors the CLI / milestone reading. */
const TOKEN_FMT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

// Shared column template so header, member rows and drill-down rows align.
const COLS =
  'grid grid-cols-[minmax(180px,1.1fr)_110px_minmax(140px,1fr)_minmax(120px,1fr)_minmax(160px,1fr)] items-center'

interface Props {
  sprintId: string
  members: WorkspaceMemberInfo[]
}

export function SprintTeamPerformance({ sprintId, members }: Props) {
  const intl = useIntl()
  const { performance, isLoading } = useSprintTeamPerformance(sprintId)
  const [open, setOpen] = useState<Set<string>>(new Set())

  if (isLoading) {
    return (
      <div className='h-24 animate-pulse rounded-lg border border-border' />
    )
  }
  if (!performance || performance.rows.length === 0) return null

  const total = performance.totalTokenCost
  const memberById = new Map(members.map(m => [m.id, m]))
  const toggle = (key: string) =>
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const fmtTokens = (n: number) => TOKEN_FMT.format(n)
  const share = (n: number) =>
    total && total > 0 ? Math.round((n / total) * 100) : 0

  return (
    <section className='flex flex-col gap-2.5'>
      <div className='flex items-baseline gap-2.5'>
        <h2 className='text-body-strong'>
          {intl.formatMessage({
            id: 'sprints.team.title',
            defaultMessage: 'Team performance',
          })}
        </h2>
        <span className='text-caption text-muted-foreground'>
          {intl.formatMessage({
            id: 'sprints.team.subtitle',
            defaultMessage:
              'Tasks, token usage and agent time attributed per member · click a row to break down by task',
          })}
        </span>
      </div>

      <div className='overflow-hidden rounded-lg border border-border'>
        {/* Header */}
        <div
          className={`${COLS} h-9 border-b border-border bg-muted/40 text-caption font-medium uppercase tracking-wider text-muted-foreground`}
        >
          <div className='px-5'>
            {intl.formatMessage({
              id: 'sprints.team.colMember',
              defaultMessage: 'Member',
            })}
          </div>
          <div>
            {intl.formatMessage({
              id: 'sprints.team.colTasks',
              defaultMessage: 'Tasks done',
            })}
          </div>
          <div>
            {intl.formatMessage({
              id: 'sprints.team.colTokens',
              defaultMessage: 'Tokens',
            })}
          </div>
          <div>
            {intl.formatMessage({
              id: 'sprints.team.colTime',
              defaultMessage: 'Agent time',
            })}
          </div>
          <div className='pr-5'>
            {intl.formatMessage({
              id: 'sprints.team.colShare',
              defaultMessage: 'Token share',
            })}
          </div>
        </div>

        {performance.rows.map(row => {
          const key = row.memberId ?? '__unattributed__'
          const member = row.memberId ? memberById.get(row.memberId) : undefined
          const isOpen = open.has(key)
          return (
            <div key={key}>
              <MemberRow
                row={row}
                member={member}
                isOpen={isOpen}
                onToggle={() => toggle(key)}
                fmtTokens={fmtTokens}
                sharePct={share(row.tokenCost)}
                fmtTime={sec => formatDurationSec(intl, sec)}
                unattributedLabel={intl.formatMessage({
                  id: 'sprints.team.unattributed',
                  defaultMessage: 'Unattributed',
                })}
                tasksDoneMax={Math.max(
                  1,
                  ...performance.rows.map(r => r.tasksDone)
                )}
              />
              {isOpen && (
                <DrillDown
                  row={row}
                  fmtTokens={fmtTokens}
                  fmtTime={sec => formatDurationSec(intl, sec)}
                />
              )}
            </div>
          )
        })}

        {/* Footer */}
        <div className='flex items-center gap-2 bg-muted/40 px-5 py-2.5 text-caption text-muted-foreground'>
          <Sparkles className='size-3 text-primary' />
          <span>
            {intl.formatMessage(
              {
                id: 'sprints.team.footer',
                defaultMessage:
                  'Tokens folded across models per member · sprint total {tokens} · {time} agent time · {runs} runs',
              },
              {
                tokens:
                  total === null
                    ? '—'
                    : intl.formatMessage(
                        {
                          id: 'sprints.team.tokensTotal',
                          defaultMessage: '{n} tokens',
                        },
                        { n: fmtTokens(total) }
                      ),
                time: formatDurationSec(intl, performance.totalActiveTimeSec),
                runs: performance.totalRuns,
              }
            )}
          </span>
        </div>
      </div>
    </section>
  )
}

function MemberRow({
  row,
  member,
  isOpen,
  onToggle,
  fmtTokens,
  sharePct,
  fmtTime,
  unattributedLabel,
  tasksDoneMax,
}: {
  row: SprintMemberPerfRowDto
  member: WorkspaceMemberInfo | undefined
  isOpen: boolean
  onToggle: () => void
  fmtTokens: (n: number) => string
  sharePct: number
  fmtTime: (sec: number) => string
  unattributedLabel: string
  tasksDoneMax: number
}) {
  const intl = useIntl()
  return (
    <button
      type='button'
      onClick={onToggle}
      aria-expanded={isOpen}
      className={`${COLS} h-14 w-full border-b border-border text-left hover:bg-muted/30`}
    >
      {/* Member */}
      <div className='flex min-w-0 items-center gap-2 pl-3.5 pr-3'>
        <ChevronRight
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
            isOpen ? 'rotate-90' : ''
          }`}
        />
        {member ? (
          <MemberAvatar member={member} size='sm' />
        ) : (
          <span className='flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-caption text-muted-foreground'>
            ?
          </span>
        )}
        <span className='min-w-0'>
          <span className='block truncate text-body-strong'>
            {row.label ?? unattributedLabel}
          </span>
          {member && (
            <span className='block truncate text-caption text-muted-foreground'>
              {member.role}
            </span>
          )}
        </span>
      </div>

      {/* Tasks done */}
      <div className='flex flex-col gap-1.5 pr-6'>
        <span className='text-body-strong tabular-nums'>{row.tasksDone}</span>
        <span className='block h-1 w-16 overflow-hidden rounded-full bg-muted'>
          <span
            className='block h-full bg-success'
            style={{ width: `${(row.tasksDone / tasksDoneMax) * 100}%` }}
          />
        </span>
      </div>

      {/* Tokens */}
      <div className='flex flex-col gap-0.5'>
        <span className='text-body-strong tabular-nums'>
          {fmtTokens(row.tokenCost)}
        </span>
        {row.models.length > 0 && (
          <span className='truncate text-caption text-muted-foreground'>
            {intl.formatMessage(
              {
                id: 'sprints.team.modelCount',
                defaultMessage: '{n, plural, one {# model} other {# models}}',
              },
              { n: row.models.length }
            )}
          </span>
        )}
      </div>

      {/* Agent time */}
      <div className='flex flex-col gap-0.5'>
        <span className='text-body-strong tabular-nums'>
          {fmtTime(row.activeTimeSec)}
        </span>
        <span className='text-caption text-muted-foreground'>
          {intl.formatMessage(
            {
              id: 'sprints.team.runCount',
              defaultMessage: '{n, plural, one {# run} other {# runs}}',
            },
            { n: row.runs }
          )}
        </span>
      </div>

      {/* Token share */}
      <div className='flex items-center gap-3 pr-5'>
        <span className='block h-1.5 flex-1 overflow-hidden rounded-full bg-muted'>
          <span
            className='block h-full rounded-full bg-chart-1'
            style={{ width: `${sharePct}%` }}
          />
        </span>
        <span className='w-9 text-right text-caption tabular-nums text-muted-foreground'>
          {sharePct}%
        </span>
      </div>
    </button>
  )
}

function DrillDown({
  row,
  fmtTokens,
  fmtTime,
}: {
  row: SprintMemberPerfRowDto
  fmtTokens: (n: number) => string
  fmtTime: (sec: number) => string
}) {
  const intl = useIntl()
  return (
    <div className='border-b border-border bg-muted/20'>
      {row.perTask.map(task => (
        <TaskRow
          key={task.taskId}
          task={task}
          fmtTokens={fmtTokens}
          fmtTime={fmtTime}
        />
      ))}
      {row.models.length > 0 && (
        <div className='flex flex-wrap items-center gap-2 border-t border-border py-2.5 pl-16 pr-4'>
          <span className='text-caption font-semibold uppercase tracking-wider text-muted-foreground'>
            {intl.formatMessage({
              id: 'sprints.team.byModel',
              defaultMessage: 'By model',
            })}
          </span>
          {row.models.map(m => (
            <span
              key={m.model}
              className='inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 text-caption'
            >
              <span className='font-mono text-muted-foreground'>{m.model}</span>
              <b className='tabular-nums'>{fmtTokens(m.total)}</b>
            </span>
          ))}
          {row.modelUnattributedTokens > 0 && (
            <span className='inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 text-caption text-muted-foreground'>
              {intl.formatMessage({
                id: 'sprints.team.modelOther',
                defaultMessage: 'other',
              })}
              <b className='tabular-nums'>
                {fmtTokens(row.modelUnattributedTokens)}
              </b>
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function TaskRow({
  task,
  fmtTokens,
  fmtTime,
}: {
  task: SprintMemberTaskRowDto
  fmtTokens: (n: number) => string
  fmtTime: (sec: number) => string
}) {
  const intl = useIntl()
  const done = task.status === 'DONE'
  return (
    <div className={`${COLS} h-12 border-t border-border first:border-t-0`}>
      <div className='flex min-w-0 items-center gap-2.5 pl-16 pr-4'>
        {done ? (
          <CheckCircle2 className='size-3.5 shrink-0 text-success' />
        ) : (
          <span className='size-3.5 shrink-0 rounded-full border border-border' />
        )}
        <span className='shrink-0 font-mono text-caption text-muted-foreground'>
          {task.identifier}
        </span>
        <span className='min-w-0 truncate text-body text-foreground'>
          {task.title}
        </span>
      </div>
      <div>
        {task.priority && (
          <PriorityBadge priority={task.priority} variant='bare' />
        )}
      </div>
      <div className='flex flex-col gap-px'>
        <span className='flex items-center gap-1.5 text-body tabular-nums'>
          {fmtTokens(task.tokenCost)}
          {task.topModel && (
            <span className='inline-flex rounded-sm bg-muted px-1.5 font-mono text-caption text-muted-foreground'>
              {task.topModel}
            </span>
          )}
        </span>
      </div>
      <div className='text-body tabular-nums text-foreground'>
        {fmtTime(task.activeTimeSec)}
      </div>
      <div className='pr-5 text-right text-caption text-muted-foreground'>
        {intl.formatDate(new Date(task.updatedAt), {
          month: 'short',
          day: 'numeric',
        })}
      </div>
    </div>
  )
}

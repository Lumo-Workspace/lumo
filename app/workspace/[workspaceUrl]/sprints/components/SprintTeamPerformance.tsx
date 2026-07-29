'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { ChevronRight } from 'lucide-react'
import { formatDurationSec } from '@/lib/datetime/duration'
import { useSprintTeamPerformance } from '../../hooks/useSprints'
import type {
  SprintMemberPerfRowDto,
  SprintMemberTaskRowDto,
  SprintTeamPerformanceResponse,
} from '@/lib/api-client/sprints'
import type { WorkspaceMemberInfo } from '../../types'
import { MemberAvatar } from '../../components/fields/shared'
import { TokenCostBreakdown } from '../../components/TokenCostBreakdown'

/** Compact token count, e.g. `12.7M` — mirrors the CLI / milestone reading. */
const TOKEN_FMT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

// Shared column template so member rows and their task rows line up on the
// same three numeric columns.
const COLS =
  'grid grid-cols-[minmax(0,1fr)_110px_110px_110px_28px] items-center gap-3'

interface Props {
  sprintId: string
  members: WorkspaceMemberInfo[]
}

export function SprintTeamPerformance({ sprintId, members }: Props) {
  const { performance, isLoading } = useSprintTeamPerformance(sprintId)

  if (isLoading) {
    return (
      <div className='h-24 animate-pulse rounded-lg border border-border' />
    )
  }
  if (!performance || performance.rows.length === 0) return null

  return (
    <SprintTeamPerformanceView performance={performance} members={members} />
  )
}

/**
 * Pure rendering half of the panel — takes an already-loaded rollup so the
 * fetching lives in one place (SRP) and the table can be rendered against
 * fixtures.
 *
 * One flat list: each member is a header line carrying their own totals, with
 * their tasks listed straight underneath. The only disclosure left is the task
 * line's own per-model token split — the column header, the token-share bar
 * and the reconciliation footer were dropped so the block reads as a roster
 * rather than a report.
 */
function SprintTeamPerformanceView({
  performance,
  members,
}: {
  performance: SprintTeamPerformanceResponse
  members: WorkspaceMemberInfo[]
}) {
  const intl = useIntl()
  const memberById = new Map(members.map(m => [m.id, m]))

  const fmtTokens = (n: number) => TOKEN_FMT.format(n)

  return (
    <section className='flex flex-col gap-2.5'>
      <h2 className='text-body-strong'>
        {intl.formatMessage({
          id: 'sprints.team.title',
          defaultMessage: 'Team performance',
        })}
      </h2>

      <div className='overflow-hidden rounded-lg border border-border'>
        {performance.rows.map(row => {
          const key = row.memberId ?? '__unattributed__'
          const member = row.memberId ? memberById.get(row.memberId) : undefined
          return (
            <div key={key} className='border-b border-border last:border-b-0'>
              <MemberRow
                row={row}
                member={member}
                fmtTokens={fmtTokens}
                fmtTime={sec => formatDurationSec(intl, sec)}
                unattributedLabel={intl.formatMessage({
                  id: 'sprints.team.unattributed',
                  defaultMessage: 'Unattributed',
                })}
              />
              {row.perTask.map(task => (
                <TaskRow
                  key={task.taskId}
                  task={task}
                  fmtTokens={fmtTokens}
                  fmtTime={sec => formatDurationSec(intl, sec)}
                />
              ))}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** A member's own line — avatar, name, and the three totals for the sprint. */
function MemberRow({
  row,
  member,
  fmtTokens,
  fmtTime,
  unattributedLabel,
}: {
  row: SprintMemberPerfRowDto
  member: WorkspaceMemberInfo | undefined
  fmtTokens: (n: number) => string
  fmtTime: (sec: number) => string
  unattributedLabel: string
}) {
  const intl = useIntl()
  return (
    <div className={`${COLS} border-b border-border px-5 py-3.5`}>
      {/* Name only — a sprint belongs to a team, while `member.role` is the
          workspace/project-level role, so showing it here would label the row
          with a scope this table doesn't speak for. */}
      <div className='flex min-w-0 items-center gap-2.5'>
        {member ? (
          <MemberAvatar member={member} size='sm' />
        ) : (
          <span className='flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-caption text-muted-foreground'>
            ?
          </span>
        )}
        <span className='min-w-0 truncate text-body-strong'>
          {row.label ?? unattributedLabel}
        </span>
      </div>
      <span className='text-right text-caption tabular-nums text-muted-foreground'>
        {intl.formatMessage(
          {
            id: 'sprints.team.memberTasks',
            defaultMessage: '{n, plural, one {# task} other {# tasks}}',
          },
          { n: row.tasksDone }
        )}
      </span>
      <span className='text-right text-caption tabular-nums text-muted-foreground'>
        {intl.formatMessage(
          {
            id: 'sprints.team.memberTokens',
            defaultMessage: '{n} tok',
          },
          { n: fmtTokens(row.tokenCost) }
        )}
      </span>
      <span className='text-right text-caption tabular-nums text-muted-foreground'>
        {fmtTime(row.activeTimeSec)}
      </span>
      <span />
    </div>
  )
}

/**
 * One task line under its member — reads as tokens/time/date, and expanding it
 * reveals that task's per-model token composition (the same
 * {@link TokenCostBreakdown} the run timeline uses, so the four token kinds
 * keep one palette across the app).
 */
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
  const [open, setOpen] = useState(false)
  // Spend the per-model fold can't place (pre-LUM-298 sessions). Stated, never
  // folded into a model row — the same honesty rule as the member row.
  const remainder = Math.max(
    0,
    task.tokenCost - task.models.reduce((sum, m) => sum + m.total, 0)
  )
  return (
    <div className='border-b border-border last:border-b-0'>
      <button
        type='button'
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className={`${COLS} w-full px-5 py-3 text-left hover:bg-muted/30`}
      >
        <span className='flex min-w-0 items-center gap-2.5'>
          <span className='shrink-0 font-mono text-caption text-muted-foreground'>
            {task.identifier}
          </span>
          <span className='min-w-0 truncate text-body'>{task.title}</span>
        </span>
        <span className='text-right text-caption tabular-nums'>
          {fmtTokens(task.tokenCost)}
        </span>
        <span className='text-right text-caption tabular-nums text-muted-foreground'>
          {fmtTime(task.activeTimeSec)}
        </span>
        <span className='text-right text-caption text-muted-foreground'>
          {intl.formatDate(new Date(task.updatedAt), {
            month: 'short',
            day: 'numeric',
          })}
        </span>
        <ChevronRight
          className={`size-3.5 justify-self-end text-muted-foreground transition-transform ${
            open ? 'rotate-90' : ''
          }`}
        />
      </button>

      {open && (
        <div className='bg-muted/20 px-5 pb-3.5 pt-1'>
          {/* No model split captured (pre-LUM-298 sessions) → the remainder
              line below carries the whole spend on its own. */}
          {task.models.length > 0 && (
            <TokenCostBreakdown
              models={task.models}
              variant='compact'
              showTitle={false}
            />
          )}
          {remainder > 0 && (
            <div className='mt-2 text-caption text-muted-foreground'>
              {intl.formatMessage(
                {
                  id: 'sprints.team.taskModelRemainder',
                  defaultMessage: '{n} not attributed to a model',
                },
                { n: fmtTokens(remainder) }
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

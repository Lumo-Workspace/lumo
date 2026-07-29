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

// Shared column template so header, member rows and drill-down rows align.
const COLS =
  'grid grid-cols-[minmax(180px,1.1fr)_110px_minmax(140px,1fr)_minmax(120px,1fr)_minmax(160px,1fr)] items-center'

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
 */
function SprintTeamPerformanceView({
  performance,
  members,
}: {
  performance: SprintTeamPerformanceResponse
  members: WorkspaceMemberInfo[]
}) {
  const intl = useIntl()
  const [open, setOpen] = useState<Set<string>>(new Set())

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
      <h2 className='text-body-strong'>
        {intl.formatMessage({
          id: 'sprints.team.title',
          defaultMessage: 'Progress',
        })}
      </h2>

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
        {/* Name only — a sprint belongs to a team, while `member.role` is the
            workspace/project-level role, so showing it here would label the
            row with a scope this table doesn't speak for. */}
        <span className='min-w-0 truncate text-body-strong'>
          {row.label ?? unattributedLabel}
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

      {/* Tokens — the model count and run count used to sit under these two
          numbers; the columns already say what they are, so the numbers stand
          on their own. */}
      <span className='text-body-strong tabular-nums'>
        {fmtTokens(row.tokenCost)}
      </span>

      {/* Agent time */}
      <span className='text-body-strong tabular-nums'>
        {fmtTime(row.activeTimeSec)}
      </span>

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
    </div>
  )
}

/**
 * One task line inside a member's drill-down — itself a disclosure: the line
 * reads as tokens/time/date, and expanding it reveals that task's per-model
 * token composition (the same {@link TokenCostBreakdown} the run timeline
 * uses, so the four token kinds keep one palette across the app).
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
    <div className='border-t border-border first:border-t-0'>
      <button
        type='button'
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className='flex w-full items-center gap-2.5 py-2.5 pl-14 pr-5 text-left hover:bg-muted/40'
      >
        <ChevronRight
          className={`size-3 shrink-0 text-muted-foreground transition-transform ${
            open ? 'rotate-90' : ''
          }`}
        />
        <span className='shrink-0 font-mono text-caption text-muted-foreground'>
          {task.identifier}
        </span>
        <span className='min-w-0 flex-1 truncate text-body text-foreground'>
          {task.title}
        </span>
        <span className='w-20 shrink-0 text-right text-body-strong tabular-nums'>
          {fmtTokens(task.tokenCost)}
        </span>
        <span className='w-16 shrink-0 text-right text-caption tabular-nums text-muted-foreground'>
          {fmtTime(task.activeTimeSec)}
        </span>
        <span className='w-12 shrink-0 text-right text-caption text-muted-foreground'>
          {intl.formatDate(new Date(task.updatedAt), {
            month: 'short',
            day: 'numeric',
          })}
        </span>
      </button>

      {open && (
        <div className='pb-3.5 pl-[4.75rem] pr-5'>
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

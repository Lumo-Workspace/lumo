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
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'

/** Compact token count, e.g. `12.7M` — mirrors the CLI / milestone reading. */
const TOKEN_FMT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

interface Props {
  sprintId: string
  members: WorkspaceMemberInfo[]
}

export function SprintTeamPerformance({ sprintId, members }: Props) {
  const { performance, isLoading } = useSprintTeamPerformance(sprintId)

  if (isLoading) {
    return <Skeleton className='h-24 rounded-lg border border-border' />
  }
  if (!performance || performance.rows.length === 0) return null

  return (
    <SprintTeamPerformanceView performance={performance} members={members} />
  )
}

/**
 * Pure rendering half of the panel — takes an already-loaded rollup so the
 * fetching lives in one place (SRP) and the cards can be rendered against
 * fixtures.
 *
 * Laid out as a stack of narrow cards rather than the wide five-column table it
 * used to be: the section now lives in the ~320px right rail, where a grid of
 * member / tasks-done / tokens / agent-time / token-share columns can only
 * overflow. Each member reads top-down instead — name and share on one line,
 * the share bar under it, then the three numbers as one meta line — and both
 * levels of disclosure (member → task → per-model split) are unchanged.
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

      <div className='divide-y divide-border overflow-hidden rounded-lg border border-border'>
        {performance.rows.map(row => {
          const key = row.memberId ?? '__unattributed__'
          const member = row.memberId ? memberById.get(row.memberId) : undefined
          const isOpen = open.has(key)
          return (
            <div key={key}>
              <MemberCard
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

function MemberCard({
  row,
  member,
  isOpen,
  onToggle,
  fmtTokens,
  sharePct,
  fmtTime,
  unattributedLabel,
}: {
  row: SprintMemberPerfRowDto
  member: WorkspaceMemberInfo | undefined
  isOpen: boolean
  onToggle: () => void
  fmtTokens: (n: number) => string
  sharePct: number
  fmtTime: (sec: number) => string
  unattributedLabel: string
}) {
  const intl = useIntl()
  return (
    <button
      type='button'
      onClick={onToggle}
      aria-expanded={isOpen}
      className='flex w-full flex-col gap-2 px-3.5 py-3 text-left hover:bg-muted/30'
    >
      <div className='flex w-full min-w-0 items-center gap-2'>
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
            row with a scope this section doesn't speak for. */}
        <span className='min-w-0 flex-1 truncate text-body-strong'>
          {row.label ?? unattributedLabel}
        </span>
        <span className='shrink-0 text-caption tabular-nums text-muted-foreground'>
          {sharePct}%
        </span>
      </div>

      {/* Token share of the sprint total — the percentage above is the reading;
          the bar is its decoration, so it stays out of the a11y tree. */}
      <Progress value={sharePct} tone='chart' size='sm' aria-hidden />

      {/* The three numbers the columns used to carry, as one meta line — each
          phrase names its own unit, standing in for the dropped column header. */}
      <div className='flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 text-caption tabular-nums text-muted-foreground'>
        <span>
          {intl.formatMessage(
            {
              id: 'sprints.team.metaTasks',
              defaultMessage:
                '{n, plural, one {# task done} other {# tasks done}}',
            },
            { n: row.tasksDone }
          )}
        </span>
        <span>
          {intl.formatMessage(
            { id: 'sprints.team.metaTokens', defaultMessage: '{n} tokens' },
            { n: fmtTokens(row.tokenCost) }
          )}
        </span>
        <span>
          {intl.formatMessage(
            {
              id: 'sprints.team.metaTime',
              defaultMessage: '{time} agent time',
            },
            { time: fmtTime(row.activeTimeSec) }
          )}
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
    <div className='border-t border-border bg-muted/20'>
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
 * One task inside a member's drill-down — itself a disclosure: two lines (id +
 * title, then tokens / agent time / date) so it survives the narrow rail, and
 * expanding it reveals that task's per-model token composition (the same
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
  // folded into a model row — the same honesty rule as the member card.
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
        className='flex w-full flex-col gap-0.5 py-2 pl-3.5 pr-3 text-left hover:bg-muted/40'
      >
        <div className='flex w-full min-w-0 items-center gap-2'>
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
        </div>
        <div className='flex w-full items-baseline gap-3 pl-7 text-caption text-muted-foreground'>
          <span className='text-caption font-semibold tabular-nums text-foreground'>
            {fmtTokens(task.tokenCost)}
          </span>
          <span className='tabular-nums'>{fmtTime(task.activeTimeSec)}</span>
          <span className='flex-1' />
          <span>
            {intl.formatDate(new Date(task.updatedAt), {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        </div>
      </button>

      {open && (
        <div className='pb-3 pl-7 pr-3'>
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

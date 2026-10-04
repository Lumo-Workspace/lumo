'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { Search, Plus, X } from 'lucide-react'
import type { Sprint } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { sprintsClient } from '@/lib/api-client'
import { useNow } from '@/hooks/use-now'
import { useSprintsForTeam, useSprint } from '../../hooks/useSprints'
import { CurrentSprintCard } from './CurrentSprintCard'
import { SprintTimeline } from './SprintTimeline'
import {
  CreateSprintDialog,
  type CreateSprintInput,
} from './CreateSprintDialog'
import { SprintActionsMenu } from './SprintActionsMenu'
import { formatDate } from './DatePickerField'
import { daysFromNow, partitionSprints } from './sprintLandingUtils'

type ViewTab = 'list' | 'timeline'
type StatusFilter = 'all' | 'active' | 'upcoming' | 'completed'

// ─── Segmented control ────────────────────────────────────────────────────────

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
}) {
  return (
    <div className='inline-flex gap-0.5 rounded-lg bg-muted p-1'>
      {options.map(o => (
        <button
          key={o.value}
          type='button'
          onClick={() => onChange(o.value)}
          className={cn(
            'h-7 rounded-md px-3 text-[13px] font-medium transition-colors',
            value === o.value
              ? 'bg-card text-foreground shadow-elevation-1'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function SectionLabel({ label, count }: { label: string; count?: string }) {
  return (
    <div className='mb-3 flex items-center gap-2.5'>
      <span className='text-xs font-semibold text-muted-foreground'>
        {label}
      </span>
      {count && (
        <>
          <span className='text-xs text-muted-foreground/60'>·</span>
          <span className='text-xs text-muted-foreground/80'>{count}</span>
        </>
      )}
    </div>
  )
}

// ─── Upcoming card ────────────────────────────────────────────────────────────

function UpcomingCard({
  sprint,
  workspaceUrl,
  now,
  onChanged,
}: {
  sprint: Sprint
  workspaceUrl: string
  now: number
  onChanged: () => void
}) {
  const intl = useIntl()
  const startsIn = daysFromNow(sprint.startDate, now)
  const href = `/workspace/${workspaceUrl}/sprints/${sprint.number}`

  return (
    <div className='rounded-xl border border-border bg-card p-5 shadow-elevation-1 transition-colors hover:border-muted-foreground/30'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <Link href={href} className='hover:underline'>
            <h3 className='truncate text-base font-semibold'>{sprint.name}</h3>
          </Link>
          <p className='mt-1.5 font-mono text-xs text-muted-foreground'>
            {formatDate(sprint.startDate, intl.locale)} –{' '}
            {formatDate(sprint.endDate, intl.locale)}
          </p>
        </div>
        <div className='flex shrink-0 items-center gap-1'>
          <span className='inline-flex h-[22px] items-center rounded-md border border-border bg-muted px-2 text-[11.5px] font-medium text-muted-foreground'>
            {intl.formatMessage({
              id:
                sprint.status === 'DRAFT'
                  ? 'sprints.status.draft'
                  : 'sprints.state.upcoming',
            })}
          </span>
          <SprintActionsMenu sprint={sprint} onDeleted={onChanged} />
        </div>
      </div>
      <div className='my-4 h-1.5 rounded-full bg-muted' aria-hidden />
      <div className='flex items-center justify-between'>
        <span className='text-xs text-muted-foreground'>
          {intl.formatMessage(
            { id: 'sprints.landing.startsIn' },
            { count: Math.max(0, startsIn) }
          )}
        </span>
        <Link
          href={href}
          className='inline-flex h-[30px] items-center rounded-md border border-border bg-card px-3 text-xs font-medium transition-colors hover:bg-muted'
        >
          {intl.formatMessage({ id: 'sprints.landing.plan' })} →
        </Link>
      </div>
    </div>
  )
}

// ─── Completed table ──────────────────────────────────────────────────────────

function CompletedRow({
  sprint,
  workspaceUrl,
}: {
  sprint: Sprint
  workspaceUrl: string
}) {
  const intl = useIntl()
  const { progress } = useSprint(sprint.id)
  const done = progress?.done ?? 0
  const total = progress?.total ?? 0
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const href = `/workspace/${workspaceUrl}/sprints/${sprint.number}`

  return (
    <div className='grid grid-cols-[1.2fr_1.4fr_1.6fr_auto] items-center gap-4 border-b border-border/60 px-5 py-3.5 last:border-0 hover:bg-muted/40'>
      <Link
        href={href}
        className='truncate text-sm font-semibold hover:underline'
      >
        {sprint.name}
      </Link>
      <span className='font-mono text-[13px] text-muted-foreground'>
        {formatDate(sprint.startDate, intl.locale)} –{' '}
        {formatDate(sprint.endDate, intl.locale)}
      </span>
      <div className='flex items-center gap-2.5'>
        <div className='h-1.5 flex-1 overflow-hidden rounded-full bg-muted'>
          <div
            className={cn(
              'h-full rounded-full',
              pct >= 100 ? 'bg-success-text' : 'bg-muted-foreground/50'
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className='whitespace-nowrap font-mono text-xs text-muted-foreground tabular-nums'>
          {done}/{total}
        </span>
      </div>
      <Link
        href={href}
        className='inline-flex h-[30px] items-center justify-self-end rounded-md border border-border bg-card px-3 text-xs font-medium transition-colors hover:bg-muted'
      >
        {intl.formatMessage({ id: 'sprints.landing.viewRetro' })}
      </Link>
    </div>
  )
}

function CompletedTable({
  sprints,
  workspaceUrl,
}: {
  sprints: Sprint[]
  workspaceUrl: string
}) {
  const intl = useIntl()
  return (
    <div className='overflow-hidden rounded-xl border border-border bg-card shadow-elevation-1'>
      <div className='grid grid-cols-[1.2fr_1.4fr_1.6fr_auto] gap-4 border-b border-border px-5 py-2.5 text-xs font-medium text-muted-foreground'>
        <span>{intl.formatMessage({ id: 'sprints.table.sprint' })}</span>
        <span>{intl.formatMessage({ id: 'sprints.table.dates' })}</span>
        <span>{intl.formatMessage({ id: 'sprints.table.completion' })}</span>
        <span className='text-right'>
          {intl.formatMessage({ id: 'sprints.table.retro' })}
        </span>
      </div>
      {sprints.map(s => (
        <CompletedRow key={s.id} sprint={s} workspaceUrl={workspaceUrl} />
      ))}
    </div>
  )
}

// ─── Main board ───────────────────────────────────────────────────────────────

export function SprintsBoard({ teamId }: { teamId: string }) {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const intl = useIntl()
  const now = useNow()

  const {
    sprints,
    setSprints,
    isLoading,
    refetch: refetchAll,
  } = useSprintsForTeam(teamId)

  const [view, setView] = useState<ViewTab>('list')
  const [showSearch, setShowSearch] = useState(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [createOpen, setCreateOpen] = useState(false)

  async function handleCreate(input: CreateSprintInput) {
    const optimisticId = `optimistic-${
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2)
    }`
    const optimistic: Sprint = {
      id: optimisticId,
      teamId,
      number: 0,
      name: input.name?.trim() || '…',
      status: 'DRAFT',
      startDate: input.startDate,
      endDate: input.endDate,
      startedAt: null,
      closedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    setSprints(prev => [...(prev ?? []), optimistic])

    try {
      await sprintsClient.createDraft(teamId, {
        ...(input.name ? { name: input.name } : {}),
        startDate: input.startDate.toISOString(),
        endDate: input.endDate.toISOString(),
      })
      toast.success(intl.formatMessage({ id: 'sprints.create.success' }))
      refetchAll()
    } catch (e) {
      setSprints(prev => (prev ?? []).filter(s => s.id !== optimisticId))
      toast.error(e instanceof Error ? e.message : 'Create failed')
    }
  }

  const buckets = useMemo(() => {
    if (now == null) return { current: undefined, upcoming: [], completed: [] }
    return partitionSprints(sprints ?? [], now)
  }, [sprints, now])

  // Name query + status-chip filter, applied across every bucket.
  const q = query.trim().toLowerCase()
  const matchesQuery = (s: Sprint) => !q || s.name.toLowerCase().includes(q)
  const showBucket = (b: StatusFilter) =>
    statusFilter === 'all' || statusFilter === b

  const current =
    showBucket('active') && buckets.current && matchesQuery(buckets.current)
      ? buckets.current
      : undefined
  const upcoming = showBucket('upcoming')
    ? buckets.upcoming.filter(matchesQuery)
    : []
  const completed = showBucket('completed')
    ? buckets.completed.filter(matchesQuery).slice(0, 8)
    : []

  const filtering = showSearch && (!!q || statusFilter !== 'all')
  const resultCount = (current ? 1 : 0) + upcoming.length + completed.length
  const noResults = filtering && resultCount === 0

  const allSprints = sprints ?? []
  const isEmpty = !isLoading && now != null && allSprints.length === 0

  const statusChips: Array<{ value: StatusFilter; label: string }> = [
    { value: 'all', label: intl.formatMessage({ id: 'sprints.filter.all' }) },
    {
      value: 'active',
      label: intl.formatMessage({ id: 'sprints.status.active' }),
    },
    {
      value: 'upcoming',
      label: intl.formatMessage({ id: 'sprints.state.upcoming' }),
    },
    {
      value: 'completed',
      label: intl.formatMessage({ id: 'sprints.state.completed' }),
    },
  ]

  return (
    <div className='mx-auto w-full max-w-[1680px]'>
      {/* Header: subtitle + actions */}
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <p className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'sprints.landing.subtitle' })}
        </p>
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setShowSearch(v => !v)}
            aria-pressed={showSearch}
          >
            <Search className='size-4' />
            {intl.formatMessage({ id: 'sprints.landing.search' })}
          </Button>
          <Button size='sm' onClick={() => setCreateOpen(true)}>
            <Plus className='size-4' />
            {intl.formatMessage({ id: 'sprints.landing.newSprint' })}
          </Button>
        </div>
      </div>

      {/* View tabs */}
      <div className='mt-4'>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            {
              value: 'list',
              label: intl.formatMessage({ id: 'sprints.view.list' }),
            },
            {
              value: 'timeline',
              label: intl.formatMessage({ id: 'sprints.view.timeline' }),
            },
          ]}
        />
      </div>

      {/* Search / filter panel */}
      {showSearch && (
        <div className='mt-4 flex flex-wrap items-center gap-3'>
          <div className='relative min-w-[240px] max-w-[380px] flex-1'>
            <Search className='pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={intl.formatMessage({
                id: 'sprints.landing.searchPlaceholder',
              })}
              className='h-9 pl-9 pr-9'
            />
            {q && (
              <button
                type='button'
                onClick={() => setQuery('')}
                aria-label={intl.formatMessage({
                  id: 'sprints.landing.clearSearch',
                })}
                className='absolute right-2.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-accent'
              >
                <X className='size-3' />
              </button>
            )}
          </div>
          <div className='flex gap-1.5'>
            {statusChips.map(c => (
              <button
                key={c.value}
                type='button'
                onClick={() => setStatusFilter(c.value)}
                className={cn(
                  'h-8 rounded-md px-3 text-xs font-medium transition-colors',
                  statusFilter === c.value
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border bg-card text-muted-foreground hover:bg-muted'
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
          <span className='ml-auto font-mono text-xs text-muted-foreground'>
            {intl.formatMessage(
              { id: 'sprints.landing.resultCount' },
              { count: resultCount }
            )}
          </span>
        </div>
      )}

      {/* Empty state — no sprints at all */}
      {isEmpty ? (
        <div className='mt-10 flex flex-col items-center gap-3 py-12 text-center'>
          <p className='text-sm text-muted-foreground'>
            {intl.formatMessage({ id: 'sprints.landing.empty' })}
          </p>
          <Button onClick={() => setCreateOpen(true)} size='sm'>
            <Plus className='size-4' />
            {intl.formatMessage({ id: 'sprints.landing.newSprint' })}
          </Button>
        </div>
      ) : view === 'timeline' ? (
        <div className='mt-6'>
          {now != null && (
            <SprintTimeline
              sprints={allSprints.filter(matchesQuery)}
              workspaceUrl={workspaceUrl}
              now={now}
            />
          )}
        </div>
      ) : (
        <div className='mt-6 space-y-9'>
          {noResults && (
            <div className='py-16 text-center'>
              <div className='text-sm font-semibold text-muted-foreground'>
                {intl.formatMessage({ id: 'sprints.landing.noResults' })}
              </div>
              <div className='mt-1 text-xs text-muted-foreground/70'>
                {intl.formatMessage({ id: 'sprints.landing.noResultsHint' })}
              </div>
            </div>
          )}

          {/* Current */}
          {current && now != null && (
            <section>
              <SectionLabel
                label={intl.formatMessage({ id: 'sprints.state.current' })}
                count={intl.formatMessage(
                  { id: 'sprints.landing.inProgress' },
                  { count: 1 }
                )}
              />
              <CurrentSprintCard
                sprint={current}
                workspaceUrl={workspaceUrl}
                now={now}
                onChanged={refetchAll}
              />
            </section>
          )}

          {/* Upcoming */}
          {upcoming.length > 0 && now != null && (
            <section>
              <SectionLabel
                label={intl.formatMessage({ id: 'sprints.state.upcoming' })}
                count={intl.formatMessage(
                  { id: 'sprints.landing.plannedCount' },
                  { count: upcoming.length }
                )}
              />
              <div className='grid gap-4 sm:grid-cols-2'>
                {upcoming.map(s => (
                  <UpcomingCard
                    key={s.id}
                    sprint={s}
                    workspaceUrl={workspaceUrl}
                    now={now}
                    onChanged={refetchAll}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Completed */}
          {completed.length > 0 && (
            <section>
              <SectionLabel
                label={intl.formatMessage({ id: 'sprints.state.completed' })}
                count={intl.formatMessage(
                  { id: 'sprints.landing.completedCount' },
                  { count: completed.length }
                )}
              />
              <CompletedTable sprints={completed} workspaceUrl={workspaceUrl} />
            </section>
          )}
        </div>
      )}

      <CreateSprintDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreate}
      />
    </div>
  )
}

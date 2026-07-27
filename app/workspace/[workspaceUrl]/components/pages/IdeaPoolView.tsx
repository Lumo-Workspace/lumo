'use client'

import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { nextIdeaStatus } from '@/lib/idea-status'
import { AsyncContent } from '../AsyncContent'
import { SearchInput } from '../SearchInput'
import { PlanRunsSection } from '../plan-run/PlanRunsSection'
import { groupIdeasByClustering } from '../../utils/groupIdeasByClustering'
import { ApiIdea } from '../../types'
import type {
  PlanRunListRow,
  LatestClustering,
} from '@/lib/api-client/plan-runs'

type IdeaStatus = ApiIdea['status']

/** The single-select filter: every status, or one of the four (LUM-708). */
type StatusFilter = 'ALL' | IdeaStatus

/** The lifecycle statuses, in display order (LUM-679). */
const IDEA_STATUSES: readonly IdeaStatus[] = [
  'CAPTURED',
  'DEVELOPING',
  'PLANNED',
  'DROPPED',
]

const FILTERS: readonly StatusFilter[] = ['ALL', ...IDEA_STATUSES]

/**
 * i18n key + badge tone for each status. Tones are semantic tokens, not the
 * design's raw hex: a neutral label on a tinted ground, so the colour carries
 * signal without costing contrast.
 */
const STATUS_META: Record<
  IdeaStatus,
  { labelId: string; tone: 'muted' | 'warning' | 'success' | 'danger' }
> = {
  CAPTURED: { labelId: 'ideas.statusCaptured', tone: 'muted' },
  DEVELOPING: { labelId: 'ideas.statusDeveloping', tone: 'warning' },
  PLANNED: { labelId: 'ideas.statusPlanned', tone: 'success' },
  DROPPED: { labelId: 'ideas.statusDropped', tone: 'danger' },
}

const FILTER_LABEL: Record<StatusFilter, string> = {
  ALL: 'ideas.filterAll',
  CAPTURED: STATUS_META.CAPTURED.labelId,
  DEVELOPING: STATUS_META.DEVELOPING.labelId,
  PLANNED: STATUS_META.PLANNED.labelId,
  DROPPED: STATUS_META.DROPPED.labelId,
}

interface IdeaPoolViewProps {
  ideas: ApiIdea[]
  loading: boolean
  error: string | null
  onRetry: () => void
  workspaceUrl: string
  planRuns: PlanRunListRow[]
  planRunsLoading: boolean
  planRunsError: string | null
  clustering: LatestClustering | null
  /** Open the detail slide-over for a row (LUM-683). */
  onOpenIdea: (idea: ApiIdea) => void
  /** Capture a new idea from the inline input (LUM-708). */
  onCaptureIdea: (statement: string) => Promise<unknown>
  /** Advance a row's lifecycle status from its badge (LUM-708). */
  onAdvanceStatus: (idea: ApiIdea, next: IdeaStatus) => Promise<unknown>
}

/**
 * Presentational idea-pool page: renders the team pool (already newest-first
 * from the API) with a single-select status filter and client-side search over
 * the statement/id. Each idea is one compact row — id, status, statement,
 * planned-into marker, captured date — and a PLANNED idea links back to the
 * plan run that materialised it (its Initiative lineage). Pure — all data and
 * mutations come from props (SRP; the container owns fetching).
 *
 * LUM-708 reshapes the whole main content area to the design: a full-width
 * titled header over a centred column, the blurb and search sharing one row,
 * pill filters, an inline capture input, and grouped ideas as dense rows inside
 * one bordered card rather than a card per idea.
 */
export function IdeaPoolView({
  ideas,
  loading,
  error,
  onRetry,
  workspaceUrl,
  planRuns,
  planRunsLoading,
  planRunsError,
  clustering,
  onOpenIdea,
  onCaptureIdea,
  onAdvanceStatus,
}: IdeaPoolViewProps) {
  const intl = useIntl()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')

  const searching = search.trim().length > 0

  // Status filter is applied first, so search + clustering only ever see the
  // status the user has selected.
  const statusFiltered = useMemo(
    () =>
      statusFilter === 'ALL'
        ? ideas
        : ideas.filter(i => i.status === statusFilter),
    [ideas, statusFilter]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return statusFiltered
    return statusFiltered.filter(
      i =>
        i.statement.toLowerCase().includes(q) ||
        i.identifier.toLowerCase().includes(q)
    )
  }, [statusFiltered, search])

  // Default view: group the status-filtered pool by the latest run's clustering
  // (LUM-677). Searching flattens to a filtered list; no run yet → grouped is
  // null → flat time-ordered fallback. Pure — no LLM call on load.
  const grouped = useMemo(
    () =>
      searching ? null : groupIdeasByClustering(statusFiltered, clustering),
    [statusFiltered, clustering, searching]
  )

  const rowProps = {
    workspaceUrl,
    onOpen: onOpenIdea,
    onAdvanceStatus,
  }

  return (
    <div className='flex-1 overflow-y-auto'>
      <header className='border-b border-border px-10 py-6'>
        <h1 className='text-2xl font-bold'>
          {intl.formatMessage({ id: 'ideas.title' })}
          {ideas.length > 0 && (
            <span className='ml-2 text-sm font-medium text-muted-foreground'>
              {ideas.length}
            </span>
          )}
        </h1>
      </header>

      <div className='mx-auto max-w-[880px] px-8 pb-20 pt-7'>
        <div className='mb-6 flex items-center gap-3'>
          <p className='text-sm text-muted-foreground'>
            {intl.formatMessage({ id: 'ideas.blurb' })}
          </p>
          <span className='flex-1' />
          <SearchInput
            className='w-56 shrink-0'
            value={search}
            onChange={setSearch}
            placeholder={intl.formatMessage({ id: 'ideas.search' })}
          />
        </div>

        {/* Plan runs surfaced here (LUM-677) — not a separate top-level nav
            entry; the converter is the idea pool's primary downstream action. */}
        <PlanRunsSection
          runs={planRuns}
          loading={planRunsLoading}
          error={planRunsError}
          workspaceUrl={workspaceUrl}
        />

        {/* Single-select status filter — 'All' includes DROPPED (LUM-708). */}
        <div
          className='mb-5 flex flex-wrap gap-1.5'
          role='group'
          aria-label={intl.formatMessage({ id: 'ideas.filterLabel' })}
          data-testid='idea-status-filter'
        >
          {FILTERS.map(filter => {
            const active = statusFilter === filter
            return (
              <button
                key={filter}
                type='button'
                onClick={() => setStatusFilter(filter)}
                aria-pressed={active}
                data-testid={`idea-status-toggle-${filter}`}
                className={cn(
                  'rounded-full border px-3 py-0.5 text-xs font-medium transition-colors',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground hover:bg-muted'
                )}
              >
                {intl.formatMessage({ id: FILTER_LABEL[filter] })}
              </button>
            )
          })}
        </div>

        <CaptureIdeaInput onCapture={onCaptureIdea} />

        <AsyncContent
          loading={loading}
          error={error}
          empty={ideas.length === 0}
          onRetry={onRetry}
          emptyState={
            <div className='flex flex-col items-center gap-1 text-center'>
              <p className='text-sm text-muted-foreground'>
                {intl.formatMessage({ id: 'ideas.empty' })}
              </p>
              <p className='text-xs text-muted-foreground'>
                {intl.formatMessage({ id: 'ideas.emptyHint' })}
              </p>
            </div>
          }
        >
          {filtered.length === 0 ? (
            <p className='py-10 text-center text-sm text-muted-foreground'>
              {intl.formatMessage({
                id: searching ? 'ideas.noMatches' : 'ideas.noneForFilter',
              })}
            </p>
          ) : grouped ? (
            <div className='flex flex-col gap-7'>
              {grouped.clusters.map(cluster => (
                <IdeaGroup
                  key={cluster.name}
                  name={cluster.name}
                  ideas={cluster.ideas}
                  testId='idea-cluster'
                  headingTestId='cluster-heading'
                  {...rowProps}
                />
              ))}
              {grouped.ungrouped.length > 0 && (
                <IdeaGroup
                  name={intl.formatMessage({ id: 'ideas.ungrouped' })}
                  ideas={grouped.ungrouped}
                  testId='idea-ungrouped'
                  {...rowProps}
                />
              )}
            </div>
          ) : (
            <IdeaList ideas={filtered} {...rowProps} />
          )}
        </AsyncContent>
      </div>
    </div>
  )
}

/**
 * The inline capture input (LUM-708) — the web counterpart of `lumo idea`.
 * Enter submits a non-blank statement and clears the field; a blank value is a
 * no-op, so the pool can't be seeded with empty rows by a stray keystroke.
 */
function CaptureIdeaInput({
  onCapture,
}: {
  onCapture: (statement: string) => Promise<unknown>
}) {
  const intl = useIntl()
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    const statement = value.trim()
    if (!statement || submitting) return
    setSubmitting(true)
    try {
      await onCapture(statement)
      setValue('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className='mb-6 flex items-center gap-2.5 rounded-lg border border-border bg-card px-3.5 py-2 focus-within:border-ring'>
      <Plus className='size-4 shrink-0 text-muted-foreground' />
      <input
        type='text'
        value={value}
        disabled={submitting}
        data-testid='idea-capture-input'
        aria-label={intl.formatMessage({ id: 'ideas.captureLabel' })}
        placeholder={intl.formatMessage({ id: 'ideas.capturePlaceholder' })}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          void submit()
        }}
        className='w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground'
      />
      <kbd className='shrink-0 rounded-sm border border-border px-1.5 text-[11px] text-muted-foreground'>
        ⏎
      </kbd>
    </div>
  )
}

type RowHandlers = {
  workspaceUrl: string
  onOpen: (idea: ApiIdea) => void
  onAdvanceStatus: (idea: ApiIdea, next: IdeaStatus) => Promise<unknown>
}

/** One cluster: a hairline-ruled heading over the group's single row card. */
function IdeaGroup({
  name,
  ideas,
  testId,
  headingTestId,
  ...handlers
}: {
  name: string
  ideas: ApiIdea[]
  testId: string
  headingTestId?: string
} & RowHandlers) {
  return (
    <section data-testid={testId} className='flex flex-col gap-2'>
      <div className='flex items-center gap-2'>
        <h2
          data-testid={headingTestId}
          className='text-xs font-bold uppercase tracking-wider text-muted-foreground'
        >
          {name}
        </h2>
        <span className='text-[11px] text-muted-foreground'>
          {ideas.length}
        </span>
        <span className='h-px flex-1 bg-border' />
      </div>
      <IdeaList ideas={ideas} {...handlers} />
    </section>
  )
}

/** The rows themselves, as one bordered card with hairline dividers. */
function IdeaList({ ideas, ...handlers }: { ideas: ApiIdea[] } & RowHandlers) {
  return (
    <ul className='overflow-hidden rounded-lg border border-border bg-card'>
      {ideas.map(idea => (
        <IdeaRow key={idea.id} idea={idea} {...handlers} />
      ))}
    </ul>
  )
}

function IdeaRow({
  idea,
  workspaceUrl,
  onOpen,
  onAdvanceStatus,
}: { idea: ApiIdea } & RowHandlers) {
  const intl = useIntl()
  const meta = STATUS_META[idea.status]
  const next = nextIdeaStatus(idea.status)

  // A PLANNED idea links back to the plan run that materialised it — the place
  // its Initiative is shown (there is no standalone Initiative route yet).
  const initiativeHref =
    idea.status === 'PLANNED' && idea.planRunId
      ? `/workspace/${workspaceUrl}/plan/${idea.planRunId}`
      : null

  return (
    <li
      data-testid='idea-row'
      data-status={idea.status}
      role='button'
      tabIndex={0}
      onClick={() => onOpen(idea)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(idea)
        }
      }}
      className='flex cursor-pointer items-center gap-3 border-b border-border px-3.5 py-2 last:border-b-0 hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
    >
      <span className='w-14 shrink-0 truncate font-mono text-[11px] text-muted-foreground'>
        {idea.identifier}
      </span>

      <button
        type='button'
        // Inert rather than `disabled`: a disabled button swallows nothing —
        // the click just bubbles to the row and opens the drawer instead.
        aria-disabled={!next}
        data-testid='idea-status-badge'
        title={
          next
            ? intl.formatMessage(
                { id: 'ideas.advanceStatus' },
                {
                  status: intl.formatMessage({ id: STATUS_META[next].labelId }),
                }
              )
            : intl.formatMessage({ id: 'ideas.statusTerminal' })
        }
        onClick={e => {
          // The row itself opens the drawer — advancing must not also open it.
          e.stopPropagation()
          if (next) void onAdvanceStatus(idea, next)
        }}
        className={cn(
          'shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',
          next ? 'hover:ring-2 hover:ring-border' : 'cursor-default',
          meta.tone === 'muted' &&
            'border-border bg-muted text-muted-foreground',
          meta.tone === 'warning' &&
            'border-warning-border bg-warning-subtle text-foreground',
          meta.tone === 'success' &&
            'border-success-border bg-success-subtle text-foreground',
          meta.tone === 'danger' &&
            'border-danger-border bg-danger-subtle text-foreground'
        )}
      >
        {intl.formatMessage({ id: meta.labelId })}
      </button>

      <span className='flex-1 truncate text-sm'>{idea.statement}</span>

      {initiativeHref && idea.initiative && (
        <Link
          href={initiativeHref}
          onClick={e => e.stopPropagation()}
          title={intl.formatMessage(
            { id: 'ideas.plannedInto' },
            { goal: idea.initiative.name }
          )}
          className='shrink-0 text-[11px] text-muted-foreground underline-offset-2 hover:underline'
        >
          {intl.formatMessage({ id: 'ideas.plannedMarker' })}
        </Link>
      )}

      <span className='w-[68px] shrink-0 text-right text-[11px] text-muted-foreground'>
        {intl.formatDate(new Date(idea.createdAt), {
          month: 'short',
          day: 'numeric',
        })}
      </span>
    </li>
  )
}

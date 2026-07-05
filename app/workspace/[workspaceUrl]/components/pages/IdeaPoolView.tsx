'use client'

import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import Link from 'next/link'
import { Lightbulb } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
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

/** The lifecycle statuses, in display order (LUM-679). */
const IDEA_STATUSES: readonly IdeaStatus[] = [
  'CAPTURED',
  'DEVELOPING',
  'PLANNED',
  'DROPPED',
]

/** i18n key + badge variant for each status. Single source for the pool UI. */
const STATUS_META: Record<
  IdeaStatus,
  {
    labelId: string
    variant: 'outline' | 'secondary' | 'default' | 'destructive'
  }
> = {
  CAPTURED: { labelId: 'ideas.statusCaptured', variant: 'outline' },
  DEVELOPING: { labelId: 'ideas.statusDeveloping', variant: 'default' },
  PLANNED: { labelId: 'ideas.statusPlanned', variant: 'secondary' },
  DROPPED: { labelId: 'ideas.statusDropped', variant: 'destructive' },
}

/** DROPPED is hidden by default — a discarded idea shouldn't clutter the pool. */
const DEFAULT_VISIBLE_STATUSES: readonly IdeaStatus[] = [
  'CAPTURED',
  'DEVELOPING',
  'PLANNED',
]

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
}

/**
 * Presentational idea-pool page: renders the team pool (already newest-first
 * from the API) with a per-status filter (DROPPED hidden by default, LUM-679)
 * and client-side search over the statement/id. Each idea shows its id, status,
 * source and captured time; a PLANNED idea links back to the plan run that
 * materialised it (its Initiative lineage). Pure — all data + retry come from
 * props (SRP; the container owns fetching).
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
}: IdeaPoolViewProps) {
  const intl = useIntl()
  const [search, setSearch] = useState('')
  const [visibleStatuses, setVisibleStatuses] = useState<Set<IdeaStatus>>(
    () => new Set(DEFAULT_VISIBLE_STATUSES)
  )

  const searching = search.trim().length > 0

  // Status filter is applied first, so search + clustering only ever see the
  // statuses the user has enabled (DROPPED stays hidden until toggled on).
  const statusFiltered = useMemo(
    () => ideas.filter(i => visibleStatuses.has(i.status)),
    [ideas, visibleStatuses]
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

  const toggleStatus = (status: IdeaStatus) => {
    setVisibleStatuses(prev => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  return (
    <div className='flex-1 overflow-y-auto p-6'>
      <div className='mx-auto max-w-3xl'>
        {/* Plan runs surfaced here (LUM-677) — not a separate top-level nav
            entry; the converter is the idea pool's primary downstream action. */}
        <PlanRunsSection
          runs={planRuns}
          loading={planRunsLoading}
          error={planRunsError}
          workspaceUrl={workspaceUrl}
        />

        <div className='mb-4 flex items-center gap-2'>
          <Lightbulb className='size-5 text-muted-foreground' />
          <h1 className='text-lg font-semibold'>
            {intl.formatMessage({ id: 'ideas.title' })}
          </h1>
          {ideas.length > 0 && (
            <span className='text-sm text-muted-foreground'>
              {ideas.length}
            </span>
          )}
        </div>

        <div className='mb-3'>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={intl.formatMessage({ id: 'ideas.search' })}
          />
        </div>

        {/* Per-status filter — DROPPED off by default; click to toggle. */}
        <div
          className='mb-4 flex flex-wrap gap-1.5'
          role='group'
          aria-label={intl.formatMessage({ id: 'ideas.filterLabel' })}
          data-testid='idea-status-filter'
        >
          {IDEA_STATUSES.map(status => {
            const active = visibleStatuses.has(status)
            return (
              <button
                key={status}
                type='button'
                onClick={() => toggleStatus(status)}
                aria-pressed={active}
                data-testid={`idea-status-toggle-${status}`}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                  active
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted'
                )}
              >
                {intl.formatMessage({ id: STATUS_META[status].labelId })}
              </button>
            )
          })}
        </div>

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
            <p className='py-8 text-center text-sm text-muted-foreground'>
              {intl.formatMessage({
                id: searching ? 'ideas.noMatches' : 'ideas.noneForFilter',
              })}
            </p>
          ) : searching ? (
            <ul className='flex flex-col gap-2'>
              {filtered.map(idea => (
                <IdeaRow
                  key={idea.id}
                  idea={idea}
                  workspaceUrl={workspaceUrl}
                  onOpen={onOpenIdea}
                />
              ))}
            </ul>
          ) : grouped ? (
            <div className='flex flex-col gap-5'>
              {grouped.clusters.map(cluster => (
                <section
                  key={cluster.name}
                  data-testid='idea-cluster'
                  className='flex flex-col gap-2'
                >
                  <h2
                    data-testid='cluster-heading'
                    className='text-sm font-medium text-muted-foreground'
                  >
                    {cluster.name}
                  </h2>
                  <ul className='flex flex-col gap-2'>
                    {cluster.ideas.map(idea => (
                      <IdeaRow
                        key={idea.id}
                        idea={idea}
                        workspaceUrl={workspaceUrl}
                        onOpen={onOpenIdea}
                      />
                    ))}
                  </ul>
                </section>
              ))}
              {grouped.ungrouped.length > 0 && (
                <section
                  data-testid='idea-ungrouped'
                  className='flex flex-col gap-2'
                >
                  <h2 className='text-sm font-medium text-muted-foreground'>
                    {intl.formatMessage({ id: 'ideas.ungrouped' })}
                  </h2>
                  <ul className='flex flex-col gap-2'>
                    {grouped.ungrouped.map(idea => (
                      <IdeaRow
                        key={idea.id}
                        idea={idea}
                        workspaceUrl={workspaceUrl}
                        onOpen={onOpenIdea}
                      />
                    ))}
                  </ul>
                </section>
              )}
            </div>
          ) : (
            <ul className='flex flex-col gap-2'>
              {filtered.map(idea => (
                <IdeaRow
                  key={idea.id}
                  idea={idea}
                  workspaceUrl={workspaceUrl}
                  onOpen={onOpenIdea}
                />
              ))}
            </ul>
          )}
        </AsyncContent>
      </div>
    </div>
  )
}

function IdeaRow({
  idea,
  workspaceUrl,
  onOpen,
}: {
  idea: ApiIdea
  workspaceUrl: string
  onOpen: (idea: ApiIdea) => void
}) {
  const intl = useIntl()
  const meta = STATUS_META[idea.status]

  // A PLANNED idea links back to the plan run that materialised it — the place
  // its Initiative is shown (there is no standalone Initiative route yet).
  const initiativeHref =
    idea.status === 'PLANNED' && idea.planRunId
      ? `/workspace/${workspaceUrl}/plan/${idea.planRunId}`
      : null

  const source = idea.sourceContext
    ? idea.sourceContext
    : idea.sourceTaskId
      ? intl.formatMessage(
          { id: 'ideas.fromTask' },
          { task: idea.sourceTaskId }
        )
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
      className='cursor-pointer rounded-md border border-border bg-card p-3 hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
    >
      <div className='flex items-start gap-2'>
        <span className='shrink-0 font-mono text-xs text-muted-foreground'>
          {idea.identifier}
        </span>
        <Badge variant={meta.variant} className='shrink-0 text-[10px]'>
          {intl.formatMessage({ id: meta.labelId })}
        </Badge>
        <p className='flex-1 text-sm'>{idea.statement}</p>
      </div>

      <div className='mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-1 text-xs text-muted-foreground'>
        <span>
          {intl.formatDate(new Date(idea.createdAt), { dateStyle: 'medium' })}
        </span>
        {source && <span className='truncate'>{source}</span>}
        {initiativeHref && idea.initiative && (
          <Link
            href={initiativeHref}
            onClick={e => e.stopPropagation()}
            className='text-primary underline underline-offset-2 hover:no-underline'
          >
            {intl.formatMessage(
              { id: 'ideas.plannedInto' },
              { goal: idea.initiative.name }
            )}
          </Link>
        )}
      </div>
    </li>
  )
}

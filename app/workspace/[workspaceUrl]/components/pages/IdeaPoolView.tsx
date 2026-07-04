'use client'

import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import Link from 'next/link'
import { Lightbulb } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { AsyncContent } from '../AsyncContent'
import { SearchInput } from '../SearchInput'
import { PlanRunsSection } from '../plan-run/PlanRunsSection'
import { ApiIdea } from '../../types'
import type { PlanRunListRow } from '@/lib/api-client/plan-runs'

interface IdeaPoolViewProps {
  ideas: ApiIdea[]
  loading: boolean
  error: string | null
  onRetry: () => void
  workspaceUrl: string
  planRuns: PlanRunListRow[]
  planRunsLoading: boolean
  planRunsError: string | null
}

/**
 * Presentational idea-pool page: renders the team pool (already newest-first
 * from the API) with client-side search over the statement/id. Each idea shows
 * its id, status, source and captured time; a PLANNED idea links back to the
 * plan run that materialised it (its Initiative lineage). Pure — all data +
 * retry come from props (SRP; the container owns fetching).
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
}: IdeaPoolViewProps) {
  const intl = useIntl()
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return ideas
    return ideas.filter(
      i =>
        i.statement.toLowerCase().includes(q) ||
        i.identifier.toLowerCase().includes(q)
    )
  }, [ideas, search])

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

        <div className='mb-4'>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={intl.formatMessage({ id: 'ideas.search' })}
          />
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
              {intl.formatMessage({ id: 'ideas.noMatches' })}
            </p>
          ) : (
            <ul className='flex flex-col gap-2'>
              {filtered.map(idea => (
                <IdeaRow
                  key={idea.id}
                  idea={idea}
                  workspaceUrl={workspaceUrl}
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
}: {
  idea: ApiIdea
  workspaceUrl: string
}) {
  const intl = useIntl()
  const isPlanned = idea.status === 'PLANNED'

  // A PLANNED idea links back to the plan run that materialised it — the place
  // its Initiative is shown (there is no standalone Initiative route yet).
  const initiativeHref =
    isPlanned && idea.planRunId
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
      className='rounded-md border border-border bg-card p-3'
    >
      <div className='flex items-start gap-2'>
        <span className='shrink-0 font-mono text-xs text-muted-foreground'>
          {idea.identifier}
        </span>
        <Badge
          variant={isPlanned ? 'secondary' : 'outline'}
          className='shrink-0 text-[10px]'
        >
          {intl.formatMessage({
            id: isPlanned ? 'ideas.statusPlanned' : 'ideas.statusCaptured',
          })}
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
            className='text-primary underline underline-offset-2 hover:no-underline'
          >
            {intl.formatMessage(
              { id: 'ideas.plannedInto' },
              { goal: idea.initiative.goalStatement }
            )}
          </Link>
        )}
      </div>
    </li>
  )
}

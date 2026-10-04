'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import Link from 'next/link'
import { Flag, Loader2, Plus } from 'lucide-react'
import type { ApiMilestone } from '@/lib/api-client'
import { useMilestones } from '../../../hooks/useMilestones'
import { useCreateMilestone } from '../../../hooks/useCreateMilestone'

/** done / total from the server-enriched per-status counts. */
function progressOf(m: ApiMilestone): { done: number; total: number } {
  const counts = m.taskCounts
  if (!counts) return { done: 0, total: 0 }
  const done = counts.DONE ?? 0
  const total =
    (counts.TODO ?? 0) +
    (counts.IN_PROGRESS ?? 0) +
    (counts.IN_REVIEW ?? 0) +
    done
  return { done, total }
}

interface ProjectMilestonesOverviewProps {
  projectId: string
  projectSlug: string
  workspaceUrl: string
  /** Switches to the Milestones tab, where editing and archiving live. */
  onViewAll: () => void
}

/**
 * A roll-up of the project's active milestones, plus the inline composer for
 * adding one.
 *
 * The composer takes a name and nothing else — capture the milestone the moment
 * you think of it, fill in dates and description later. Everything that edits an
 * existing milestone (rename, archive, delete, dates) stays on the Milestones
 * tab, so this section has exactly one write and no second full form.
 */
export function ProjectMilestonesOverview({
  projectId,
  projectSlug,
  workspaceUrl,
  onViewAll,
}: ProjectMilestonesOverviewProps) {
  const intl = useIntl()
  const { milestones, loading } = useMilestones(projectId, 'active')
  const create = useCreateMilestone(projectId)
  const [composing, setComposing] = useState(false)
  const [name, setName] = useState('')

  const closeComposer = () => {
    setComposing(false)
    setName('')
  }

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed || create.isPending) return
    create.mutate(trimmed, { onSuccess: closeComposer })
  }

  return (
    <section data-testid='project-milestones-overview'>
      <div className='mb-2 flex items-baseline gap-2'>
        {/* Label only — no count. The rows are right there to be counted, and
            the number was the last thing on this line still asserting something
            about milestone state. */}
        <span className='text-caption text-muted-foreground'>
          {intl.formatMessage({ id: 'project.milestones' })}
        </span>
        <button
          type='button'
          onClick={onViewAll}
          className='ml-auto text-caption text-muted-foreground hover:text-foreground'
        >
          {intl.formatMessage({ id: 'project.milestones.viewAll' })}
        </button>
      </div>

      {loading ? (
        <div className='space-y-1' aria-busy='true'>
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className='h-11 animate-pulse rounded-md bg-muted/50'
            />
          ))}
        </div>
      ) : milestones.length === 0 ? (
        <p className='py-3 text-body text-muted-foreground'>
          {intl.formatMessage({ id: 'milestone.empty.title' })}
        </p>
      ) : (
        <ul data-testid='milestone-overview-list'>
          {milestones.map(m => {
            const { done, total } = progressOf(m)
            const pct = total > 0 ? Math.round((done / total) * 100) : 0
            return (
              <li key={m.id}>
                <Link
                  href={`/workspace/${workspaceUrl}/projects/${projectSlug}/milestones/${m.slug}`}
                  className='-mx-2.5 flex items-center gap-3.5 rounded-md px-2.5 py-3 transition-colors hover:bg-muted/60'
                >
                  {/* One constant marker — the same flag the Milestones tab
                      uses, so the tab and the rows it leads to are the same
                      thing. A milestone a reader can see is by definition an
                      active one (archived ones are filtered out server-side),
                      so there is no second state for it to distinguish. */}
                  <Flag
                    className='size-4 shrink-0 text-warning'
                    data-testid='milestone-marker'
                    aria-hidden
                  />
                  <span className='min-w-0 flex-1 truncate text-body-strong text-foreground'>
                    {m.name}
                  </span>
                  <span
                    className='h-1.5 w-[110px] shrink-0 overflow-hidden rounded-full bg-muted'
                    role='progressbar'
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={m.name}
                  >
                    <span
                      className='block h-full rounded-full bg-foreground'
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className='w-14 shrink-0 text-right text-caption tabular-nums text-muted-foreground'>
                    {done}/{total}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {/* Inline composer. Mirrors a milestone row so the thing being typed sits
          where the thing being created will land — dashed marker while it is
          still a draft. */}
      {!loading &&
        (composing ? (
          <div className='-mx-2.5 flex items-center gap-3.5 rounded-md bg-muted/60 px-2.5 py-3'>
            {create.isPending ? (
              <Loader2 className='size-4 shrink-0 animate-spin text-warning' />
            ) : (
              // Dashed while it is still a draft — same flag, not yet planted.
              <Flag className='size-4 shrink-0 text-warning [stroke-dasharray:3_2]' />
            )}
            <input
              autoFocus
              value={name}
              disabled={create.isPending}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
                if (e.key === 'Escape') closeComposer()
              }}
              // Abandoning the field is the same gesture as cancelling, but a
              // half-typed name must not be thrown away silently — only an empty
              // field closes on blur.
              onBlur={() => {
                if (!name.trim()) closeComposer()
              }}
              placeholder={intl.formatMessage({
                id: 'project.milestones.namePlaceholder',
              })}
              className='min-w-0 flex-1 bg-transparent text-body-strong text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground'
            />
            {create.isError && (
              <span className='shrink-0 text-caption text-danger-text'>
                {intl.formatMessage({ id: 'project.milestones.addFailed' })}
              </span>
            )}
          </div>
        ) : (
          <button
            type='button'
            data-testid='milestone-add-trigger'
            onClick={() => setComposing(true)}
            className='-mx-2.5 flex w-[calc(100%+1.25rem)] items-center gap-3.5 rounded-md px-2.5 py-2.5 text-caption text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground'
          >
            <Plus className='size-4 shrink-0' aria-hidden />
            {intl.formatMessage({ id: 'project.milestones.add' })}
          </button>
        ))}
    </section>
  )
}

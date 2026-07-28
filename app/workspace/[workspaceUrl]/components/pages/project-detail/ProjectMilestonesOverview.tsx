'use client'

import { useIntl } from 'react-intl'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { ApiMilestone } from '@/lib/api-client'
import { useMilestones } from '../../../hooks/useMilestones'
import { STATUS_CLASS } from '../../milestones/milestoneDisplay'

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
  /** Switches to the Milestones tab, where creating and archiving live. */
  onViewAll: () => void
}

/**
 * A read-only roll-up of the project's active milestones.
 *
 * Deliberately has no create / edit / archive affordances: those live on the
 * Milestones tab, and duplicating an entry point here would give the project
 * two subtly different ways to make a milestone. This section answers "where is
 * the work up to", and hands off for anything that changes it.
 */
export function ProjectMilestonesOverview({
  projectId,
  projectSlug,
  workspaceUrl,
  onViewAll,
}: ProjectMilestonesOverviewProps) {
  const intl = useIntl()
  const { milestones, loading } = useMilestones(projectId, 'active')

  return (
    <section data-testid='project-milestones-overview'>
      <div className='mb-2 flex items-baseline gap-2'>
        <span className='text-caption text-muted-foreground'>
          {intl.formatMessage({ id: 'project.milestones' })}
        </span>
        {milestones.length > 0 && (
          <span className='text-caption text-muted-foreground/70'>
            {milestones.length}
          </span>
        )}
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
        <ul>
          {milestones.map(m => {
            const { done, total } = progressOf(m)
            const pct = total > 0 ? Math.round((done / total) * 100) : 0
            return (
              <li key={m.id}>
                <Link
                  href={`/workspace/${workspaceUrl}/projects/${projectSlug}/milestones/${m.slug}`}
                  className='-mx-2.5 flex items-center gap-3.5 rounded-md px-2.5 py-3 transition-colors hover:bg-muted/60'
                >
                  <span className='min-w-0 flex-1 truncate text-body-strong text-foreground'>
                    {m.name}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-caption',
                      STATUS_CLASS[m.status]
                    )}
                  >
                    {intl.formatMessage({ id: `milestone.status.${m.status}` })}
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
    </section>
  )
}

'use client'

import { useIntl } from 'react-intl'
import Link from 'next/link'
import { GitBranch } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { isTerminalStage } from '@/lib/plan-run/state-machine'
import type { PlanRunListRow } from '@/lib/api-client/plan-runs'

interface PlanRunsSectionProps {
  runs: PlanRunListRow[]
  loading: boolean
  error: string | null
  workspaceUrl: string
}

const STATUS_MESSAGE: Record<string, string> = {
  MATERIALIZED: 'planRuns.status.materialized',
  ABANDONED: 'planRuns.status.abandoned',
  FAILED: 'planRuns.status.failed',
}

/**
 * The plan-runs surface on the Ideas page (LUM-677) — NOT a top-level nav
 * entry. Shows the active run (linked to its current gate, so it can be
 * resumed) and past runs (linked to their read-only archive), so runs are
 * reachable without the CLI deep-link. Purely presentational; the container
 * owns fetching (SRP). Renders nothing when there are no runs, so it stays out
 * of the way on a fresh workspace.
 */
export function PlanRunsSection({
  runs,
  loading,
  error,
  workspaceUrl,
}: PlanRunsSectionProps) {
  const intl = useIntl()

  if (error) {
    return (
      <p className='text-sm text-destructive' data-testid='plan-runs-section'>
        {intl.formatMessage({ id: 'planRuns.loadError' })}
      </p>
    )
  }

  // At most one active run per team (run lock); the rest are terminal.
  const active = runs.find(r => !isTerminalStage(r.stage))
  const past = runs.filter(r => isTerminalStage(r.stage))

  // Nothing to show yet — stay out of the way (and don't flash on first load).
  if (loading || (!active && past.length === 0)) return null

  return (
    <section
      data-testid='plan-runs-section'
      className='mb-6 rounded-lg border border-border bg-muted/30 p-4'
    >
      <div className='mb-3 flex items-center gap-2'>
        <GitBranch className='size-4 text-muted-foreground' />
        <h2 className='text-sm font-semibold'>
          {intl.formatMessage({ id: 'planRuns.title' })}
        </h2>
      </div>

      {active && (
        <div className='mb-3' data-testid='plan-run-active'>
          <p className='mb-1 text-xs font-medium text-muted-foreground'>
            {intl.formatMessage({ id: 'planRuns.activeLabel' })}
          </p>
          <Link
            href={`/workspace/${workspaceUrl}/plan/${active.id}`}
            className='flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-accent'
          >
            <span className='flex items-center gap-2'>
              <Badge variant='secondary' className='text-[10px]'>
                {intl.formatMessage({ id: 'planRuns.status.inProgress' })}
              </Badge>
              <span className='text-muted-foreground'>
                {intl.formatDate(new Date(active.createdAt), {
                  dateStyle: 'medium',
                })}
              </span>
            </span>
            <span className='font-medium text-primary'>
              {intl.formatMessage({ id: 'planRuns.resume' })}
            </span>
          </Link>
        </div>
      )}

      {past.length > 0 && (
        <div data-testid='plan-run-past-group'>
          <p className='mb-1 text-xs font-medium text-muted-foreground'>
            {intl.formatMessage({ id: 'planRuns.pastLabel' })}
          </p>
          <ul className='flex flex-col gap-1'>
            {past.map(run => (
              <li key={run.id}>
                <Link
                  href={`/workspace/${workspaceUrl}/plan/${run.id}`}
                  data-testid='plan-run-past'
                  className='flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-accent'
                >
                  <Badge variant='outline' className='text-[10px]'>
                    {intl.formatMessage({
                      id:
                        STATUS_MESSAGE[run.stage] ??
                        'planRuns.status.materialized',
                    })}
                  </Badge>
                  <span className='text-muted-foreground'>
                    {intl.formatDate(new Date(run.createdAt), {
                      dateStyle: 'medium',
                    })}
                  </span>
                  {run.initiatives[0] && (
                    <span className='truncate text-muted-foreground'>
                      {intl.formatMessage(
                        { id: 'planRuns.materializedInto' },
                        { goal: run.initiatives[0].name }
                      )}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

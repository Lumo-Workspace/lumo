'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
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
 * entry. Purely presentational; the container owns fetching (SRP). Renders
 * nothing when there are no runs, so it stays out of the way on a fresh
 * workspace.
 *
 * LUM-708 reshapes it into a collapsible card: the header alone carries the
 * whole history as a one-line summary (materialized / abandoned counts + the
 * last run's date), and the run rows live behind it. The card opens by default
 * only when a run is still in flight — an active run is the one thing here that
 * wants acting on, so it must not be hidden; a purely terminal history stays
 * folded away. Abandoned runs get a second fold of their own: they are the bulk
 * of a mature history and the least informative part of it.
 */
export function PlanRunsSection({
  runs,
  loading,
  error,
  workspaceUrl,
}: PlanRunsSectionProps) {
  const intl = useIntl()

  // At most one active run per team (run lock); the rest are terminal.
  const active = runs.find(r => !isTerminalStage(r.stage))
  const past = runs.filter(r => isTerminalStage(r.stage))
  const abandoned = past.filter(r => r.stage === 'ABANDONED')
  const materialized = past.filter(r => r.stage !== 'ABANDONED')

  const [open, setOpen] = useState(Boolean(active))
  const [abandonedOpen, setAbandonedOpen] = useState(false)

  if (error) {
    return (
      <p className='text-sm text-danger-text' data-testid='plan-runs-section'>
        {intl.formatMessage({ id: 'planRuns.loadError' })}
      </p>
    )
  }

  // Nothing to show yet — stay out of the way (and don't flash on first load).
  if (loading || (!active && past.length === 0)) return null

  // Newest run wins the header's date — the list is already newest-first.
  const lastRun = runs[0]

  const summary = [
    active
      ? intl.formatMessage({ id: 'planRuns.status.inProgress' })
      : undefined,
    materialized.length > 0
      ? intl.formatMessage(
          { id: 'planRuns.countMaterialized' },
          { count: materialized.length }
        )
      : undefined,
    abandoned.length > 0
      ? intl.formatMessage(
          { id: 'planRuns.countAbandoned' },
          { count: abandoned.length }
        )
      : undefined,
  ]
    .filter(Boolean)
    .join(' · ')

  const visiblePast = abandonedOpen ? past : materialized

  return (
    <section
      data-testid='plan-runs-section'
      className='mb-7 overflow-hidden rounded-lg border border-border bg-card'
    >
      <button
        type='button'
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        data-testid='plan-runs-toggle'
        className='flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-muted/50'
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90'
          )}
        />
        <span className='text-sm font-semibold'>
          {intl.formatMessage({ id: 'planRuns.title' })}
        </span>
        <span className='truncate text-xs text-muted-foreground'>
          {summary}
        </span>
        <span className='flex-1' />
        {lastRun && (
          <span className='shrink-0 text-xs text-muted-foreground'>
            {intl.formatMessage(
              { id: 'planRuns.lastRun' },
              {
                date: intl.formatDate(new Date(lastRun.createdAt), {
                  dateStyle: 'medium',
                }),
              }
            )}
          </span>
        )}
      </button>

      {open && (
        <div className='border-t border-border'>
          {active && (
            <Link
              href={`/workspace/${workspaceUrl}/plan/${active.id}`}
              data-testid='plan-run-active'
              className='flex items-baseline gap-3 border-b border-border py-2 pl-9 pr-3.5 text-sm hover:bg-muted/50'
            >
              <PlanRunStatusPill
                label={intl.formatMessage({ id: 'planRuns.status.inProgress' })}
                tone='info'
              />
              <span className='shrink-0 text-xs text-muted-foreground'>
                {intl.formatDate(new Date(active.createdAt), {
                  dateStyle: 'medium',
                })}
              </span>
              <span className='flex-1' />
              <span className='shrink-0 text-xs font-medium text-primary'>
                {intl.formatMessage({ id: 'planRuns.resume' })}
              </span>
            </Link>
          )}

          {visiblePast.map(run => (
            <Link
              key={run.id}
              href={`/workspace/${workspaceUrl}/plan/${run.id}`}
              data-testid='plan-run-past'
              className='flex items-baseline gap-3 border-b border-border py-2 pl-9 pr-3.5 text-sm hover:bg-muted/50'
            >
              <PlanRunStatusPill
                label={intl.formatMessage({
                  id:
                    STATUS_MESSAGE[run.stage] ?? 'planRuns.status.materialized',
                })}
                tone={run.stage === 'MATERIALIZED' ? 'success' : 'muted'}
              />
              <span className='shrink-0 text-xs text-muted-foreground'>
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
          ))}

          {abandoned.length > 0 && (
            <button
              type='button'
              onClick={() => setAbandonedOpen(o => !o)}
              aria-expanded={abandonedOpen}
              data-testid='plan-runs-abandoned-toggle'
              className='w-full py-2 pl-9 pr-3.5 text-left text-xs text-muted-foreground hover:text-foreground'
            >
              {intl.formatMessage(
                {
                  id: abandonedOpen
                    ? 'planRuns.hideAbandoned'
                    : 'planRuns.showAbandoned',
                },
                { count: abandoned.length }
              )}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

/** The run-status pill — a neutral label on a tinted, token-driven ground. */
function PlanRunStatusPill({
  label,
  tone,
}: {
  label: string
  tone: 'info' | 'success' | 'muted'
}) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        tone === 'info' && 'border-info-border bg-info-subtle text-foreground',
        tone === 'success' &&
          'border-success-border bg-success-subtle text-foreground',
        tone === 'muted' && 'border-border bg-muted text-muted-foreground'
      )}
    >
      {label}
    </span>
  )
}

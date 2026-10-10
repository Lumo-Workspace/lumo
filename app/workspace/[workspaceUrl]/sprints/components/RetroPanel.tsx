'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { marked } from 'marked'
import { useSprintSummary } from '../../hooks/useSprints'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { sprintsClient } from '@/lib/api-client'
import { RichHtml } from '@/components/RichHtml'

interface SprintStats {
  totalTasks?: number
  done?: number
  spillover?: number
  byPriority?: Record<string, number>
  byAssignee?: Record<string, number>
  byStatus?: Partial<
    Record<'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE', number>
  >
}

export function RetroPanel({ sprintId }: { sprintId: string }) {
  const intl = useIntl()
  const { summary, isLoading, error, refetch } = useSprintSummary(sprintId)
  const [retrying, setRetrying] = useState(false)

  async function retry() {
    setRetrying(true)
    try {
      await sprintsClient.retrySummary(sprintId)
      // Give the backend a moment, then refetch.
      setTimeout(() => {
        refetch()
        setRetrying(false)
      }, 2000)
    } catch {
      setRetrying(false)
    }
  }

  if (isLoading) {
    return (
      <aside className='flex flex-col gap-2 border-l pl-4'>
        <p className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'sprints.retro.loading' })}
        </p>
      </aside>
    )
  }

  // summary is null → retro not yet generated (job pending or failed)
  if (!summary) {
    return (
      <aside className='flex flex-col gap-3 border-l pl-4'>
        <h3 className='font-semibold'>
          {intl.formatMessage({ id: 'sprints.retro.title' })}
        </h3>
        <p className='text-sm text-muted-foreground'>
          {error
            ? error.message
            : intl.formatMessage({ id: 'sprints.retro.generating' })}
        </p>
        <Button onClick={retry} disabled={retrying} size='sm'>
          {retrying
            ? intl.formatMessage({ id: 'sprints.retro.retrying' })
            : intl.formatMessage({ id: 'sprints.retro.retry' })}
        </Button>
      </aside>
    )
  }

  // Some legacy responses wrapped the row in `{ summary }`; if that's still
  // in flight in dev, unwrap defensively. Also handle missing report safely.
  const safe = (summary as unknown as { summary?: typeof summary }).summary
    ? (summary as unknown as { summary: typeof summary }).summary
    : summary
  const reportText: string = safe?.report ?? ''
  const tldrText: string = safe?.tldr ?? ''
  const generatedAt: Date = safe?.generatedAt
    ? new Date(safe.generatedAt)
    : new Date()
  const parsed = reportText ? marked.parse(reportText) : ''
  const reportHtml: string = typeof parsed === 'string' ? parsed : ''

  const stats = (safe?.stats as SprintStats | undefined) ?? {}
  const total = stats.totalTasks ?? 0
  const done = stats.done ?? 0
  const spillover = stats.spillover ?? 0
  // What's left in the sprint at close that wasn't DONE and didn't spill out.
  // (For a CLOSED sprint with the current spec this should be 0, but the
  // accounting is defensive — the LLM may have surfaced edge cases.)
  const stuck = Math.max(0, total - done - spillover)
  const donePct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <aside className='flex flex-col gap-3 overflow-y-auto border-l pl-4 pr-2'>
      <header>
        <h3 className='font-semibold'>
          {intl.formatMessage({ id: 'sprints.retro.title' })}
        </h3>
        <p className='text-xs text-muted-foreground'>
          {intl.formatMessage(
            { id: 'sprints.retro.generatedAt' },
            { date: generatedAt.toLocaleString(intl.locale) }
          )}
        </p>
      </header>

      <section className='rounded-sm border bg-muted/30 p-3'>
        <p className='text-sm font-medium'>{tldrText}</p>
      </section>

      {/* Stats card */}
      <section className='rounded-sm border p-3 flex flex-col gap-3'>
        <div className='grid grid-cols-3 gap-3 text-center'>
          <div>
            <p className='text-xl font-bold tabular-nums'>{total}</p>
            <p className='text-[10px] uppercase tracking-wide text-muted-foreground'>
              {intl.formatMessage({ id: 'sprints.retro.stats.planned' })}
            </p>
          </div>
          <div>
            <p className='text-xl font-bold tabular-nums text-green-600 dark:text-green-400'>
              {done}
            </p>
            <p className='text-[10px] uppercase tracking-wide text-muted-foreground'>
              {intl.formatMessage({ id: 'sprints.retro.stats.done' })}
            </p>
          </div>
          <div>
            <p className='text-xl font-bold tabular-nums text-yellow-600 dark:text-yellow-400'>
              {spillover}
            </p>
            <p className='text-[10px] uppercase tracking-wide text-muted-foreground'>
              {intl.formatMessage({ id: 'sprints.retro.stats.spillover' })}
            </p>
          </div>
        </div>

        <div className='space-y-1'>
          <div className='flex justify-between text-xs text-muted-foreground'>
            <span>
              {intl.formatMessage({ id: 'sprints.retro.stats.completion' })}
            </span>
            <span className='tabular-nums'>{donePct}%</span>
          </div>
          <Progress value={donePct} className='h-1.5' />
        </div>

        {stuck > 0 && (
          <p className='text-[11px] text-muted-foreground'>
            {intl.formatMessage(
              { id: 'sprints.retro.stats.stuckNote' },
              { count: stuck }
            )}
          </p>
        )}
      </section>

      <section>
        {/* marked.parse returns synchronously when no async tokens */}
        <RichHtml
          className='prose prose-sm max-w-none text-sm'
          html={reportHtml}
        />
      </section>
    </aside>
  )
}

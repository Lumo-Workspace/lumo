'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { marked } from 'marked'
import { useSprintSummary } from '../../hooks/useSprints'
import { Button } from '@/components/ui/button'
import { sprintsClient } from '@/lib/api-client'

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

  const reportHtml =
    typeof marked.parse(summary.report) === 'string'
      ? (marked.parse(summary.report) as string)
      : ''

  return (
    <aside className='flex flex-col gap-3 overflow-y-auto border-l pl-4 pr-2'>
      <header>
        <h3 className='font-semibold'>
          {intl.formatMessage({ id: 'sprints.retro.title' })}
        </h3>
        <p className='text-xs text-muted-foreground'>
          {intl.formatMessage(
            { id: 'sprints.retro.generatedAt' },
            { date: new Date(summary.generatedAt).toLocaleString() }
          )}
        </p>
      </header>

      <section className='rounded border bg-muted/30 p-3'>
        <p className='text-sm font-medium'>{summary.tldr}</p>
      </section>

      <section>
        <div
          className='prose prose-sm max-w-none text-sm'
          // marked.parse returns synchronously when no async tokens
          dangerouslySetInnerHTML={{ __html: reportHtml }}
        />
      </section>
    </aside>
  )
}

'use client'

import { useMemo } from 'react'
import { useIntl } from 'react-intl'
import { marked } from 'marked'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { RichHtml } from '@/components/RichHtml'

interface RetroCardProps {
  loading: boolean
  /** The summary read failed for a reason other than "not generated yet". */
  readFailed: boolean
  /** Null while the retro is not generated yet (pending or failed). */
  retro: { tldr: string; report: string; generatedAt: string } | null
  retrying: boolean
  /** A failed retry (e.g. one already in progress); shown as plain text. */
  retryError: string | null
  onRetry: () => void
}

/**
 * The generated retro (tldr + markdown report) with a "regenerate" action —
 * the data path of the retired RetroPanel, as a full-width card.
 */
export function RetroCard({
  loading,
  readFailed,
  retro,
  retrying,
  retryError,
  onRetry,
}: RetroCardProps) {
  const intl = useIntl()
  const report = retro?.report ?? ''
  // RichHtml sanitizes this against the shared allowlist before rendering.
  const reportHtml = useMemo(() => {
    const parsed = report ? marked.parse(report) : ''
    return typeof parsed === 'string' ? parsed : ''
  }, [report])

  return (
    <Card>
      <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-3 p-4 sm:p-6 sm:pb-4'>
        <div className='flex flex-col gap-1.5'>
          <CardTitle>
            {intl.formatMessage({ id: 'sprints.retro.title' })}
          </CardTitle>
          <CardDescription>
            {retro
              ? intl.formatMessage(
                  { id: 'sprints.detail.retro.summary.subtitle' },
                  {
                    date: intl.formatDate(retro.generatedAt, {
                      month: 'short',
                      day: 'numeric',
                    }),
                  }
                )
              : intl.formatMessage({
                  id: loading
                    ? 'sprints.retro.loading'
                    : readFailed
                      ? 'sprints.detail.retro.summary.readError'
                      : 'sprints.retro.generating',
                })}
          </CardDescription>
        </div>
        {!loading && (
          <Button
            variant='ghost'
            size='sm'
            onClick={onRetry}
            disabled={retrying}
          >
            <RefreshCw className='size-4' />
            {intl.formatMessage({
              id: retrying ? 'sprints.retro.retrying' : 'sprints.retro.retry',
            })}
          </Button>
        )}
      </CardHeader>
      <CardContent className='flex flex-col gap-3 p-4 pt-0 sm:p-6 sm:pt-0'>
        {retryError && (
          <p className='text-body text-muted-foreground'>{retryError}</p>
        )}
        {loading ? (
          <Skeleton className='h-24' />
        ) : retro ? (
          <>
            {retro.tldr && <p className='text-body-strong'>{retro.tldr}</p>}
            <RichHtml
              className='prose prose-sm max-w-none text-body text-foreground dark:prose-invert'
              html={reportHtml}
            />
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

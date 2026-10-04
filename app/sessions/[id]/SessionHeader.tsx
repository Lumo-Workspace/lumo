'use client'

import Link from 'next/link'
import { useIntl } from 'react-intl'
import { SESSION_MESSAGES as M } from '../messages'

interface SessionHeaderProps {
  id: string
  cwd: string | null
  startedAt: string
  lastActivityAt: string
  durationMin: number
  toolCallCount: number
  errorCount: number
}

export function SessionHeader({
  id,
  cwd,
  startedAt,
  lastActivityAt,
  durationMin,
  toolCallCount,
  errorCount,
}: SessionHeaderProps) {
  const intl = useIntl()
  return (
    <>
      <div className='mb-6'>
        <Link
          href='/sessions'
          className='text-sm text-muted-foreground hover:text-foreground'
        >
          {intl.formatMessage(M['detail.back'])}
        </Link>
      </div>

      <header className='mb-8 space-y-2'>
        <h1 className='font-mono text-sm text-muted-foreground'>{id}</h1>
        <p className='text-lg'>
          {cwd ?? <em>{intl.formatMessage(M['list.noCwd'])}</em>}
        </p>
        <dl className='grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-5'>
          <div>
            <dt className='text-muted-foreground'>
              {intl.formatMessage(M['detail.started'])}
            </dt>
            <dd>{startedAt}</dd>
          </div>
          <div>
            <dt className='text-muted-foreground'>
              {intl.formatMessage(M['detail.lastActivity'])}
            </dt>
            <dd>{lastActivityAt}</dd>
          </div>
          <div>
            <dt className='text-muted-foreground'>
              {intl.formatMessage(M['detail.duration'])}
            </dt>
            <dd>
              {intl.formatMessage(M['detail.durationMin'], { n: durationMin })}
            </dd>
          </div>
          <div>
            <dt className='text-muted-foreground'>
              {intl.formatMessage(M['detail.toolCalls'])}
            </dt>
            <dd>{toolCallCount}</dd>
          </div>
          <div>
            <dt className='text-muted-foreground'>
              {intl.formatMessage(M['detail.errors'])}
            </dt>
            <dd className={errorCount > 0 ? 'text-danger-text' : undefined}>
              {errorCount}
            </dd>
          </div>
        </dl>
      </header>
    </>
  )
}

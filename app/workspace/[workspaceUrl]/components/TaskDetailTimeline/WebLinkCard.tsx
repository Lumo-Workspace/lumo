'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { RefreshCw, Trash2, Link } from 'lucide-react'
import type { OptimisticWebLink } from '../../hooks/useWebLinks'

interface Props {
  link: OptimisticWebLink
  onRefresh: (linkId: string) => Promise<void>
  onRemove: (linkId: string) => Promise<void>
}

function relativeAgo(date: Date, now = new Date()): string {
  const diffMin = Math.max(
    0,
    Math.round((now.getTime() - date.getTime()) / 60000)
  )
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  return `${Math.round(diffH / 24)}d ago`
}

function isSafeUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

export function WebLinkCard({
  link,
  onRefresh,
  onRemove,
}: Props): React.ReactElement {
  const intl = useIntl()
  const [busy, setBusy] = useState(false)

  const safeHref = isSafeUrl(link.url) ? link.url : undefined
  const safeImage =
    link.imageUrl && isSafeUrl(link.imageUrl) ? link.imageUrl : undefined
  const safeFavicon =
    link.faviconUrl && isSafeUrl(link.faviconUrl) ? link.faviconUrl : undefined

  const hasRichPreview = Boolean(link.title)

  const handleRefresh = async () => {
    setBusy(true)
    try {
      await onRefresh(link.id)
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async () => {
    const confirmed = window.confirm(
      intl.formatMessage({
        id: 'task.webLinks.confirmDelete',
        defaultMessage: 'Delete this link?',
      })
    )
    if (!confirmed) return
    setBusy(true)
    try {
      await onRemove(link.id)
    } finally {
      setBusy(false)
    }
  }

  const cardInner = (
    <div className='border border-zinc-200 dark:border-zinc-800 rounded-md bg-white dark:bg-zinc-950 overflow-hidden'>
      {hasRichPreview ? (
        /* Rich variant */
        <div className='flex gap-3 p-3'>
          {safeImage && (
            <img
              src={safeImage}
              alt=''
              referrerPolicy='no-referrer'
              className='w-[120px] h-[72px] object-cover rounded flex-shrink-0'
            />
          )}
          <div className='flex-1 min-w-0'>
            <div className='flex items-start justify-between gap-1'>
              <p className='text-sm font-medium text-zinc-800 dark:text-zinc-100 truncate'>
                {link.title}
              </p>
              <div className='flex items-center gap-1 flex-shrink-0 ml-1'>
                <button
                  onClick={e => {
                    e.preventDefault()
                    void handleRefresh()
                  }}
                  disabled={busy}
                  title={intl.formatMessage({
                    id: 'task.webLinks.card.refresh',
                    defaultMessage: 'Refresh preview',
                  })}
                  className='p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50'
                >
                  <RefreshCw size={14} />
                </button>
                <button
                  onClick={e => {
                    e.preventDefault()
                    void handleRemove()
                  }}
                  disabled={busy}
                  title={intl.formatMessage({
                    id: 'task.webLinks.card.delete',
                    defaultMessage: 'Delete',
                  })}
                  className='p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50'
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            {(link.note ?? link.description) && (
              <p className='mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2'>
                {link.note ?? link.description}
              </p>
            )}
            <p className='mt-1 text-xs text-zinc-400 dark:text-zinc-500'>
              {link.domain} · {relativeAgo(new Date(link.createdAt))}
            </p>
          </div>
        </div>
      ) : (
        /* Fallback variant */
        <div className='flex items-start gap-2 p-3'>
          {safeFavicon ? (
            <img
              src={safeFavicon}
              alt=''
              referrerPolicy='no-referrer'
              className='w-4 h-4 mt-0.5 flex-shrink-0'
            />
          ) : (
            <Link size={14} className='mt-0.5 flex-shrink-0 text-zinc-400' />
          )}
          <div className='flex-1 min-w-0'>
            <div className='flex items-start justify-between gap-1'>
              <div className='min-w-0'>
                <p className='text-xs font-medium text-zinc-600 dark:text-zinc-400'>
                  {link.domain}
                </p>
                <p className='text-xs text-zinc-400 dark:text-zinc-500 truncate'>
                  {link.url}
                </p>
                <p
                  className={`mt-0.5 text-xs ${
                    link.loading
                      ? 'text-zinc-400 dark:text-zinc-500'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {link.loading
                    ? intl.formatMessage({
                        id: 'task.webLinks.card.loading',
                        defaultMessage: 'Loading preview…',
                      })
                    : intl.formatMessage({
                        id: 'task.webLinks.error.fetchFailed',
                        defaultMessage: 'Preview unavailable',
                      })}
                </p>
              </div>
              {!link.loading && (
                <div className='flex items-center gap-1 flex-shrink-0 ml-1'>
                  <button
                    onClick={e => {
                      e.preventDefault()
                      void handleRefresh()
                    }}
                    disabled={busy}
                    title={intl.formatMessage({
                      id: 'task.webLinks.card.refresh',
                      defaultMessage: 'Refresh preview',
                    })}
                    className='p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50'
                  >
                    <RefreshCw size={14} />
                  </button>
                  <button
                    onClick={e => {
                      e.preventDefault()
                      void handleRemove()
                    }}
                    disabled={busy}
                    title={intl.formatMessage({
                      id: 'task.webLinks.card.delete',
                      defaultMessage: 'Delete',
                    })}
                    className='p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50'
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
            <p className='mt-1 text-xs text-zinc-400 dark:text-zinc-500'>
              {relativeAgo(new Date(link.createdAt))}
            </p>
          </div>
        </div>
      )}
    </div>
  )

  if (safeHref) {
    return (
      <a
        href={safeHref}
        target='_blank'
        rel='noopener noreferrer'
        referrerPolicy='no-referrer'
        className='block'
      >
        {cardInner}
      </a>
    )
  }

  return <div>{cardInner}</div>
}

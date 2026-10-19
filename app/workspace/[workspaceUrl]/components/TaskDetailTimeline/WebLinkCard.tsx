'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { RefreshCw, Trash2, Link } from 'lucide-react'
import type { OptimisticWebLink } from '../../hooks/useWebLinks'
import { useNow } from '@/hooks/use-now'
import { ConfirmActionDialog } from '../ConfirmActionDialog'
import { formatRelativeAgo } from '@/lib/datetime/relative'
import { ContentSignalsBadge } from '../ContentSignalsBadge'

interface Props {
  link: OptimisticWebLink
  onRefresh: (linkId: string) => Promise<void>
  onRemove: (linkId: string) => Promise<void>
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
  const [confirmOpen, setConfirmOpen] = useState(false)
  const now = useNow()

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
    setConfirmOpen(false)
    setBusy(true)
    try {
      await onRemove(link.id)
    } finally {
      setBusy(false)
    }
  }

  const cardInner = (
    <div className='border border-border rounded-md bg-card overflow-hidden'>
      {hasRichPreview ? (
        /* Rich variant */
        <div className='flex gap-3 p-3'>
          {safeImage && (
            <img
              src={safeImage}
              alt=''
              referrerPolicy='no-referrer'
              className='w-[120px] h-[72px] object-cover rounded-sm flex-shrink-0'
            />
          )}
          <div className='flex-1 min-w-0'>
            <div className='flex items-start justify-between gap-1'>
              <p className='text-body-strong text-foreground truncate'>
                {link.title}
              </p>
              <ContentSignalsBadge
                signals={link.contentSignals}
                className='shrink-0'
              />
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
                  className='p-1 rounded-sm hover:bg-muted disabled:opacity-50'
                >
                  <RefreshCw size={14} />
                </button>
                <button
                  onClick={e => {
                    e.preventDefault()
                    setConfirmOpen(true)
                  }}
                  disabled={busy}
                  title={intl.formatMessage({
                    id: 'task.webLinks.card.delete',
                    defaultMessage: 'Delete',
                  })}
                  className='p-1 rounded-sm hover:bg-muted disabled:opacity-50'
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            {(link.note ?? link.description) && (
              <p className='mt-0.5 text-caption text-muted-foreground line-clamp-2'>
                {link.note ?? link.description}
              </p>
            )}
            <p className='mt-1 text-caption text-muted-foreground'>
              {link.domain}
              {now != null &&
                ` · ${formatRelativeAgo(intl, link.createdAt, now)}`}
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
            <Link
              size={14}
              className='mt-0.5 flex-shrink-0 text-muted-foreground'
            />
          )}
          <div className='flex-1 min-w-0'>
            <div className='flex items-start justify-between gap-1'>
              <div className='min-w-0'>
                <p className='text-caption text-muted-foreground'>
                  {link.domain}
                </p>
                <p className='text-caption text-muted-foreground truncate'>
                  {link.url}
                </p>
                <ContentSignalsBadge signals={link.contentSignals} />
                <p
                  className={`mt-0.5 text-caption ${
                    link.loading ? 'text-muted-foreground' : 'text-warning-text'
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
                    className='p-1 rounded-sm hover:bg-muted disabled:opacity-50'
                  >
                    <RefreshCw size={14} />
                  </button>
                  <button
                    onClick={e => {
                      e.preventDefault()
                      setConfirmOpen(true)
                    }}
                    disabled={busy}
                    title={intl.formatMessage({
                      id: 'task.webLinks.card.delete',
                      defaultMessage: 'Delete',
                    })}
                    className='p-1 rounded-sm hover:bg-muted disabled:opacity-50'
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
            <p className='mt-1 text-caption text-muted-foreground'>
              {now != null ? formatRelativeAgo(intl, link.createdAt, now) : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  )

  const confirmDialog = (
    <ConfirmActionDialog
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      title={intl.formatMessage({
        id: 'task.webLinks.confirmDelete',
        defaultMessage: 'Delete this link?',
      })}
      confirmLabel={intl.formatMessage({
        id: 'task.webLinks.card.delete',
        defaultMessage: 'Delete',
      })}
      destructive
      onConfirm={() => void handleRemove()}
    />
  )

  if (safeHref) {
    return (
      <>
        <a
          href={safeHref}
          target='_blank'
          rel='noopener noreferrer'
          referrerPolicy='no-referrer'
          className='block'
        >
          {cardInner}
        </a>
        {confirmDialog}
      </>
    )
  }

  return (
    <>
      <div>{cardInner}</div>
      {confirmDialog}
    </>
  )
}

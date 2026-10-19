'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { RefreshCw, Trash2 } from 'lucide-react'
import { FigmaIcon } from '../FigmaIcon'
import type { OptimisticFigmaLink } from '../../hooks/useFigmaLinks'
import { formatRelativeAgo } from '@/lib/datetime/relative'
import { useNow } from '@/hooks/use-now'
import { ConfirmActionDialog } from '../ConfirmActionDialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface Props {
  link: OptimisticFigmaLink
  onRemove: (linkId: string) => Promise<void>
  onRefreshAll?: () => Promise<void>
}

function isSafeUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

export function FigmaLinkCard({
  link,
  onRemove,
  onRefreshAll,
}: Props): React.ReactElement {
  const intl = useIntl()
  const now = useNow()
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const safeHref = isSafeUrl(link.url) ? link.url : undefined
  const safeThumbnail =
    link.thumbnailUrl && isSafeUrl(link.thumbnailUrl)
      ? link.thumbnailUrl
      : undefined

  const frameName =
    link.frameName ??
    intl.formatMessage({
      id: 'task.figma.fileLevel',
      defaultMessage: '(file-level)',
    })

  const handleRefreshAll = async () => {
    if (!onRefreshAll) return
    setBusy(true)
    try {
      await onRefreshAll()
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
      <div className='flex gap-3 p-3'>
        {/* Thumbnail or placeholder */}
        {link.loading ? (
          <div className='w-[120px] h-[72px] rounded-sm flex-shrink-0 bg-muted animate-pulse' />
        ) : safeThumbnail ? (
          /* Figma CDN thumbnails — use <img> to avoid next.config changes */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={safeThumbnail}
            alt=''
            referrerPolicy='no-referrer'
            className='w-[120px] h-[72px] object-cover rounded-sm flex-shrink-0'
          />
        ) : (
          <div className='w-[120px] h-[72px] rounded-sm flex-shrink-0 bg-muted flex items-center justify-center'>
            <FigmaIcon className='w-6 h-6 opacity-30' />
          </div>
        )}

        <div className='flex-1 min-w-0'>
          <div className='flex items-start justify-between gap-1'>
            <div className='min-w-0'>
              <p className='text-body-strong text-foreground truncate'>
                {link.loading ? (
                  <span className='text-muted-foreground'>
                    {intl.formatMessage({
                      id: 'task.figma.card.loading',
                      defaultMessage: 'Loading…',
                    })}
                  </span>
                ) : link.fileName ? (
                  link.fileName
                ) : (
                  link.url
                )}
              </p>
              {!link.loading && (
                <p className='text-caption text-muted-foreground truncate'>
                  {frameName}
                </p>
              )}
            </div>

            {!link.loading && (
              <div className='flex items-center gap-1 flex-shrink-0 ml-1'>
                {onRefreshAll && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={e => {
                          e.preventDefault()
                          void handleRefreshAll()
                        }}
                        disabled={busy}
                        aria-label={intl.formatMessage({
                          id: 'task.figma.card.refresh',
                          defaultMessage: 'Refresh designs',
                        })}
                        className='p-1 rounded-sm hover:bg-muted disabled:opacity-50'
                      >
                        <RefreshCw size={14} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {intl.formatMessage({
                        id: 'task.figma.card.refresh',
                        defaultMessage: 'Refresh designs',
                      })}
                    </TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={e => {
                        e.preventDefault()
                        setConfirmOpen(true)
                      }}
                      disabled={busy}
                      aria-label={intl.formatMessage({
                        id: 'task.figma.card.delete',
                        defaultMessage: 'Remove',
                      })}
                      className='p-1 rounded-sm hover:bg-muted disabled:opacity-50'
                    >
                      <Trash2 size={14} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {intl.formatMessage({
                      id: 'task.figma.card.delete',
                      defaultMessage: 'Remove',
                    })}
                  </TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>

          {!link.loading && link.lastSyncError && (
            <p className='mt-0.5 text-caption text-warning-text'>
              {link.lastSyncError}
            </p>
          )}

          {!link.loading && (
            <p className='mt-1 text-caption text-muted-foreground'>
              {intl.formatMessage(
                {
                  id: 'task.figma.lastSynced',
                  defaultMessage: 'Synced {ago}',
                },
                {
                  ago:
                    now != null
                      ? formatRelativeAgo(intl, link.lastSyncedAt, now)
                      : '',
                }
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  )

  const confirmDialog = (
    <ConfirmActionDialog
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      title={intl.formatMessage({
        id: 'task.figma.confirmDelete',
        defaultMessage: 'Remove this Figma design?',
      })}
      confirmLabel={intl.formatMessage({
        id: 'task.figma.card.delete',
        defaultMessage: 'Remove',
      })}
      destructive
      onConfirm={() => void handleRemove()}
    />
  )

  if (safeHref && !link.loading) {
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

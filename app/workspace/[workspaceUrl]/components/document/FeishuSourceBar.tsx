'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ApiClientError } from '@/lib/api-client'
import { feishuDocsApi } from '@/lib/api-client/feishu-docs'
import { formatRelativeTime } from '@/lib/datetime/relative'
import { feishuDocErrorMessageId } from './feishu-doc-errors'

interface FeishuSourceBarProps {
  documentId: string
  /** Canonical Feishu URL; only https Feishu / Lark hosts are ever stored. */
  sourceUrl: string | null
  syncedAt: string | null
  /** Stable code of the last failed re-sync, null after a success. */
  syncError: string | null
  /** Persist pending local edits before the body is replaced. */
  onBeforeResync: () => Promise<void>
  /** Re-read the doc (new body, or the newly recorded error). */
  onAfterResync: (succeeded: boolean) => Promise<void>
}

/**
 * LUM-1343 — shown on a doc imported from Feishu: when it last synced, a
 * link back, a Resync button, and the last sync failure if there is one.
 */
export function FeishuSourceBar({
  documentId,
  sourceUrl,
  syncedAt,
  syncError,
  onBeforeResync,
  onAfterResync,
}: FeishuSourceBarProps) {
  const intl = useIntl()
  const [syncing, setSyncing] = useState(false)

  async function resync() {
    if (!window.confirm(intl.formatMessage({ id: 'feishuDocs.resyncConfirm' })))
      return
    setSyncing(true)
    try {
      await onBeforeResync()
      await feishuDocsApi.resyncDoc(documentId)
      toast.success(intl.formatMessage({ id: 'feishuDocs.resynced' }))
      await onAfterResync(true)
    } catch (error) {
      toast.error(
        intl.formatMessage({
          id: feishuDocErrorMessageId(
            error instanceof ApiClientError ? error.code : null
          ),
        })
      )
      await onAfterResync(false)
    } finally {
      setSyncing(false)
    }
  }

  const safeUrl = sourceUrl?.startsWith('https://') ? sourceUrl : null

  return (
    <div className='mb-3 text-caption text-muted-foreground'>
      <div className='flex items-center gap-2 flex-wrap'>
        <span>
          {syncedAt
            ? intl.formatMessage(
                { id: 'feishuDocs.syncedFrom' },
                { time: formatRelativeTime(syncedAt, intl.locale) }
              )
            : intl.formatMessage({ id: 'feishuDocs.importedFrom' })}
        </span>
        {safeUrl && (
          <>
            <span className='text-border'>·</span>
            <a
              href={safeUrl}
              target='_blank'
              rel='noopener noreferrer'
              className='inline-flex items-center gap-1 hover:text-foreground'
            >
              <ExternalLink size={12} />
              {intl.formatMessage({ id: 'feishuDocs.openInFeishu' })}
            </a>
          </>
        )}
        <span className='text-border'>·</span>
        <Button
          size='sm'
          variant='ghost'
          className='h-6 gap-1 px-1.5 text-caption'
          onClick={resync}
          disabled={syncing}
        >
          <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
          {intl.formatMessage({
            id: syncing ? 'feishuDocs.resyncing' : 'feishuDocs.resync',
          })}
        </Button>
      </div>
      {syncError && (
        <p role='status' className='mt-1 text-danger-text'>
          {intl.formatMessage(
            { id: 'feishuDocs.lastSyncFailed' },
            {
              reason: intl.formatMessage({
                id: feishuDocErrorMessageId(syncError),
              }),
            }
          )}
        </p>
      )}
    </div>
  )
}

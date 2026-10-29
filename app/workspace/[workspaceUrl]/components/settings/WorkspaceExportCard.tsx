'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { workspacesClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import { Button } from '@/components/ui/button'
import type { WorkspaceExportView } from '@/lib/services/workspace-export.service'
import { EXPORT_TTL_DAYS } from '@/lib/workspace/export-ttl'

const POLL_MS = 5000

function isInProgress(e: WorkspaceExportView) {
  return e.status === 'PENDING' || e.status === 'RUNNING'
}

/** Poll while any export is still generating; stop once all have settled. */
export function exportsPollInterval(
  exports: WorkspaceExportView[] | undefined
): number | false {
  return exports?.some(isInProgress) ? POLL_MS : false
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * LUM-858 — OWNER-only GDPR data export: start an export, watch it generate,
 * download the zip while its window is open.
 */
export function WorkspaceExportCard() {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const [starting, setStarting] = useState(false)

  const query = useQuery({
    queryKey: queryKeys.workspaceExports(),
    queryFn: async () => (await workspacesClient.listExports()).exports,
    refetchInterval: q => exportsPollInterval(q.state.data),
    retry: false,
  })
  // A failed read shows an empty list (or keeps the last good one) and toasts.
  const exports = query.data ?? (query.isError ? [] : null)
  const polling = exportsPollInterval(query.data) !== false

  const { errorUpdateCount } = query
  useEffect(() => {
    if (errorUpdateCount === 0) return
    toast.error(
      intl.formatMessage({ id: 'workspaceSettings.export.loadFailed' })
    )
  }, [errorUpdateCount, intl])

  const load = async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.workspaceExports(),
    })
  }

  const handleStart = async () => {
    setStarting(true)
    try {
      const res = await workspacesClient.startExport()
      toast.success(
        intl.formatMessage({
          id: res.started
            ? 'workspaceSettings.export.started'
            : 'workspaceSettings.export.alreadyRunning',
        })
      )
      await load()
    } catch {
      toast.error(
        intl.formatMessage({ id: 'workspaceSettings.export.startFailed' })
      )
    } finally {
      setStarting(false)
    }
  }

  const formatDate = (iso: string) =>
    intl.formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <div className='rounded-lg border border-border overflow-hidden mb-8'>
      <div className='flex items-start justify-between gap-4 px-5 py-3 border-b border-border'>
        <div>
          <p className='text-body-strong text-foreground'>
            {intl.formatMessage({ id: 'workspaceSettings.export.title' })}
          </p>
          <p className='text-caption text-muted-foreground mt-0.5'>
            {intl.formatMessage({ id: 'workspaceSettings.export.description' })}
          </p>
          <p className='text-caption text-muted-foreground mt-1'>
            {intl.formatMessage(
              { id: 'workspaceSettings.export.ttlNote' },
              { days: EXPORT_TTL_DAYS }
            )}
          </p>
        </div>
        <Button
          size='sm'
          variant='outline'
          className='shrink-0'
          onClick={handleStart}
          disabled={starting || polling}
        >
          {intl.formatMessage({
            id: starting
              ? 'workspaceSettings.export.starting'
              : 'workspaceSettings.export.start',
          })}
        </Button>
      </div>

      {exports !== null && exports.length === 0 && (
        <p className='px-5 py-4 text-caption text-muted-foreground'>
          {intl.formatMessage({ id: 'workspaceSettings.export.empty' })}
        </p>
      )}

      {exports?.map(e => (
        <div
          key={e.id}
          className='flex items-center justify-between gap-4 px-5 py-3 border-b border-border last:border-b-0'
        >
          <div className='min-w-0'>
            <p className='text-body-strong text-foreground'>
              {intl.formatMessage({
                id: `workspaceSettings.export.status.${e.status}`,
              })}
              {e.sizeBytes !== null && e.status === 'READY' && (
                <span className='ml-2 text-caption font-normal text-muted-foreground'>
                  {formatBytes(e.sizeBytes)}
                </span>
              )}
            </p>
            <p className='text-caption text-muted-foreground mt-0.5'>
              {intl.formatMessage(
                { id: 'workspaceSettings.export.requestedAt' },
                { date: formatDate(e.createdAt) }
              )}
              {e.status === 'READY' && e.expiresAt && (
                <>
                  {' · '}
                  {intl.formatMessage(
                    { id: 'workspaceSettings.export.expiresAt' },
                    { date: formatDate(e.expiresAt) }
                  )}
                </>
              )}
              {e.downloadCount > 0 && (
                <>
                  {' · '}
                  {intl.formatMessage(
                    { id: 'workspaceSettings.export.downloads' },
                    { count: e.downloadCount }
                  )}
                </>
              )}
            </p>
            {e.status === 'FAILED' && (
              <p className='text-caption text-muted-foreground mt-0.5'>
                {intl.formatMessage({
                  id: 'workspaceSettings.export.failedHint',
                })}
              </p>
            )}
          </div>
          {e.status === 'READY' && (
            <Button size='sm' variant='outline' asChild className='shrink-0'>
              <a href={workspacesClient.exportDownloadUrl(e.id)} download>
                {intl.formatMessage({
                  id: 'workspaceSettings.export.download',
                })}
              </a>
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}

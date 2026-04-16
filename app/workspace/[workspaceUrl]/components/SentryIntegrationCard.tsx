'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import { sentryApi, type SentryStatus } from '@/lib/api-client/sentry'
import { SentryConnectDialog } from './SentryConnectDialog'
import { SentryMappingsDialog } from './SentryMappingsDialog'

export function SentryIntegrationCard({ isOwner }: { isOwner: boolean }) {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const [status, setStatus] = useState<SentryStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [connectOpen, setConnectOpen] = useState(false)
  const [mappingsOpen, setMappingsOpen] = useState(false)

  const loadStatus = async () => {
    try {
      setStatus(await sentryApi.getStatus(workspaceUrl))
    } catch {
      toast.error('Failed to load Sentry status')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
  }, [workspaceUrl])

  const handleDisconnect = async () => {
    if (!confirm('Disconnect Sentry? Existing tasks remain.')) return
    try {
      await sentryApi.disconnect(workspaceUrl)
      await loadStatus()
      toast.success('Sentry disconnected')
    } catch {
      toast.error('Failed to disconnect Sentry')
    }
  }

  if (loading) {
    return (
      <div className='h-32 rounded-xl border border-zinc-200 dark:border-zinc-800 animate-pulse bg-zinc-50 dark:bg-zinc-900' />
    )
  }

  const connected = status?.connected === true

  return (
    <>
      <div className='rounded-xl border border-zinc-200 dark:border-zinc-800 p-5'>
        <div className='flex items-start gap-3'>
          <div className='rounded-lg bg-red-500/10 p-2 text-red-500'>
            <AlertTriangle className='h-5 w-5' />
          </div>
          <div className='flex-1'>
            <h3 className='text-sm font-semibold text-zinc-900 dark:text-zinc-100'>
              Sentry
            </h3>
            <p className='mt-0.5 text-xs text-zinc-500 dark:text-zinc-400'>
              Automatically create tasks from Sentry alerts.
            </p>

            {connected ? (
              <div className='mt-3 text-xs text-zinc-600 dark:text-zinc-300'>
                <div>
                  Connected to{' '}
                  <span className='font-mono'>{status?.orgSlug}</span>
                </div>
                <div className='mt-0.5 text-zinc-500'>
                  {status?.lastWebhookAt
                    ? `Last verified webhook: ${new Date(status.lastWebhookAt).toLocaleString()}`
                    : 'Waiting for first verified webhook'}
                </div>
              </div>
            ) : null}
          </div>

          <div className='flex gap-2'>
            {!connected && isOwner && (
              <button
                className='text-xs px-3 py-1.5 rounded-md bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200'
                onClick={() => setConnectOpen(true)}
              >
                Connect
              </button>
            )}
            {connected && isOwner && (
              <>
                <button
                  className='text-xs px-3 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                  onClick={() => setMappingsOpen(true)}
                >
                  Manage mappings
                </button>
                <button
                  className='text-xs px-3 py-1.5 rounded-md text-red-500 hover:bg-red-500/10'
                  onClick={handleDisconnect}
                >
                  Disconnect
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <SentryConnectDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onConnected={loadStatus}
      />
      <SentryMappingsDialog
        open={mappingsOpen}
        onOpenChange={setMappingsOpen}
      />
    </>
  )
}

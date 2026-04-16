'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Loader2 } from 'lucide-react'
import { sentryApi, type SentryStatus } from '@/lib/api-client/sentry'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { SentryConnectDialog } from './SentryConnectDialog'
import { SentryMappingsDialog } from './SentryMappingsDialog'
import { SentryIcon } from './SentryIcon'
import { IntegrationCard } from './IntegrationCard'

export function SentryIntegrationCard({ isOwner }: { isOwner: boolean }) {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const [status, setStatus] = useState<SentryStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [connectOpen, setConnectOpen] = useState(false)
  const [mappingsOpen, setMappingsOpen] = useState(false)
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceUrl])

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await sentryApi.disconnect(workspaceUrl)
      await loadStatus()
      toast.success('Sentry disconnected')
      setDisconnectOpen(false)
    } catch {
      toast.error('Failed to disconnect Sentry')
    } finally {
      setDisconnecting(false)
    }
  }

  const connected = status?.connected === true

  const headerAction = loading ? (
    <Loader2 size={16} className='animate-spin text-zinc-400' />
  ) : connected ? (
    <span className='flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400'>
      <Check size={12} />
      Connected
    </span>
  ) : isOwner ? (
    <Button size='sm' onClick={() => setConnectOpen(true)}>
      Connect
    </Button>
  ) : null

  return (
    <>
      <IntegrationCard
        icon={<SentryIcon className='h-[18px] w-[18px]' />}
        title='Sentry'
        description='Automatically create tasks from Sentry alerts.'
        headerAction={headerAction}
      >
        {connected ? (
          <>
            <p className='text-xs text-zinc-500 dark:text-zinc-400'>
              Connected to{' '}
              <span className='font-medium text-zinc-700 dark:text-zinc-300 font-mono'>
                {status?.orgSlug}
              </span>
            </p>

            <p className='text-xs text-zinc-400 dark:text-zinc-500'>
              {status?.lastWebhookAt
                ? `Last verified webhook: ${new Date(status.lastWebhookAt).toLocaleString()}`
                : 'Waiting for first verified webhook.'}
            </p>

            {isOwner && (
              <div className='flex items-center justify-between pt-1'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setMappingsOpen(true)}
                >
                  Manage mappings
                </Button>
                <Button
                  variant='ghost'
                  size='sm'
                  className='text-zinc-400 hover:text-destructive'
                  onClick={() => setDisconnectOpen(true)}
                >
                  Disconnect
                </Button>
              </div>
            )}
          </>
        ) : null}
      </IntegrationCard>

      <SentryConnectDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onConnected={loadStatus}
      />
      <SentryMappingsDialog
        open={mappingsOpen}
        onOpenChange={setMappingsOpen}
      />

      {/* Disconnect confirmation */}
      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent size='sm'>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Sentry?</AlertDialogTitle>
            <AlertDialogDescription>
              Existing tasks created from Sentry alerts stay. New alerts
              won&apos;t create tasks until you reconnect.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant='outline'>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? (
                <Loader2 size={14} className='animate-spin' />
              ) : (
                'Disconnect'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

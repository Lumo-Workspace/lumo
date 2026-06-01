'use client'

import { useEffect } from 'react'
import { useIntl } from 'react-intl'
import { Check, Loader2 } from 'lucide-react'
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
import { useSentryIntegration } from '../hooks/useSentryIntegration'

export function SentryIntegrationCard({
  isOwner,
  onConnectedChange,
}: {
  isOwner: boolean
  onConnectedChange?: (connected: boolean) => void
}) {
  const intl = useIntl()
  const {
    status,
    loading,
    connectOpen,
    setConnectOpen,
    mappingsOpen,
    setMappingsOpen,
    disconnectOpen,
    setDisconnectOpen,
    disconnecting,
    handleDisconnect,
    refreshStatus,
  } = useSentryIntegration()

  const connected = status?.connected === true

  useEffect(() => {
    onConnectedChange?.(connected)
  }, [connected, onConnectedChange])

  const headerAction = loading ? (
    <Loader2 size={16} className='animate-spin text-zinc-400' />
  ) : connected ? (
    <span className='flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400'>
      <Check size={12} />
      {intl.formatMessage({ id: 'sentry.connected' })}
    </span>
  ) : isOwner ? (
    <Button size='sm' onClick={() => setConnectOpen(true)}>
      {intl.formatMessage({ id: 'common.connect' })}
    </Button>
  ) : null

  return (
    <>
      <IntegrationCard
        icon={<SentryIcon className='h-[18px] w-[18px]' />}
        title={intl.formatMessage({ id: 'sentry.title' })}
        description={intl.formatMessage({ id: 'sentry.description' })}
        headerAction={headerAction}
        collapsible={connected}
        onDisconnect={
          connected && isOwner ? () => setDisconnectOpen(true) : undefined
        }
        disconnectLabel={intl.formatMessage({ id: 'common.disconnect' })}
      >
        {connected ? (
          <>
            <p className='text-xs text-zinc-500 dark:text-zinc-400'>
              {intl.formatMessage(
                { id: 'sentry.connectedTo' },
                {
                  orgSlug: (
                    <span className='font-medium text-zinc-700 dark:text-zinc-300 font-mono'>
                      {status?.orgSlug}
                    </span>
                  ),
                }
              )}
            </p>

            <p className='text-xs text-zinc-400 dark:text-zinc-500'>
              {status?.lastWebhookAt
                ? intl.formatMessage(
                    { id: 'sentry.lastWebhook' },
                    {
                      time: new Date(status.lastWebhookAt).toLocaleString(
                        intl.locale
                      ),
                    }
                  )
                : intl.formatMessage({ id: 'sentry.waitingWebhook' })}
            </p>

            {isOwner && (
              <div className='flex items-center pt-1'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setMappingsOpen(true)}
                >
                  {intl.formatMessage({ id: 'sentry.manageMappings' })}
                </Button>
              </div>
            )}
          </>
        ) : null}
      </IntegrationCard>

      <SentryConnectDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onConnected={refreshStatus}
      />
      <SentryMappingsDialog
        open={mappingsOpen}
        onOpenChange={setMappingsOpen}
      />

      {/* Disconnect confirmation */}
      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent size='sm'>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({ id: 'sentry.disconnectTitle' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({ id: 'sentry.disconnectDesc' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant='outline'>
              {intl.formatMessage({ id: 'common.cancel' })}
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? (
                <Loader2 size={14} className='animate-spin' />
              ) : (
                intl.formatMessage({ id: 'common.disconnect' })
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

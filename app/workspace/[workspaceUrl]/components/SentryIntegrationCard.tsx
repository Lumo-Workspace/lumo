'use client'

import { useEffect } from 'react'
import { useIntl } from 'react-intl'
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
import { IntegrationCard, ConnectedDot } from './IntegrationCard'
import { useSentryIntegration } from '../hooks/useSentryIntegration'
import { Spinner } from '@/components/ui/spinner'

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
    // LUM-1339: report once the status is known, so the page can tell
    // "nothing connected" from "still loading".
    if (status) onConnectedChange?.(connected)
  }, [status, connected, onConnectedChange])

  const headerAction = loading ? (
    <Spinner className='text-muted-foreground' />
  ) : connected ? (
    <ConnectedDot label={intl.formatMessage({ id: 'sentry.connected' })} />
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
        onReconnect={
          connected && isOwner ? () => setConnectOpen(true) : undefined
        }
        reconnectLabel={intl.formatMessage({ id: 'common.reauthorize' })}
        onDisconnect={
          connected && isOwner ? () => setDisconnectOpen(true) : undefined
        }
        disconnectLabel={intl.formatMessage({ id: 'common.disconnect' })}
        menuLabel={intl.formatMessage({ id: 'common.moreOptions' })}
      >
        {connected ? (
          <>
            <p className='text-caption text-muted-foreground'>
              {intl.formatMessage(
                { id: 'sentry.connectedTo' },
                {
                  orgSlug: (
                    <span className='text-foreground font-mono'>
                      {status?.orgSlug}
                    </span>
                  ),
                }
              )}
            </p>

            <p className='text-caption text-muted-foreground'>
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
                <Spinner className='size-3.5' />
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

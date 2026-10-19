'use client'

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
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
import { GoogleDriveIcon } from './GoogleDriveIcon'
import { IntegrationCard, ConnectedDot } from './IntegrationCard'
import { API } from '../constants'
import { useGoogleDriveIntegration } from '../hooks/useGoogleDriveIntegration'
import { Spinner } from '@/components/ui/spinner'

export function GoogleDriveIntegrationCard({
  onConnectedChange,
}: {
  onConnectedChange?: (connected: boolean) => void
} = {}) {
  const intl = useIntl()
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const {
    status,
    loading,
    disconnectOpen,
    setDisconnectOpen,
    disconnecting,
    handleDisconnect,
  } = useGoogleDriveIntegration()

  const connected = status?.connected === true

  useEffect(() => {
    onConnectedChange?.(connected)
  }, [connected, onConnectedChange])

  const headerAction = loading ? (
    <Spinner className='text-muted-foreground' />
  ) : connected ? (
    <ConnectedDot label={intl.formatMessage({ id: 'googleDrive.connected' })} />
  ) : (
    <Button size='sm' asChild>
      <a href={API.googleDrive.oauth(workspaceUrl)}>
        {intl.formatMessage({ id: 'common.connect' })}
      </a>
    </Button>
  )

  return (
    <>
      <IntegrationCard
        icon={<GoogleDriveIcon className='h-[18px] w-[18px]' />}
        title={intl.formatMessage({ id: 'googleDrive.title' })}
        description={intl.formatMessage({ id: 'googleDrive.description' })}
        headerAction={headerAction}
        collapsible={connected}
        onReconnect={
          connected
            ? () => {
                window.location.href = API.googleDrive.oauth(workspaceUrl)
              }
            : undefined
        }
        reconnectLabel={intl.formatMessage({ id: 'common.reauthorize' })}
        onDisconnect={connected ? () => setDisconnectOpen(true) : undefined}
        disconnectLabel={intl.formatMessage({ id: 'common.disconnect' })}
        menuLabel={intl.formatMessage({ id: 'common.moreOptions' })}
      >
        {connected ? (
          <>
            {status?.email ? (
              <p className='text-caption text-muted-foreground'>
                {intl.formatMessage({ id: 'googleDrive.connectedAs' })}{' '}
                <span className='text-foreground'>{status.email}</span>
              </p>
            ) : null}

            {status?.needsReauth && (
              <p className='text-caption text-danger-text'>
                {intl.formatMessage({ id: 'googleDrive.reauthRequired' })}
              </p>
            )}

            {status?.needsReauth && (
              <div className='flex items-center pt-1'>
                <Button variant='outline' size='sm' asChild>
                  <a href={API.googleDrive.oauth(workspaceUrl)}>
                    {intl.formatMessage({ id: 'googleDrive.reconnect' })}
                  </a>
                </Button>
              </div>
            )}
          </>
        ) : null}
      </IntegrationCard>

      {/* Disconnect confirmation */}
      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent size='sm'>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({ id: 'googleDrive.disconnectTitle' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({ id: 'googleDrive.disconnectDesc' })}
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

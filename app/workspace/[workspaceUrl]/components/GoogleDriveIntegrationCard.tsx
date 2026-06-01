'use client'

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
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
import { GoogleDriveIcon } from './GoogleDriveIcon'
import { IntegrationCard } from './IntegrationCard'
import { API } from '../constants'
import { useGoogleDriveIntegration } from '../hooks/useGoogleDriveIntegration'

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
    <Loader2 size={16} className='animate-spin text-zinc-400' />
  ) : connected ? (
    <span className='flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400'>
      <Check size={12} />
      {intl.formatMessage({ id: 'googleDrive.connected' })}
    </span>
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
        onDisconnect={connected ? () => setDisconnectOpen(true) : undefined}
        disconnectLabel={intl.formatMessage({ id: 'common.disconnect' })}
      >
        {connected ? (
          <>
            {status?.email ? (
              <p className='text-xs text-zinc-500 dark:text-zinc-400'>
                {intl.formatMessage({ id: 'googleDrive.connectedAs' })}{' '}
                <span className='font-medium text-zinc-700 dark:text-zinc-300'>
                  {status.email}
                </span>
              </p>
            ) : null}

            {status?.needsReauth && (
              <p className='text-xs text-destructive'>
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

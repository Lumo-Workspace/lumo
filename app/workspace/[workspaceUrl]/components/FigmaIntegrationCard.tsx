'use client'

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { Loader2 } from 'lucide-react'
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
import { FigmaIcon } from './FigmaIcon'
import { IntegrationCard, ConnectedDot } from './IntegrationCard'
import { API } from '../constants'
import { useFigmaIntegration } from '../hooks/useFigmaIntegration'

export function FigmaIntegrationCard({
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
  } = useFigmaIntegration()

  const connected = status?.connected === true

  useEffect(() => {
    onConnectedChange?.(connected)
  }, [connected, onConnectedChange])

  const headerAction = loading ? (
    <Loader2 size={16} className='animate-spin text-muted-foreground' />
  ) : connected ? (
    <ConnectedDot label={intl.formatMessage({ id: 'figma.connected' })} />
  ) : (
    <Button size='sm' asChild>
      <a href={API.figma.oauth(workspaceUrl)}>
        {intl.formatMessage({ id: 'common.connect' })}
      </a>
    </Button>
  )

  return (
    <>
      <IntegrationCard
        icon={<FigmaIcon className='h-[18px] w-[18px]' />}
        title={intl.formatMessage({ id: 'figma.title' })}
        description={intl.formatMessage({ id: 'figma.description' })}
        headerAction={headerAction}
        collapsible={connected}
        onReconnect={
          connected
            ? () => {
                window.location.href = API.figma.oauth(workspaceUrl)
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
            <p className='text-xs text-muted-foreground'>
              {intl.formatMessage({ id: 'figma.connectedAs' })}{' '}
              <span className='font-medium text-foreground'>
                @{status?.handle}
              </span>
              {status?.email ? ` (${status.email})` : ''}
            </p>

            {status?.needsReauth && (
              <p className='text-xs text-danger-text'>
                {intl.formatMessage({ id: 'figma.reauthRequired' })}
              </p>
            )}

            {status?.needsReauth && (
              <div className='flex items-center pt-1'>
                <Button variant='outline' size='sm' asChild>
                  <a href={API.figma.oauth(workspaceUrl)}>
                    {intl.formatMessage({ id: 'figma.reconnect' })}
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
              {intl.formatMessage({ id: 'figma.disconnectTitle' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({ id: 'figma.disconnectDesc' })}
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

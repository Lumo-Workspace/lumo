'use client'

import { useEffect } from 'react'
import { useIntl } from 'react-intl'
import { SlackIcon } from './SlackIcon'
import { IntegrationCard, ConnectedDot } from './IntegrationCard'
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
import { useSlackIntegration } from '../hooks/useSlackIntegration'
import { Spinner } from '@/components/ui/spinner'

export function SlackIntegrationCard({
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
    disconnectOpen,
    setDisconnectOpen,
    disconnecting,
    handleConnect,
    handleDisconnect,
  } = useSlackIntegration()

  const connected = status?.connected === true

  useEffect(() => {
    // LUM-1339: report once the status is known, so the page can tell
    // "nothing connected" from "still loading".
    if (status) onConnectedChange?.(connected)
  }, [status, connected, onConnectedChange])

  const headerAction = loading ? (
    <Spinner className='text-muted-foreground' />
  ) : status?.connected ? (
    <ConnectedDot label={intl.formatMessage({ id: 'slack.connected' })} />
  ) : isOwner ? (
    <Button size='sm' onClick={handleConnect}>
      {intl.formatMessage({ id: 'common.connect' })}
    </Button>
  ) : null

  return (
    <>
      <IntegrationCard
        icon={<SlackIcon className='h-[18px] w-[18px]' />}
        title={intl.formatMessage({ id: 'slack.title' })}
        description={intl.formatMessage({ id: 'slack.description' })}
        headerAction={headerAction}
        collapsible={connected}
        onReconnect={connected && isOwner ? handleConnect : undefined}
        reconnectLabel={intl.formatMessage({ id: 'common.reauthorize' })}
        onDisconnect={
          connected && isOwner ? () => setDisconnectOpen(true) : undefined
        }
        disconnectLabel={intl.formatMessage({ id: 'common.disconnect' })}
        menuLabel={intl.formatMessage({ id: 'common.moreOptions' })}
      >
        {status?.connected ? (
          <>
            <p className='text-caption text-muted-foreground'>
              {intl.formatMessage(
                { id: 'slack.connectedTo' },
                {
                  teamName: (
                    <span className='text-foreground'>
                      {status.slackTeamName}
                    </span>
                  ),
                }
              )}
            </p>

            <p className='text-caption text-muted-foreground'>
              {intl.formatMessage({ id: 'slack.channelNote' })}
            </p>
          </>
        ) : null}
      </IntegrationCard>

      {/* Disconnect confirmation */}
      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent size='sm'>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({ id: 'slack.disconnectTitle' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({ id: 'slack.disconnectDesc' })}
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

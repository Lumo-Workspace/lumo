'use client'

import { useIntl } from 'react-intl'
import { Check, Loader2 } from 'lucide-react'
import { SlackIcon } from './SlackIcon'
import { IntegrationCard } from './IntegrationCard'
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

export function SlackIntegrationCard({ isOwner }: { isOwner: boolean }) {
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

  const headerAction = loading ? (
    <Loader2 size={16} className='animate-spin text-zinc-400' />
  ) : status?.connected ? (
    <span className='flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400'>
      <Check size={12} />
      {intl.formatMessage({ id: 'slack.connected' })}
    </span>
  ) : isOwner ? (
    <Button size='sm' onClick={handleConnect}>
      {intl.formatMessage({ id: 'slack.connectSlack' })}
    </Button>
  ) : null

  return (
    <>
      <IntegrationCard
        icon={<SlackIcon className='h-[18px] w-[18px]' />}
        title={intl.formatMessage({ id: 'slack.title' })}
        description={intl.formatMessage({ id: 'slack.description' })}
        headerAction={headerAction}
      >
        {status?.connected ? (
          <>
            <p className='text-xs text-zinc-500 dark:text-zinc-400'>
              {intl.formatMessage(
                { id: 'slack.connectedTo' },
                {
                  teamName: (
                    <span className='font-medium text-zinc-700 dark:text-zinc-300'>
                      {status.slackTeamName}
                    </span>
                  ),
                }
              )}
            </p>

            <p className='text-xs text-zinc-400 dark:text-zinc-500'>
              {intl.formatMessage({ id: 'slack.channelNote' })}
            </p>

            {isOwner && (
              <div className='flex items-center justify-end pt-1'>
                <Button
                  variant='ghost'
                  size='sm'
                  className='text-zinc-400 hover:text-destructive'
                  onClick={() => setDisconnectOpen(true)}
                >
                  {intl.formatMessage({ id: 'common.disconnect' })}
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

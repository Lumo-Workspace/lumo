'use client'

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
import { FigmaIcon } from './FigmaIcon'
import { IntegrationCard } from './IntegrationCard'
import { API } from '../constants'
import { useFigmaIntegration } from '../hooks/useFigmaIntegration'

export function FigmaIntegrationCard() {
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

  const headerAction = loading ? (
    <Loader2 size={16} className='animate-spin text-zinc-400' />
  ) : connected ? (
    <span className='flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400'>
      <Check size={12} />
      {intl.formatMessage({ id: 'figma.connected' })}
    </span>
  ) : (
    <Button size='sm' asChild>
      <a href={API.figma.oauth(workspaceUrl)}>
        {intl.formatMessage({ id: 'figma.connectFigma' })}
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
      >
        {connected ? (
          <>
            <p className='text-xs text-zinc-500 dark:text-zinc-400'>
              {intl.formatMessage({ id: 'figma.connectedAs' })}{' '}
              <span className='font-medium text-zinc-700 dark:text-zinc-300'>
                @{status?.handle}
              </span>
              {status?.email ? ` (${status.email})` : ''}
            </p>

            {status?.needsReauth && (
              <p className='text-xs text-destructive'>
                {intl.formatMessage({ id: 'figma.reauthRequired' })}
              </p>
            )}

            <div className='flex items-center justify-between pt-1'>
              {status?.needsReauth && (
                <Button variant='outline' size='sm' asChild>
                  <a href={API.figma.oauth(workspaceUrl)}>
                    {intl.formatMessage({ id: 'figma.reconnect' })}
                  </a>
                </Button>
              )}
              <Button
                variant='ghost'
                size='sm'
                className='text-zinc-400 hover:text-destructive ml-auto'
                onClick={() => setDisconnectOpen(true)}
              >
                {intl.formatMessage({ id: 'common.disconnect' })}
              </Button>
            </div>
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

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
import { GitHubIcon } from './GitHubIcon'
import { IntegrationCard, ConnectedDot } from './IntegrationCard'
import { useGitHubIntegration } from '../hooks/useGitHubIntegration'
import { Spinner } from '@/components/ui/spinner'

/**
 * A member's own GitHub link — a PERSONAL card, like Figma.
 *
 * This grant is identity only: it records which GitHub login belongs to this
 * member so comments arriving from GitHub are attributed to them in Lumo.
 * Nothing repository-shaped runs on it; that is the team-level App
 * installation on the GitHub card.
 */
export function GitHubAccountCard({
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
    handleConnect,
    handleDisconnect,
  } = useGitHubIntegration(workspaceUrl)

  const connected = status?.connected === true

  useEffect(() => {
    onConnectedChange?.(connected)
  }, [connected, onConnectedChange])

  const headerAction = loading ? (
    <Spinner className='text-muted-foreground' />
  ) : connected ? (
    <ConnectedDot
      label={intl.formatMessage({ id: 'githubAccount.connected' })}
    />
  ) : (
    <Button size='sm' onClick={handleConnect}>
      {intl.formatMessage({ id: 'common.connect' })}
    </Button>
  )

  return (
    <>
      <IntegrationCard
        icon={<GitHubIcon className='h-[18px] w-[18px]' />}
        title={intl.formatMessage({ id: 'githubAccount.title' })}
        description={intl.formatMessage({ id: 'githubAccount.description' })}
        headerAction={headerAction}
        collapsible={connected}
        onReconnect={connected ? handleConnect : undefined}
        reconnectLabel={intl.formatMessage({ id: 'common.reauthorize' })}
        onDisconnect={connected ? () => setDisconnectOpen(true) : undefined}
        disconnectLabel={intl.formatMessage({ id: 'common.disconnect' })}
        menuLabel={intl.formatMessage({ id: 'common.moreOptions' })}
      >
        {connected ? (
          <p className='text-caption text-muted-foreground'>
            {intl.formatMessage({ id: 'githubAccount.connectedAs' })}{' '}
            <span className='font-mono text-foreground'>
              @{status?.githubLogin}
            </span>
          </p>
        ) : null}
      </IntegrationCard>

      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent size='sm'>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({ id: 'github.disconnectTitle' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({ id: 'github.disconnectDesc' })}
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

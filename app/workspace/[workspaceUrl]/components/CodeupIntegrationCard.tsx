'use client'

import { useEffect } from 'react'
import { useIntl } from 'react-intl'
import { GitMerge } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
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
import { IntegrationCard, ConnectedDot } from './IntegrationCard'
import { CodeupConnectDialog } from './CodeupConnectDialog'
import { CodeupRepositoriesDialog } from './CodeupRepositoriesDialog'
import { useCodeupIntegration } from '../hooks/useCodeupIntegration'

/**
 * LUM-1315 — the workspace's Codeup connection (dogfood). Rendered only when
 * the server says `codeup-integration` is on for this workspace.
 */
export function CodeupIntegrationCard({
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
    repositoriesOpen,
    setRepositoriesOpen,
    disconnectOpen,
    setDisconnectOpen,
    disconnecting,
    handleDisconnect,
    refreshStatus,
  } = useCodeupIntegration()

  const connected = status?.connected === true
  const repositories = status?.connected ? status.repositories : []

  useEffect(() => {
    onConnectedChange?.(connected)
  }, [connected, onConnectedChange])

  const headerAction = loading ? (
    <Spinner className='text-muted-foreground' />
  ) : connected ? (
    <ConnectedDot label={intl.formatMessage({ id: 'codeup.connected' })} />
  ) : isOwner ? (
    <Button size='sm' onClick={() => setConnectOpen(true)}>
      {intl.formatMessage({ id: 'common.connect' })}
    </Button>
  ) : null

  return (
    <>
      <IntegrationCard
        icon={<GitMerge className='h-[18px] w-[18px]' />}
        title={intl.formatMessage({ id: 'codeup.title' })}
        description={intl.formatMessage({ id: 'codeup.description' })}
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
        {status?.connected ? (
          <>
            <p className='text-caption text-muted-foreground'>
              {intl.formatMessage(
                { id: 'codeup.connectedTo' },
                {
                  organizationId: (
                    <span className='text-foreground font-mono'>
                      {status.organizationId}
                    </span>
                  ),
                }
              )}
            </p>
            {repositories.length === 0 ? (
              <p className='text-caption text-muted-foreground'>
                {intl.formatMessage({ id: 'codeup.noConfirmedRepositories' })}
              </p>
            ) : (
              <ul className='space-y-1' data-testid='codeup-repositories'>
                {repositories.map(repo => (
                  <li
                    key={repo.repositoryId}
                    className='text-caption font-mono text-foreground break-all'
                  >
                    {repo.pathWithNamespace}
                  </li>
                ))}
              </ul>
            )}
            <p
              className='text-caption text-muted-foreground'
              data-testid='codeup-comment-author-hint'
            >
              {intl.formatMessage({ id: 'codeup.commentAuthorHint' })}
            </p>
            {isOwner && (
              <div className='flex items-center pt-1'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setRepositoriesOpen(true)}
                >
                  {intl.formatMessage({ id: 'codeup.chooseRepositories' })}
                </Button>
              </div>
            )}
          </>
        ) : null}
      </IntegrationCard>

      <CodeupConnectDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onConnected={async () => {
          await refreshStatus()
          setRepositoriesOpen(true)
        }}
      />
      <CodeupRepositoriesDialog
        open={repositoriesOpen}
        onOpenChange={setRepositoriesOpen}
        onSaved={refreshStatus}
      />

      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent size='sm'>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({ id: 'codeup.disconnectTitle' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({ id: 'codeup.disconnectDesc' })}
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

'use client'

import { useEffect } from 'react'
import { useIntl } from 'react-intl'
import { GitBranch, Plus, X, Loader2 } from 'lucide-react'
import { GitHubIcon } from './GitHubIcon'
import { IntegrationCard, ConnectedDot } from './IntegrationCard'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { useGitHubIntegration } from '../hooks/useGitHubIntegration'

interface GitHubIntegrationCardProps {
  workspaceUrl: string
  isOwner: boolean
  onConnectedChange?: (connected: boolean) => void
}

export function GitHubIntegrationCard({
  workspaceUrl,
  isOwner,
  onConnectedChange,
}: GitHubIntegrationCardProps) {
  const intl = useIntl()
  const {
    status,
    loading,
    disconnectOpen,
    setDisconnectOpen,
    disconnecting,
    addRepoOpen,
    setAddRepoOpen,
    availableRepos,
    loadingRepos,
    handleConnect,
    handleDisconnect,
    handleRemoveRepo,
    openAddRepo,
    handleAddRepo,
  } = useGitHubIntegration(workspaceUrl)

  const connected = status?.connected === true

  useEffect(() => {
    onConnectedChange?.(connected)
  }, [connected, onConnectedChange])

  const headerAction = loading ? (
    <Loader2 size={16} className='animate-spin text-muted-foreground' />
  ) : status?.connected ? (
    <ConnectedDot label={intl.formatMessage({ id: 'github.connected' })} />
  ) : isOwner ? (
    <Button size='sm' onClick={handleConnect}>
      {intl.formatMessage({ id: 'common.connect' })}
    </Button>
  ) : null

  return (
    <>
      <IntegrationCard
        icon={<GitHubIcon className='h-[18px] w-[18px]' />}
        title={intl.formatMessage({ id: 'github.title' })}
        description={intl.formatMessage({ id: 'github.description' })}
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
            {/* Authorized repos */}
            <div>
              <p className='text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2'>
                {intl.formatMessage({ id: 'github.authorizedRepos' })}
              </p>

              {status.repositories && status.repositories.length > 0 ? (
                <ul className='space-y-1.5'>
                  {status.repositories.map(repo => (
                    <li
                      key={repo}
                      className='flex items-center justify-between px-3 py-2 rounded-lg bg-card border border-border text-sm'
                    >
                      <span className='text-foreground font-mono text-xs'>
                        {repo}
                      </span>
                      {isOwner && (
                        <button
                          onClick={() => handleRemoveRepo(repo)}
                          className='text-muted-foreground hover:text-red-500 transition-colors ml-3 shrink-0'
                          title={intl.formatMessage({
                            id: 'github.removeRepo',
                          })}
                        >
                          <X size={13} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className='text-xs text-muted-foreground italic'>
                  {intl.formatMessage({ id: 'github.noRepos' })}
                </p>
              )}
            </div>

            {isOwner && (
              <div className='flex items-center pt-1'>
                <Button
                  variant='outline'
                  size='sm'
                  className='gap-1.5'
                  onClick={openAddRepo}
                >
                  <Plus size={13} />
                  {intl.formatMessage({ id: 'github.addRepo' })}
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
                <Loader2 size={14} className='animate-spin' />
              ) : (
                intl.formatMessage({ id: 'common.disconnect' })
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add repo dialog */}
      <Dialog open={addRepoOpen} onOpenChange={setAddRepoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {intl.formatMessage({ id: 'github.addRepo' })}
            </DialogTitle>
            <DialogDescription>
              {intl.formatMessage({ id: 'github.addRepoDesc' })}
            </DialogDescription>
          </DialogHeader>

          {loadingRepos ? (
            <div className='flex items-center justify-center py-8'>
              <Loader2 size={20} className='animate-spin text-muted-foreground' />
            </div>
          ) : (
            <ul className='max-h-72 overflow-y-auto space-y-1'>
              {availableRepos
                .filter(r => !status?.repositories?.includes(r.fullName))
                .map(repo => (
                  <li key={repo.fullName}>
                    <button
                      onClick={() => handleAddRepo(repo.fullName)}
                      className='w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted transition-colors text-left'
                    >
                      <GitBranch size={14} className='text-muted-foreground shrink-0' />
                      <span className='text-sm text-foreground font-mono'>
                        {repo.fullName}
                      </span>
                      {repo.private && (
                        <span className='ml-auto text-[10px] px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground'>
                          {intl.formatMessage({ id: 'github.private' })}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              {availableRepos.filter(
                r => !status?.repositories?.includes(r.fullName)
              ).length === 0 && (
                <p className='text-xs text-muted-foreground text-center py-6'>
                  {intl.formatMessage({ id: 'github.allReposAdded' })}
                </p>
              )}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

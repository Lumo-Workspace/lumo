'use client'

import { useIntl } from 'react-intl'
import { GitBranch, Check, Plus, X, Loader2 } from 'lucide-react'
import { GitHubIcon } from './GitHubIcon'
import { IntegrationCard } from './IntegrationCard'
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
}

export function GitHubIntegrationCard({
  workspaceUrl,
  isOwner,
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

  const headerAction = loading ? (
    <Loader2 size={16} className='animate-spin text-zinc-400' />
  ) : status?.connected ? (
    <span className='flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400'>
      <Check size={12} />
      {intl.formatMessage({ id: 'github.connected' })}
    </span>
  ) : isOwner ? (
    <Button size='sm' onClick={handleConnect}>
      {intl.formatMessage({ id: 'github.connectGitHub' })}
    </Button>
  ) : null

  return (
    <>
      <IntegrationCard
        icon={<GitHubIcon className='h-[18px] w-[18px]' />}
        title={intl.formatMessage({ id: 'github.title' })}
        description={intl.formatMessage({ id: 'github.description' })}
        headerAction={headerAction}
      >
        {status?.connected ? (
          <>
            <p className='text-xs text-zinc-500 dark:text-zinc-400'>
              {intl.formatMessage({ id: 'github.connectedAs' })}{' '}
              <a
                href={`https://github.com/${status.githubLogin}`}
                target='_blank'
                rel='noopener noreferrer'
                className='font-medium text-zinc-700 dark:text-zinc-300 hover:underline'
              >
                @{status.githubLogin}
              </a>
            </p>

            {/* Authorized repos */}
            <div>
              <p className='text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2'>
                {intl.formatMessage({ id: 'github.authorizedRepos' })}
              </p>

              {status.repositories && status.repositories.length > 0 ? (
                <ul className='space-y-1.5'>
                  {status.repositories.map(repo => (
                    <li
                      key={repo}
                      className='flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-sm'
                    >
                      <span className='text-zinc-700 dark:text-zinc-300 font-mono text-xs'>
                        {repo}
                      </span>
                      {isOwner && (
                        <button
                          onClick={() => handleRemoveRepo(repo)}
                          className='text-zinc-400 hover:text-red-500 transition-colors ml-3 shrink-0'
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
                <p className='text-xs text-zinc-400 dark:text-zinc-500 italic'>
                  {intl.formatMessage({ id: 'github.noRepos' })}
                </p>
              )}
            </div>

            {isOwner && (
              <div className='flex items-center justify-between pt-1'>
                <Button
                  variant='outline'
                  size='sm'
                  className='gap-1.5'
                  onClick={openAddRepo}
                >
                  <Plus size={13} />
                  {intl.formatMessage({ id: 'github.addRepo' })}
                </Button>
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
              <Loader2 size={20} className='animate-spin text-zinc-400' />
            </div>
          ) : (
            <ul className='max-h-72 overflow-y-auto space-y-1'>
              {availableRepos
                .filter(r => !status?.repositories?.includes(r.fullName))
                .map(repo => (
                  <li key={repo.fullName}>
                    <button
                      onClick={() => handleAddRepo(repo.fullName)}
                      className='w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-left'
                    >
                      <GitBranch size={14} className='text-zinc-400 shrink-0' />
                      <span className='text-sm text-zinc-700 dark:text-zinc-300 font-mono'>
                        {repo.fullName}
                      </span>
                      {repo.private && (
                        <span className='ml-auto text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'>
                          {intl.formatMessage({ id: 'github.private' })}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              {availableRepos.filter(
                r => !status?.repositories?.includes(r.fullName)
              ).length === 0 && (
                <p className='text-xs text-zinc-400 text-center py-6'>
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

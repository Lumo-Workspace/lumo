'use client'

import { useState } from 'react'
import { Github, Check, Plus, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
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
import { API } from '../constants'
import type { GitHubStatus } from './pages/IntegrationsPage'

interface GitHubIntegrationCardProps {
  workspaceUrl: string
  status: GitHubStatus | null
  onStatusChange: (status: GitHubStatus) => void
}

interface GhRepo {
  fullName: string
  name: string
  private: boolean
}

export function GitHubIntegrationCard({
  workspaceUrl,
  status,
  onStatusChange,
}: GitHubIntegrationCardProps) {
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [addRepoOpen, setAddRepoOpen] = useState(false)
  const [availableRepos, setAvailableRepos] = useState<GhRepo[]>([])
  const [loadingRepos, setLoadingRepos] = useState(false)

  const handleConnect = () => {
    window.location.href = API.github.oauth(workspaceUrl)
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      const res = await fetch(
        `${API.github.integration}?workspaceUrl=${workspaceUrl}`,
        {
          method: 'DELETE',
        }
      )
      if (!res.ok) throw new Error()
      onStatusChange({ connected: false })
      toast.success('GitHub disconnected')
    } catch {
      toast.error('Failed to disconnect GitHub')
    } finally {
      setDisconnecting(false)
      setDisconnectOpen(false)
    }
  }

  const handleRemoveRepo = async (repo: string) => {
    if (!status?.repositories) return
    const updated = status.repositories.filter(r => r !== repo)
    try {
      const res = await fetch(
        `${API.github.repos}?workspaceUrl=${workspaceUrl}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repositories: updated }),
        }
      )
      if (!res.ok) throw new Error()
      onStatusChange({ ...status, repositories: updated })
    } catch {
      toast.error('Failed to remove repository')
    }
  }

  const openAddRepo = async () => {
    setAddRepoOpen(true)
    setLoadingRepos(true)
    try {
      const res = await fetch(
        `${API.github.repos}?workspaceUrl=${workspaceUrl}`
      )
      if (!res.ok) throw new Error()
      const data = await res.json()
      setAvailableRepos(data.repos ?? [])
    } catch {
      toast.error('Failed to load repositories')
      setAddRepoOpen(false)
    } finally {
      setLoadingRepos(false)
    }
  }

  const handleAddRepo = async (fullName: string) => {
    if (!status) return
    const current = status.repositories ?? []
    if (current.includes(fullName)) return
    const updated = [...current, fullName]
    try {
      const res = await fetch(
        `${API.github.repos}?workspaceUrl=${workspaceUrl}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repositories: updated }),
        }
      )
      if (!res.ok) throw new Error()
      onStatusChange({ ...status, repositories: updated })
      setAddRepoOpen(false)
      toast.success(`Added ${fullName}`)
    } catch {
      toast.error('Failed to add repository')
    }
  }

  return (
    <>
      <div className='rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden'>
        {/* Header */}
        <div className='flex items-center justify-between px-6 py-5 bg-white dark:bg-zinc-900'>
          <div className='flex items-center gap-3'>
            <div className='size-9 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0'>
              <Github size={18} className='text-zinc-700 dark:text-zinc-300' />
            </div>
            <div>
              <p className='text-sm font-semibold text-zinc-900 dark:text-zinc-100'>
                GitHub
              </p>
              <p className='text-xs text-zinc-500 dark:text-zinc-400'>
                Link repositories to tasks and automate workflows.
              </p>
            </div>
          </div>

          {status?.connected ? (
            <span className='flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400'>
              <Check size={12} />
              Connected
            </span>
          ) : (
            <Button size='sm' onClick={handleConnect}>
              Connect GitHub
            </Button>
          )}
        </div>

        {/* Connected state */}
        {status?.connected && (
          <div className='border-t border-zinc-100 dark:border-zinc-800 px-6 py-5 bg-zinc-50 dark:bg-zinc-900/50 space-y-4'>
            <p className='text-xs text-zinc-500 dark:text-zinc-400'>
              Connected as{' '}
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
                Authorized repositories
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
                      <button
                        onClick={() => handleRemoveRepo(repo)}
                        className='text-zinc-400 hover:text-red-500 transition-colors ml-3 shrink-0'
                        title='Remove repository'
                      >
                        <X size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className='text-xs text-zinc-400 dark:text-zinc-500 italic'>
                  No repositories added yet.
                </p>
              )}
            </div>

            <div className='flex items-center justify-between pt-1'>
              <Button
                variant='outline'
                size='sm'
                className='gap-1.5'
                onClick={openAddRepo}
              >
                <Plus size={13} />
                Add repository
              </Button>
              <Button
                variant='ghost'
                size='sm'
                className='text-zinc-400 hover:text-destructive'
                onClick={() => setDisconnectOpen(true)}
              >
                Disconnect
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Disconnect confirmation */}
      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent size='sm'>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect GitHub?</AlertDialogTitle>
            <AlertDialogDescription>
              Your access token will be deleted. You can reconnect at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant='outline'>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? (
                <Loader2 size={14} className='animate-spin' />
              ) : (
                'Disconnect'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add repo dialog */}
      <Dialog open={addRepoOpen} onOpenChange={setAddRepoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add repository</DialogTitle>
            <DialogDescription>
              Select a repository to authorize for this workspace.
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
                      <Github size={14} className='text-zinc-400 shrink-0' />
                      <span className='text-sm text-zinc-700 dark:text-zinc-300 font-mono'>
                        {repo.fullName}
                      </span>
                      {repo.private && (
                        <span className='ml-auto text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'>
                          private
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              {availableRepos.filter(
                r => !status?.repositories?.includes(r.fullName)
              ).length === 0 && (
                <p className='text-xs text-zinc-400 text-center py-6'>
                  All accessible repositories have been added.
                </p>
              )}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

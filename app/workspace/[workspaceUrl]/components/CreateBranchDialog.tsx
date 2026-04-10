'use client'

import { useState, useEffect, useRef } from 'react'
import { GitBranch, Check, Copy, ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useIntl } from 'react-intl'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { generateBranchName } from '@/lib/integrations/github/branch'
import { API } from '../constants'
import { apiFetch, tasksClient, ApiClientError } from '@/lib/api-client'
import type { ApiTaskBranch } from '../types'

interface CreateBranchDialogProps {
  isOpen: boolean
  onClose: () => void
  taskId: string
  identifier: string // e.g. "ENG-123"
  title: string
  projectId: string
  defaultRepo: string | null | undefined // project default repository fullName
  workspaceUrl: string
  onBranchCreated?: (branch: ApiTaskBranch) => void
}

interface GhRepo {
  fullName: string
  name: string
  private: boolean
}

type DialogState =
  | { phase: 'idle' }
  | { phase: 'loading_repos' }
  | { phase: 'no_repos' }
  | { phase: 'ready'; repos: GhRepo[] }
  | { phase: 'creating' }
  | { phase: 'success'; branchName: string; url: string }
  | { phase: 'error'; message: string }

export function CreateBranchDialog({
  isOpen,
  onClose,
  taskId,
  identifier,
  title,
  projectId: _projectId,
  defaultRepo,
  workspaceUrl,
  onBranchCreated,
}: CreateBranchDialogProps) {
  const intl = useIntl()
  const [state, setState] = useState<DialogState>({ phase: 'idle' })
  const [branchName, setBranchName] = useState('')
  const [selectedRepo, setSelectedRepo] = useState('')
  const [copied, setCopied] = useState(false)
  const reposRef = useRef<GhRepo[]>([])

  // Load repos and initialise form when dialog opens
  useEffect(() => {
    if (!isOpen) {
      setState({ phase: 'idle' })
      setCopied(false)
      return
    }

    setBranchName(generateBranchName(identifier, title))
    setState({ phase: 'loading_repos' })

    const loadRepos = async () => {
      try {
        const data = await apiFetch<{ repos: GhRepo[] }>(
          `${API.github.authorizedRepos}?workspaceUrl=${workspaceUrl}`
        )
        const repos = data.repos ?? []
        if (repos.length === 0) {
          setState({ phase: 'no_repos' })
          return
        }
        // Pre-select: project's saved repo first, else first in list
        const preselect =
          repos.find(r => r.fullName === defaultRepo)?.fullName ??
          repos[0]!.fullName
        setSelectedRepo(preselect)
        reposRef.current = repos
        setState({ phase: 'ready', repos })
      } catch {
        setState({ phase: 'no_repos' })
      }
    }
    loadRepos()
  }, [isOpen, identifier, title, defaultRepo, workspaceUrl])

  const handleCreate = async () => {
    if (state.phase !== 'ready') return
    setState({ phase: 'creating' })

    try {
      const data = await tasksClient.createBranch<{
        branch?: ApiTaskBranch
        branchName: string
        url: string
      }>(taskId, { repo: selectedRepo, branchName })
      if (data.branch) {
        onBranchCreated?.(data.branch)
      }
      setState({ phase: 'success', branchName: data.branchName, url: data.url })
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : 'Network error. Please try again.'
      setState({ phase: 'error', message })
    }
  }

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success(intl.formatMessage({ id: 'task.branchNameCopied' }))
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(intl.formatMessage({ id: 'task.copyFailed' }))
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <GitBranch size={16} />
            Create Branch
          </DialogTitle>
          <DialogDescription>
            Create a GitHub branch linked to this task.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4 py-2'>
          {/* Loading repos */}
          {state.phase === 'loading_repos' && (
            <div className='flex items-center justify-center py-6'>
              <Loader2 size={20} className='animate-spin text-zinc-400' />
            </div>
          )}

          {/* No repos connected */}
          {state.phase === 'no_repos' && (
            <div className='text-center py-4 space-y-2'>
              <p className='text-sm text-zinc-500 dark:text-zinc-400'>
                No GitHub repositories connected.
              </p>
              <a
                href={`/workspace/${workspaceUrl}/settings/integrations`}
                className='text-sm text-blue-600 dark:text-blue-400 hover:underline'
              >
                Connect a repository →
              </a>
            </div>
          )}

          {/* Ready / Creating */}
          {(state.phase === 'ready' || state.phase === 'creating') && (
            <>
              {/* Repo selector */}
              <div className='space-y-1.5'>
                <label className='text-xs font-medium text-zinc-500 dark:text-zinc-400'>
                  Repository
                </label>
                <select
                  value={selectedRepo}
                  onChange={e => setSelectedRepo(e.target.value)}
                  disabled={state.phase === 'creating'}
                  className='w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-400 disabled:opacity-50 font-mono'
                >
                  {state.phase === 'ready' &&
                    state.repos.map(r => (
                      <option key={r.fullName} value={r.fullName}>
                        {r.fullName}
                        {r.private ? ' (private)' : ''}
                      </option>
                    ))}
                </select>
              </div>

              {/* Branch name */}
              <div className='space-y-1.5'>
                <label className='text-xs font-medium text-zinc-500 dark:text-zinc-400'>
                  Branch name
                </label>
                <input
                  type='text'
                  value={branchName}
                  onChange={e => setBranchName(e.target.value)}
                  disabled={state.phase === 'creating'}
                  className='w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-400 disabled:opacity-50'
                  spellCheck={false}
                />
              </div>

              <Button
                className='w-full'
                onClick={handleCreate}
                disabled={
                  state.phase === 'creating' ||
                  !branchName.trim() ||
                  !selectedRepo
                }
              >
                {state.phase === 'creating' ? (
                  <Loader2 size={14} className='animate-spin mr-2' />
                ) : null}
                {state.phase === 'creating'
                  ? intl.formatMessage({ id: 'common.creating' })
                  : intl.formatMessage({ id: 'branch.createBranch' })}
              </Button>
            </>
          )}

          {/* Error */}
          {state.phase === 'error' && (
            <div className='space-y-3'>
              <p className='text-sm text-red-600 dark:text-red-400'>
                {state.message}
              </p>
              <Button
                variant='outline'
                className='w-full'
                onClick={() =>
                  setState({ phase: 'ready', repos: reposRef.current })
                }
              >
                Try again
              </Button>
            </div>
          )}

          {/* Success */}
          {state.phase === 'success' && (
            <div className='space-y-3'>
              <div className='flex items-center gap-2 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2'>
                <Check
                  size={14}
                  className='text-emerald-600 dark:text-emerald-400 shrink-0'
                />
                <span className='text-xs text-emerald-700 dark:text-emerald-300 font-medium'>
                  Branch created
                </span>
              </div>

              <div className='flex items-center gap-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 overflow-hidden'>
                <GitBranch size={13} className='text-zinc-400 shrink-0' />
                <span className='flex-1 min-w-0 text-xs font-mono text-zinc-700 dark:text-zinc-300 truncate'>
                  {state.branchName}
                </span>
                <button
                  onClick={() => handleCopy(state.branchName)}
                  className='text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors shrink-0'
                  title={intl.formatMessage({ id: 'task.copyBranchName' })}
                >
                  {copied ? (
                    <Check size={13} className='text-emerald-500' />
                  ) : (
                    <Copy size={13} />
                  )}
                </button>
              </div>

              <a
                href={state.url}
                target='_blank'
                rel='noopener noreferrer'
                className='flex items-center justify-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors'
              >
                <ExternalLink size={12} />
                View on GitHub
              </a>

              <Button variant='outline' className='w-full' onClick={onClose}>
                Done
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

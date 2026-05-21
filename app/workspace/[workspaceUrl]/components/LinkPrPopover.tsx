'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useIntl } from 'react-intl'
import { Loader2, Link as LinkIcon } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { SectionAddButton } from './TaskDetailTimeline/SectionAddButton'
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
import { tasksClient } from '@/lib/api-client'
import { ApiClientError } from '@/lib/api-client/base'
import type { ApiPullRequestSearchResult } from '../types'
import { PrStateBadge } from './pr-helpers'

const GITHUB_PR_URL_RE = /github\.com\/[^/]+\/[^/]+\/pull\/\d+/

interface ConflictInfo {
  prId?: string
  url?: string
  taskIdentifier: string
  taskTitle: string
}

interface LinkPrPopoverProps {
  taskId: string
  workspaceId: string
  onLinked: () => void
}

export function LinkPrPopover({
  taskId,
  workspaceId,
  onLinked,
}: LinkPrPopoverProps) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ApiPullRequestSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [linking, setLinking] = useState(false)
  const [conflict, setConflict] = useState<ConflictInfo | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const isUrl = GITHUB_PR_URL_RE.test(query.trim())

  // Focus input when popover opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      setQuery('')
      setResults([])
    }
  }, [open])

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = query.trim()
    if (!trimmed || isUrl) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    debounceRef.current = setTimeout(() => {
      tasksClient
        .searchPrs<ApiPullRequestSearchResult[]>(workspaceId, trimmed, 10)
        .then(data => setResults(data))
        .catch(() => setResults([]))
        .finally(() => setLoading(false))
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, workspaceId, isUrl])

  const handleLink = useCallback(
    async (payload: { prId?: string; url?: string; force?: boolean }) => {
      setLinking(true)
      try {
        await tasksClient.linkPr(taskId, payload)
        setOpen(false)
        onLinked()
      } catch (err) {
        if (
          err instanceof ApiClientError &&
          err.status === 409 &&
          (
            err as ApiClientError & {
              conflictTask?: { identifier: string; title: string }
            }
          ).conflictTask
        ) {
          const ct = (
            err as ApiClientError & {
              conflictTask: { identifier: string; title: string }
            }
          ).conflictTask
          setConflict({
            ...(payload.prId !== undefined ? { prId: payload.prId } : {}),
            ...(payload.url !== undefined ? { url: payload.url } : {}),
            taskIdentifier: ct.identifier,
            taskTitle: ct.title,
          })
        }
      } finally {
        setLinking(false)
      }
    },
    [taskId, onLinked]
  )

  const handleForceLink = useCallback(async () => {
    if (!conflict) return
    setConflict(null)
    const forcePayload: { prId?: string; url?: string; force?: boolean } = {
      force: true,
    }
    if (conflict.prId !== undefined) forcePayload.prId = conflict.prId
    if (conflict.url !== undefined) forcePayload.url = conflict.url
    await handleLink(forcePayload)
  }, [conflict, handleLink])

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <SectionAddButton
            label={intl.formatMessage({ id: 'task.linkPullRequest' })}
          />
        </PopoverTrigger>
        <PopoverContent align='end' className='w-80 p-0'>
          <div className='p-2 border-b border-zinc-100 dark:border-zinc-800'>
            <input
              ref={inputRef}
              type='text'
              placeholder='Search PRs or paste GitHub URL...'
              value={query}
              onChange={e => setQuery(e.target.value)}
              className='w-full text-sm bg-transparent outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500 text-zinc-900 dark:text-zinc-100 px-1 py-1'
            />
          </div>

          <div className='max-h-64 overflow-y-auto'>
            {/* URL link button */}
            {isUrl && (
              <button
                onClick={() => handleLink({ url: query.trim() })}
                disabled={linking}
                className='w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50'
              >
                <LinkIcon size={14} className='shrink-0 text-zinc-400' />
                <span className='text-zinc-700 dark:text-zinc-300'>
                  Link PR from URL
                </span>
                {linking && (
                  <Loader2
                    size={12}
                    className='ml-auto animate-spin text-zinc-400'
                  />
                )}
              </button>
            )}

            {/* Loading */}
            {loading && !isUrl && (
              <div className='flex items-center justify-center py-4'>
                <Loader2 size={14} className='animate-spin text-zinc-400' />
              </div>
            )}

            {/* Results */}
            {!loading &&
              !isUrl &&
              results.map(pr => {
                const linkedToOther = pr.task !== null
                return (
                  <button
                    key={pr.id}
                    onClick={() => handleLink({ prId: pr.id })}
                    disabled={linking}
                    className='w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50'
                  >
                    <div className='min-w-0 flex-1'>
                      <div className='flex items-center gap-1.5'>
                        <span className='text-[11px] text-zinc-400 shrink-0'>
                          {pr.repo}
                        </span>
                        <span className='text-xs font-medium text-zinc-700 dark:text-zinc-300'>
                          #{pr.number}
                        </span>
                      </div>
                      <p className='text-xs text-zinc-600 dark:text-zinc-400 truncate mt-0.5'>
                        {pr.title}
                      </p>
                      <div className='flex items-center gap-1.5 mt-1'>
                        <PrStateBadge state={pr.state} />
                        {linkedToOther && (
                          <span className='text-[10px] text-zinc-400'>
                            Linked to {pr.task!.team.identifier}-
                            {pr.task!.number}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}

            {/* Empty state */}
            {!loading && !isUrl && query.trim() && results.length === 0 && (
              <div className='px-3 py-4 text-xs text-zinc-400 text-center'>
                No pull requests found
              </div>
            )}

            {/* Initial state */}
            {!query.trim() && (
              <div className='px-3 py-4 text-xs text-zinc-400 text-center'>
                Type to search pull requests
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Force-link confirmation */}
      <AlertDialog
        open={conflict !== null}
        onOpenChange={dialogOpen => {
          if (!dialogOpen) setConflict(null)
        }}
      >
        <AlertDialogContent className='max-w-sm'>
          <AlertDialogHeader>
            <AlertDialogTitle>PR already linked</AlertDialogTitle>
            <AlertDialogDescription>
              This pull request is currently linked to{' '}
              <span className='font-medium text-zinc-700 dark:text-zinc-300'>
                {conflict?.taskIdentifier}
              </span>{' '}
              ({conflict?.taskTitle}). Do you want to move it to this task?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleForceLink}>
              Move to this task
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

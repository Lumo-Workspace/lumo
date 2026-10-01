'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { Loader2, Link as LinkIcon } from 'lucide-react'
import { toast } from 'sonner'
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
import { PrStateBadge } from './pr-helpers'
import { usePrSearch } from '../hooks/usePrSearch'

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
  const [linking, setLinking] = useState(false)
  const [conflict, setConflict] = useState<ConflictInfo | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const isUrl = GITHUB_PR_URL_RE.test(query.trim())

  // Debounced, cached PR search — the URL case is handled inline below, so it
  // disables searching. Results stay cached across reopen/re-search via the
  // query key + staleTime in usePrSearch.
  const { results, loading } = usePrSearch(workspaceId, query, open && !isUrl)

  // Focus input when popover opens; clear the query when it closes.
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      setQuery('')
    }
  }, [open])

  const handleLink = useCallback(
    async (payload: { prId?: string; url?: string; force?: boolean }) => {
      setLinking(true)
      try {
        const result = await tasksClient.linkPr(taskId, payload)
        setOpen(false)
        onLinked()
        // LUM-929: linking claims the PR, so this task's comments are posted
        // to it on GitHub — say so when another workspace also uses the repo.
        if (result.sharedWithOtherWorkspaces) {
          toast.warning(intl.formatMessage({ id: 'linkPr.sharedRepoWarning' }))
        }
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
    [taskId, onLinked, intl]
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
            label={intl.formatMessage({ id: 'linkPr.title' })}
          />
        </PopoverTrigger>
        <PopoverContent align='end' className='w-80 p-0'>
          <div className='p-2 border-b border-border'>
            <input
              ref={inputRef}
              type='text'
              placeholder={intl.formatMessage({
                id: 'linkPr.searchPlaceholder',
              })}
              value={query}
              onChange={e => setQuery(e.target.value)}
              className='w-full text-sm bg-transparent outline-none placeholder:text-muted-foreground dark:placeholder:text-muted-foreground text-foreground px-1 py-1'
            />
          </div>

          <div className='max-h-64 overflow-y-auto'>
            {/* URL link button */}
            {isUrl && (
              <button
                onClick={() => handleLink({ url: query.trim() })}
                disabled={linking}
                className='w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted transition-colors disabled:opacity-50'
              >
                <LinkIcon
                  size={14}
                  className='shrink-0 text-muted-foreground'
                />
                <span className='text-foreground'>
                  {intl.formatMessage({ id: 'linkPr.linkFromUrl' })}
                </span>
                {linking && (
                  <Loader2
                    size={12}
                    className='ml-auto animate-spin text-muted-foreground'
                  />
                )}
              </button>
            )}

            {/* Loading */}
            {loading && !isUrl && (
              <div className='flex items-center justify-center py-4'>
                <Loader2
                  size={14}
                  className='animate-spin text-muted-foreground'
                />
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
                    className='w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-muted transition-colors disabled:opacity-50'
                  >
                    <div className='min-w-0 flex-1'>
                      <div className='flex items-center gap-1.5'>
                        <span className='text-[11px] text-muted-foreground shrink-0'>
                          {pr.repo}
                        </span>
                        <span className='text-xs font-medium text-foreground'>
                          #{pr.number}
                        </span>
                      </div>
                      <p className='text-xs text-muted-foreground truncate mt-0.5'>
                        {pr.title}
                      </p>
                      <div className='flex items-center gap-1.5 mt-1'>
                        <PrStateBadge state={pr.state} />
                        {linkedToOther && (
                          <span className='text-[10px] text-muted-foreground'>
                            {intl.formatMessage(
                              { id: 'linkPr.linkedTo' },
                              {
                                identifier: `${pr.task!.team.identifier}-${pr.task!.number}`,
                              }
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}

            {/* Empty state */}
            {!loading && !isUrl && query.trim() && results.length === 0 && (
              <div className='px-3 py-4 text-xs text-muted-foreground text-center'>
                {intl.formatMessage({ id: 'linkPr.empty' })}
              </div>
            )}

            {/* Initial state */}
            {!query.trim() && (
              <div className='px-3 py-4 text-xs text-muted-foreground text-center'>
                {intl.formatMessage({ id: 'linkPr.initial' })}
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
            <AlertDialogTitle>
              {intl.formatMessage({ id: 'linkPr.conflictTitle' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <FormattedMessage
                id='linkPr.conflictDesc'
                values={{
                  identifier: conflict?.taskIdentifier ?? '',
                  title: conflict?.taskTitle ?? '',
                  strong: chunks => (
                    <span className='font-medium text-foreground'>
                      {chunks}
                    </span>
                  ),
                }}
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {intl.formatMessage({ id: 'common.cancel' })}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleForceLink}>
              {intl.formatMessage({ id: 'linkPr.moveToThisTask' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

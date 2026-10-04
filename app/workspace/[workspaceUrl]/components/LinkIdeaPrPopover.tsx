'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import Link from 'next/link'
import { Loader2, Link as LinkIcon } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { SectionAddButton } from './TaskDetailTimeline/SectionAddButton'
import { PrStateBadge } from './pr-helpers'
import { usePrSearch } from '../hooks/usePrSearch'

const GITHUB_PR_URL_RE = /github\.com\/[^/]+\/[^/]+\/pull\/\d+/

export interface LinkIdeaPrPopoverProps {
  workspaceId: string | undefined
  onAttach: (payload: { prId?: string; url?: string }) => Promise<void>
  /** Workspace GitHub connection state; `undefined` while unknown. Only an
   * explicit `false` swaps the search UI for the settings pointer. */
  connected?: boolean
  integrationsHref: string
}

/**
 * Cite a GitHub PR as evidence on an idea (LUM-684).
 *
 * Sibling of `LinkPrPopover` (Task variant) and shares its search
 * (`usePrSearch`) and badges, but deliberately not its conflict/force dialog:
 * that exists because linking moves `PullRequest.taskId` away from whichever
 * task holds it, and citing a PR on an idea moves nothing. Search results
 * therefore never render as "already linked" — an idea citing a task's PR is
 * the normal case, not a collision.
 */
export function LinkIdeaPrPopover({
  workspaceId,
  onAttach,
  connected,
  integrationsHref,
}: LinkIdeaPrPopoverProps): React.ReactElement {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [attaching, setAttaching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isUrl = GITHUB_PR_URL_RE.test(query.trim())
  const notConnected = connected === false

  const { results, loading } = usePrSearch(
    workspaceId ?? '',
    query,
    open && !isUrl && !notConnected && !!workspaceId
  )

  const attach = async (payload: { prId?: string; url?: string }) => {
    if (attaching) return
    setAttaching(true)
    setError(null)
    try {
      await onAttach(payload)
      setQuery('')
      setOpen(false)
    } catch (err) {
      // Surface the failure rather than swallowing it (the Task variant drops
      // everything but its 409 on the floor, leaving the popover mutely open).
      setError(
        err instanceof Error && err.message
          ? err.message
          : intl.formatMessage({
              id: 'task.contextLink.common.errors.network',
            })
      )
    } finally {
      setAttaching(false)
    }
  }

  const label = intl.formatMessage({
    id: 'idea.pullRequests.addButton',
    defaultMessage: 'Cite pull request',
  })

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next)
        if (!next) {
          setQuery('')
          setError(null)
        }
      }}
    >
      <PopoverTrigger asChild>
        <SectionAddButton label={label} />
      </PopoverTrigger>
      <PopoverContent align='end' className='w-80 p-0'>
        {notConnected ? (
          <div className='p-3 space-y-2'>
            <p className='text-xs text-muted-foreground'>
              {intl.formatMessage({
                id: 'idea.pullRequests.notConnected',
                defaultMessage: 'GitHub is not connected.',
              })}
            </p>
            <Link
              href={integrationsHref}
              className='inline-block text-xs font-medium text-info-text hover:underline'
            >
              {intl.formatMessage({
                id: 'task.contextLink.github.connectCta',
                defaultMessage: 'Open integrations →',
              })}
            </Link>
          </div>
        ) : (
          <>
            <div className='p-2 border-b border-border'>
              <input
                type='text'
                value={query}
                onChange={e => setQuery(e.target.value)}
                disabled={attaching}
                placeholder={intl.formatMessage({
                  id: 'linkPr.searchPlaceholder',
                })}
                className='w-full text-sm bg-transparent outline-none placeholder:text-muted-foreground dark:placeholder:text-muted-foreground text-foreground px-1 py-1 disabled:opacity-50'
                autoFocus
              />
            </div>

            <div className='max-h-64 overflow-y-auto'>
              {isUrl && (
                <button
                  onClick={() => attach({ url: query.trim() })}
                  disabled={attaching}
                  className='w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted transition-colors disabled:opacity-50'
                >
                  <LinkIcon
                    size={14}
                    className='shrink-0 text-muted-foreground'
                  />
                  <span className='text-foreground'>
                    {intl.formatMessage({ id: 'linkPr.linkFromUrl' })}
                  </span>
                  {attaching && (
                    <Loader2
                      size={12}
                      className='ml-auto animate-spin text-muted-foreground'
                    />
                  )}
                </button>
              )}

              {loading && !isUrl && (
                <div className='flex items-center justify-center py-4'>
                  <Loader2
                    size={14}
                    className='animate-spin text-muted-foreground'
                  />
                </div>
              )}

              {!loading &&
                !isUrl &&
                results.map(pr => (
                  <button
                    key={pr.id}
                    onClick={() => attach({ prId: pr.id })}
                    disabled={attaching}
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
                      </div>
                    </div>
                  </button>
                ))}

              {!loading && !isUrl && query.trim() && results.length === 0 && (
                <div className='px-3 py-4 text-xs text-muted-foreground text-center'>
                  {intl.formatMessage({ id: 'linkPr.empty' })}
                </div>
              )}

              {!isUrl && !query.trim() && (
                <div className='px-3 py-4 text-xs text-muted-foreground text-center'>
                  {intl.formatMessage({ id: 'linkPr.initial' })}
                </div>
              )}
            </div>

            {error && (
              <p role='alert' className='px-3 py-2 text-xs text-danger-text'>
                {error}
              </p>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

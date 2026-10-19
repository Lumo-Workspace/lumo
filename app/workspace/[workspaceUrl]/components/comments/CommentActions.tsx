'use client'

import { useIntl } from 'react-intl'
import { Link as LinkIcon, Pencil, Reply, Trash2 } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Spinner } from '@/components/ui/spinner'

interface Props {
  /** Whether the current user authored this comment — gates edit/delete buttons. */
  isAuthor: boolean
  isDeleting: boolean
  onCopyLink: () => void
  onReply: () => void
  onEdit: () => void
  onRequestDelete: () => void
}

/**
 * The 4-button hover row (copy link / reply / edit / delete) shown on every
 * comment and reply. Edit + delete only render when `isAuthor` is true.
 *
 * Caller is responsible for visibility (`opacity-0 group-hover:opacity-100`)
 * — different layouts use slightly different spacing classes around the row.
 */
export function CommentActions({
  isAuthor,
  isDeleting,
  onCopyLink,
  onReply,
  onEdit,
  onRequestDelete,
}: Props) {
  const intl = useIntl()
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className='size-6 flex items-center justify-center rounded-sm hover:bg-muted text-muted-foreground hover:text-foreground transition-colors'
            onClick={onCopyLink}
          >
            <LinkIcon size={12} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Copy link</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className='size-6 flex items-center justify-center rounded-sm hover:bg-muted text-muted-foreground hover:text-foreground transition-colors'
            onClick={onReply}
          >
            <Reply size={12} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Reply</TooltipContent>
      </Tooltip>
      {isAuthor && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className='size-6 flex items-center justify-center rounded-sm hover:bg-muted text-muted-foreground hover:text-foreground transition-colors'
                onClick={onEdit}
              >
                <Pencil size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {intl.formatMessage({ id: 'common.edit' })}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className='size-6 flex items-center justify-center rounded-sm hover:bg-muted text-muted-foreground hover:text-danger-text transition-colors disabled:opacity-40'
                disabled={isDeleting}
                onClick={onRequestDelete}
              >
                {isDeleting ? (
                  <Spinner className='size-3 text-muted-foreground' />
                ) : (
                  <Trash2 size={12} />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {intl.formatMessage({ id: 'common.delete' })}
            </TooltipContent>
          </Tooltip>
        </>
      )}
    </>
  )
}

'use client'
import { useState } from 'react'
import { useIntl } from 'react-intl'
import { ChevronRight } from 'lucide-react'
import type { ApiDocumentComment } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'
import type { WorkspaceMemberInfo } from '@/app/workspace/[workspaceUrl]/types'
import { DocumentCommentThread } from './DocumentCommentThread'

export interface CommentResolvedSectionProps {
  /** Full comment list — the section filters to RESOLVED itself. */
  comments: ApiDocumentComment[]
  members: WorkspaceMemberInfo[]
  currentActorId: string | null
  activeCommentId: string | null
  onReply: (parentId: string, body: string) => void
  onEdit: (id: string, body: string) => void
  onDelete: (id: string) => void
  onSetStatus: (id: string, status: 'OPEN' | 'RESOLVED') => void
  onSelectThread: (id: string) => void
}

/**
 * Collapsible "Resolved (N)" area for the comment rail / sheet. Resolved threads
 * are hidden from the anchored gutter (they have no live position), but kept
 * reachable here — expand to review or reopen them. Collapsed by default so the
 * rail stays focused on open threads.
 */
export function CommentResolvedSection(props: CommentResolvedSectionProps) {
  const intl = useIntl()
  const [expanded, setExpanded] = useState(false)
  const resolved = props.comments.filter(c => c.status === 'RESOLVED')
  if (resolved.length === 0) return null

  return (
    <div className='mt-2 border-t pt-2'>
      <button
        type='button'
        data-testid='resolved-section-toggle'
        aria-expanded={expanded}
        onClick={() => setExpanded(v => !v)}
        className='flex w-full items-center gap-1.5 text-caption text-muted-foreground transition-colors hover:text-foreground'
      >
        <ChevronRight
          className={`size-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <span>
          {intl.formatMessage({ id: 'document.showResolved' })} (
          {resolved.length})
        </span>
      </button>
      {expanded && (
        <div className='mt-2 flex flex-col gap-2'>
          {resolved.map(c => (
            <DocumentCommentThread
              key={c.id}
              thread={c}
              members={props.members}
              agentActors={[]}
              currentActorId={props.currentActorId}
              onReply={props.onReply}
              onEdit={props.onEdit}
              onDelete={props.onDelete}
              onSetStatus={props.onSetStatus}
              onSelect={props.onSelectThread}
              active={props.activeCommentId === c.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}

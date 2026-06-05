'use client'
import { useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import type { ApiDocumentComment } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'
import { DocumentCommentThread } from '@/app/workspace/[workspaceUrl]/components/document/comments/DocumentCommentThread'
import { type AgentActorInfo } from '@/app/workspace/[workspaceUrl]/components/comment-utils'
import type { WorkspaceMemberInfo } from '@/app/workspace/[workspaceUrl]/types'

export interface DocumentCommentsSidebarProps {
  comments: ApiDocumentComment[]
  members: WorkspaceMemberInfo[]
  agentActors: AgentActorInfo[]
  currentActorId: string | null | undefined
  onReply: (parentId: string, body: string) => void
  onEdit: (id: string, body: string) => void
  onDelete: (id: string) => void
  onSetStatus: (id: string, status: 'OPEN' | 'RESOLVED') => void
  onSelectThread: (id: string) => void
  /** The id of the currently active comment thread (editor click or sidebar highlight). */
  activeCommentId?: string | null
}

export function DocumentCommentsSidebar(props: DocumentCommentsSidebarProps) {
  const intl = useIntl()
  const [showResolved, setShowResolved] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!props.activeCommentId) return
    containerRef.current
      ?.querySelector(`[data-comment-thread="${props.activeCommentId}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [props.activeCommentId])

  if (props.comments.length === 0) {
    return (
      <div className='p-3 text-sm text-muted-foreground'>
        {intl.formatMessage({ id: 'document.noComments' })}
      </div>
    )
  }

  const visible = showResolved
    ? props.comments
    : props.comments.filter(c => c.status !== 'RESOLVED')

  return (
    <div ref={containerRef} className='flex flex-col gap-2 p-2'>
      <button
        type='button'
        data-testid='show-resolved-toggle'
        onClick={() => setShowResolved(v => !v)}
        className='self-start text-xs text-muted-foreground underline-offset-2 hover:underline'
      >
        {intl.formatMessage({ id: 'document.showResolved' })}
      </button>
      {visible.map(c => (
        <DocumentCommentThread
          key={c.id}
          thread={c}
          members={props.members}
          agentActors={props.agentActors}
          currentActorId={props.currentActorId}
          onReply={props.onReply}
          onEdit={props.onEdit}
          onDelete={props.onDelete}
          onSetStatus={props.onSetStatus}
          onSelect={props.onSelectThread}
          active={c.id === props.activeCommentId}
        />
      ))}
    </div>
  )
}

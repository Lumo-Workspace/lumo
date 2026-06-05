'use client'
import type { Editor } from '@tiptap/core'
import type { ApiDocumentComment } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'
import type { WorkspaceMemberInfo } from '@/app/workspace/[workspaceUrl]/types'
import { DocumentCommentThread } from './DocumentCommentThread'
import { NewCommentPopover } from './NewCommentPopover'
import { useCommentGutterLayout, PENDING_ID } from './useCommentGutterLayout'

export interface PendingComment {
  from: number
  to: number
  quotedText: string
}

export interface CommentGutterProps {
  editor: Editor | null
  /** The flex-row element both the editor and gutter sit in (positioning origin). */
  rowEl: HTMLElement | null
  comments: ApiDocumentComment[]
  members: WorkspaceMemberInfo[]
  currentActorId: string | null
  pending: PendingComment | null
  activeCommentId: string | null
  onReply: (parentId: string, body: string) => void
  onEdit: (id: string, body: string) => void
  onDelete: (id: string) => void
  onSetStatus: (id: string, status: 'OPEN' | 'RESOLVED') => void
  onSelectThread: (id: string) => void
  onSubmitPending: (body: string) => void
  onCancelPending: () => void
}

export function CommentGutter(props: CommentGutterProps) {
  const open = props.comments.filter(c => c.status === 'OPEN')
  const { tops, height } = useCommentGutterLayout(
    props.editor,
    props.rowEl,
    props.comments,
    props.pending ? props.pending.from : null
  )

  return (
    <div className='relative w-full' style={{ height }}>
      {open.map(c => (
        <div
          key={c.id}
          data-testid={`gutter-pos-${c.id}`}
          className='absolute left-0 right-0'
          style={{ top: tops[c.id] ?? 0 }}
        >
          <DocumentCommentThread
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
        </div>
      ))}
      {props.pending && (
        <div
          data-testid='gutter-pos-pending'
          className='absolute left-0 right-0'
          style={{ top: tops[PENDING_ID] ?? 0 }}
        >
          <NewCommentPopover
            open
            quotedText={props.pending.quotedText}
            members={props.members}
            onCancel={props.onCancelPending}
            onSubmit={props.onSubmitPending}
          />
        </div>
      )}
    </div>
  )
}

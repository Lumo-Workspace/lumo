'use client'
import { useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import type { ApiDocumentComment } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'
import { CommentAvatar } from '@/app/workspace/[workspaceUrl]/components/CommentAvatar'
import {
  resolveCommentAuthor,
  type AgentActorInfo,
} from '@/app/workspace/[workspaceUrl]/components/comment-utils'
import { CommentEditor } from '@/app/workspace/[workspaceUrl]/components/comments/CommentEditor'
import { Button } from '@/components/ui/button'
import type { WorkspaceMemberInfo } from '@/app/workspace/[workspaceUrl]/types'

export interface DocumentCommentThreadProps {
  thread: ApiDocumentComment
  members: WorkspaceMemberInfo[]
  agentActors: AgentActorInfo[]
  currentActorId: string | null | undefined
  onReply: (parentId: string, body: string) => void
  onEdit: (commentId: string, body: string) => void
  onDelete: (commentId: string) => void
  onSetStatus: (commentId: string, status: 'OPEN' | 'RESOLVED') => void
  onSelect: (commentId: string) => void
}

function Row({
  c,
  members,
  agentActors,
  currentActorId,
  onEdit,
  onDelete,
}: {
  c: ApiDocumentComment
  members: WorkspaceMemberInfo[]
  agentActors: AgentActorInfo[]
  currentActorId: string | null | undefined
  onEdit: (id: string, body: string) => void
  onDelete: (id: string) => void
}) {
  const intl = useIntl()
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const editRef = useRef<string | null>(null)
  const clearRef = useRef<(() => void) | null>(null)
  const author = resolveCommentAuthor(c, members, agentActors)
  const isAuthor = !!currentActorId && c.authorActorId === currentActorId
  const memberProp = members.length ? { members } : {}
  return (
    <div className='py-1'>
      <div className='flex items-start gap-2'>
        <CommentAvatar
          isAgent={author.isAgent}
          imageUrl={author.imageUrl}
          initials={author.initials}
          size='sm'
        />
        {editing ? (
          <div className='flex-1'>
            <CommentEditor
              onCommit={h => {
                editRef.current = h
              }}
              onSubmit={() => {
                const b = editRef.current?.trim()
                if (b) {
                  onEdit(c.id, b)
                  setEditing(false)
                }
              }}
              clearRef={clearRef}
              {...memberProp}
            />
          </div>
        ) : (
          <div
            className='prose-sm text-sm'
            dangerouslySetInnerHTML={{ __html: c.body }}
          />
        )}
      </div>
      {isAuthor && !editing && (
        <div className='mt-0.5 flex gap-2 text-xs text-muted-foreground'>
          {confirmingDelete ? (
            <>
              <button
                type='button'
                data-testid={`confirm-delete-${c.id}`}
                onClick={() => onDelete(c.id)}
              >
                {intl.formatMessage({ id: 'common.confirm' })}
              </button>
              <button
                type='button'
                data-testid={`cancel-delete-${c.id}`}
                onClick={() => setConfirmingDelete(false)}
              >
                {intl.formatMessage({ id: 'common.cancel' })}
              </button>
            </>
          ) : (
            <>
              <button
                type='button'
                data-testid={`edit-${c.id}`}
                onClick={() => setEditing(true)}
              >
                {intl.formatMessage({ id: 'common.edit' })}
              </button>
              <button
                type='button'
                data-testid={`delete-${c.id}`}
                onClick={() => setConfirmingDelete(true)}
              >
                {intl.formatMessage({ id: 'common.delete' })}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function DocumentCommentThread(props: DocumentCommentThreadProps) {
  const intl = useIntl()
  const { thread } = props
  const [replying, setReplying] = useState(false)
  const replyRef = useRef<string | null>(null)
  const replyClearRef = useRef<(() => void) | null>(null)
  const resolved = thread.status === 'RESOLVED'
  const memberProp = props.members.length ? { members: props.members } : {}

  const submitReply = () => {
    const b = replyRef.current?.trim()
    if (b) {
      props.onReply(thread.id, b)
      setReplying(false)
    }
  }

  return (
    <div className={`rounded-md border p-2 ${resolved ? 'opacity-60' : ''}`}>
      <button
        type='button'
        onClick={() => props.onSelect(thread.id)}
        className='mb-1 block w-full text-left'
      >
        {thread.isOrphaned ? (
          <div className='text-xs italic text-muted-foreground'>
            {intl.formatMessage({ id: 'document.commentOrphaned' })}
          </div>
        ) : thread.quotedText ? (
          <div className='line-clamp-2 border-l-2 border-primary/50 pl-2 text-xs text-muted-foreground'>
            {thread.quotedText}
          </div>
        ) : null}
      </button>

      <Row
        c={thread}
        members={props.members}
        agentActors={props.agentActors}
        currentActorId={props.currentActorId}
        onEdit={props.onEdit}
        onDelete={props.onDelete}
      />

      {(thread.replies ?? []).map(rep => (
        <div key={rep.id} className='ml-4 border-l pl-2'>
          <Row
            c={rep}
            members={props.members}
            agentActors={props.agentActors}
            currentActorId={props.currentActorId}
            onEdit={props.onEdit}
            onDelete={props.onDelete}
          />
        </div>
      ))}

      <div className='mt-1 flex items-center gap-2 text-xs'>
        <button
          type='button'
          data-testid='reply-btn'
          onClick={() => setReplying(v => !v)}
          className='text-muted-foreground'
        >
          {intl.formatMessage({ id: 'document.reply' })}
        </button>
        <button
          type='button'
          data-testid='resolve-toggle'
          onClick={() =>
            props.onSetStatus(thread.id, resolved ? 'OPEN' : 'RESOLVED')
          }
          className='text-muted-foreground'
        >
          {intl.formatMessage({
            id: resolved ? 'document.reopen' : 'document.resolve',
          })}
        </button>
      </div>

      {replying && (
        <div className='mt-1'>
          <CommentEditor
            onCommit={h => {
              replyRef.current = h
            }}
            onSubmit={submitReply}
            clearRef={replyClearRef}
            {...memberProp}
          />
          <div className='mt-1 flex justify-end'>
            <Button size='sm' data-testid='reply-submit' onClick={submitReply}>
              {intl.formatMessage({ id: 'document.reply' })}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

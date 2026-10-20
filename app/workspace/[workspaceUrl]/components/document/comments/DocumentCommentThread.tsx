'use client'
import { useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import { Check, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { ApiDocumentComment } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'
import { CommentAvatar } from '@/app/workspace/[workspaceUrl]/components/CommentAvatar'
import {
  resolveCommentAuthor,
  type AgentActorInfo,
} from '@/app/workspace/[workspaceUrl]/components/comment-utils'
import { CommentEditor } from '@/app/workspace/[workspaceUrl]/components/comments/CommentEditor'
import { CommentEditMode } from '@/app/workspace/[workspaceUrl]/components/comments/CommentEditMode'
import { useFormatDate } from '@/app/workspace/[workspaceUrl]/hooks/useFormatDate'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { WorkspaceMemberInfo } from '@/app/workspace/[workspaceUrl]/types'
import { useMentionSources } from '@/app/workspace/[workspaceUrl]/hooks/useMentionSources'
import type { MentionSources } from '@/types/mention'
import { RichHtml } from '@/components/RichHtml'

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
  /** When true, highlights this thread as the currently selected comment. */
  active?: boolean
}

function Row({
  c,
  members,
  agentActors,
  mentionSources,
  currentActorId,
  onEdit,
  onDelete,
}: {
  c: ApiDocumentComment
  members: WorkspaceMemberInfo[]
  agentActors: AgentActorInfo[]
  mentionSources?: MentionSources
  currentActorId: string | null | undefined
  onEdit: (id: string, body: string) => void
  onDelete: (id: string) => void
}) {
  const intl = useIntl()
  const { fmtTimestamp } = useFormatDate()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const author = resolveCommentAuthor(
    c,
    members,
    agentActors,
    intl.formatMessage({ id: 'comment.unknownAuthor' })
  )
  const isDeleted = !!c.deletedAt
  const isAuthor =
    !isDeleted && !!currentActorId && c.authorActorId === currentActorId

  const startEditing = () => {
    setDraft(c.body)
    setEditing(true)
  }
  const cancelEditing = () => {
    setEditing(false)
    setDraft(null)
  }
  const saveEditing = () => {
    const b = draft?.trim()
    if (b) onEdit(c.id, b)
    cancelEditing()
  }

  return (
    <div className='py-1'>
      <div className='flex items-start gap-2'>
        <CommentAvatar
          isAgent={author.isAgent}
          imageUrl={author.imageUrl}
          name={author.name}
          size='sm'
        />
        <div className='min-w-0 flex-1'>
          <div className='flex items-baseline gap-2'>
            <span className='truncate text-caption font-semibold text-foreground'>
              {author.name}
            </span>
            <span className='shrink-0 text-caption text-muted-foreground'>
              {fmtTimestamp(c.createdAt)}
            </span>
          </div>
          {isDeleted ? (
            <div className='mt-0.5 text-body italic text-muted-foreground'>
              {intl.formatMessage({ id: 'document.commentDeleted' })}
            </div>
          ) : editing ? (
            <div className='mt-1'>
              <CommentEditMode
                editorKey={`edit-${c.id}`}
                initialBody={c.body}
                draftBody={draft}
                saving={false}
                placeholderId='task.editCommentPlaceholder'
                {...(mentionSources ? { mentionSources } : {})}
                confirmLabelId='common.confirm'
                onChange={setDraft}
                onSave={saveEditing}
                onCancel={cancelEditing}
              />
            </div>
          ) : (
            <RichHtml className='prose-sm mt-0.5 text-body' html={c.body} />
          )}
          {confirmingDelete && !editing && !isDeleted && (
            <div className='mt-1 flex items-center gap-3 text-caption'>
              <button
                type='button'
                data-testid={`confirm-delete-${c.id}`}
                className='text-danger-text'
                onClick={() => onDelete(c.id)}
              >
                {intl.formatMessage({ id: 'common.confirm' })}
              </button>
              <button
                type='button'
                data-testid={`cancel-delete-${c.id}`}
                className='text-muted-foreground'
                onClick={() => setConfirmingDelete(false)}
              >
                {intl.formatMessage({ id: 'common.cancel' })}
              </button>
            </div>
          )}
        </div>
        {isAuthor && !editing && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type='button'
                data-testid={`comment-menu-${c.id}`}
                aria-label={intl.formatMessage({ id: 'common.moreActions' })}
                className='flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
              >
                <MoreHorizontal className='size-4' />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='end'
              className='min-w-[7rem]'
              // Edit swaps the row for the editor: don't pull focus back to the
              // (now unmounted) trigger.
              onCloseAutoFocus={e => e.preventDefault()}
            >
              <DropdownMenuItem
                data-testid={`edit-${c.id}`}
                onSelect={startEditing}
                className='text-caption [&>svg]:size-3.5'
              >
                <Pencil />
                {intl.formatMessage({ id: 'common.edit' })}
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid={`delete-${c.id}`}
                onSelect={() => setConfirmingDelete(true)}
                className='text-caption text-danger-text focus:text-danger-text [&>svg]:size-3.5'
              >
                <Trash2 />
                {intl.formatMessage({ id: 'common.delete' })}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
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
  const mentionSources = useMentionSources(props.members)

  const submitReply = () => {
    const b = replyRef.current?.trim()
    if (b) {
      props.onReply(thread.id, b)
      setReplying(false)
    }
  }

  return (
    <div
      data-comment-thread={thread.id}
      className={`rounded-md border p-2.5 ${resolved ? 'opacity-60' : ''} ${props.active ? 'ring-1 ring-primary' : ''}`}
    >
      <button
        type='button'
        onClick={() => props.onSelect(thread.id)}
        className='mb-1.5 block w-full text-left'
      >
        {thread.isOrphaned ? (
          <div className='text-caption italic text-muted-foreground'>
            {intl.formatMessage({ id: 'document.commentOrphaned' })}
          </div>
        ) : thread.quotedText ? (
          <div className='line-clamp-2 border-l-2 border-primary/50 pl-2 text-caption text-muted-foreground'>
            {thread.quotedText}
          </div>
        ) : null}
      </button>

      <Row
        c={thread}
        members={props.members}
        agentActors={props.agentActors}
        mentionSources={mentionSources}
        currentActorId={props.currentActorId}
        onEdit={props.onEdit}
        onDelete={props.onDelete}
      />

      {(thread.replies ?? []).map(rep => (
        <div key={rep.id} className='ml-3 border-l pl-2'>
          <Row
            c={rep}
            members={props.members}
            agentActors={props.agentActors}
            mentionSources={mentionSources}
            currentActorId={props.currentActorId}
            onEdit={props.onEdit}
            onDelete={props.onDelete}
          />
        </div>
      ))}

      <div className='mt-2 flex items-center gap-3 border-t pt-2 text-caption'>
        {!replying && (
          <button
            type='button'
            data-testid='reply-btn'
            onClick={() => setReplying(true)}
            className='text-muted-foreground transition-colors hover:text-foreground'
          >
            {intl.formatMessage({ id: 'document.reply' })}
          </button>
        )}
        <button
          type='button'
          data-testid='resolve-toggle'
          onClick={() =>
            props.onSetStatus(thread.id, resolved ? 'OPEN' : 'RESOLVED')
          }
          className='ml-auto inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-foreground transition-colors hover:bg-accent'
        >
          <Check className='size-3.5' />
          {intl.formatMessage({
            id: resolved ? 'document.reopen' : 'document.resolve',
          })}
        </button>
      </div>

      {replying && (
        <div className='mt-2'>
          <CommentEditor
            onCommit={h => {
              replyRef.current = h
            }}
            onSubmit={submitReply}
            clearRef={replyClearRef}
            placeholderId='task.replyPlaceholder'
            mentionSources={mentionSources}
          />
          <div className='mt-1 flex items-center justify-end gap-2'>
            <Button
              size='sm'
              variant='ghost'
              data-testid='reply-cancel'
              onClick={() => setReplying(false)}
            >
              {intl.formatMessage({ id: 'common.cancel' })}
            </Button>
            <Button size='sm' data-testid='reply-submit' onClick={submitReply}>
              {intl.formatMessage({ id: 'document.reply' })}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

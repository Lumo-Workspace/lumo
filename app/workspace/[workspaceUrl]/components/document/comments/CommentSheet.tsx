'use client'
import { useIntl } from 'react-intl'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { ApiDocumentComment } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'
import type { WorkspaceMemberInfo } from '@/app/workspace/[workspaceUrl]/types'
import { DocumentCommentThread } from './DocumentCommentThread'
import { CommentResolvedSection } from './CommentResolvedSection'

export interface CommentSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  comments: ApiDocumentComment[]
  members: WorkspaceMemberInfo[]
  currentActorId: string | null
  activeCommentId?: string | null
  onReply: (parentId: string, body: string) => void
  onEdit: (id: string, body: string) => void
  onDelete: (id: string) => void
  onSetStatus: (id: string, status: 'OPEN' | 'RESOLVED') => void
  onSelectThread: (id: string) => void
}

/**
 * Narrow-screen fallback for the comment gutter. Below the `xl` breakpoint the
 * Google-Docs margin rail is hidden, so existing threads would be unreachable;
 * this drawer lists the OPEN threads in a side Sheet, reusing the same thread
 * component as the gutter.
 */
export function CommentSheet(props: CommentSheetProps) {
  const intl = useIntl()
  const open = props.comments.filter(c => c.status === 'OPEN')

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent side='right' className='w-[88vw] max-w-sm overflow-y-auto'>
        <SheetHeader>
          <SheetTitle>
            {intl.formatMessage({ id: 'document.comments' })}
          </SheetTitle>
        </SheetHeader>
        {props.comments.length === 0 ? (
          <p className='mt-4 text-body text-muted-foreground'>
            {intl.formatMessage({ id: 'document.noComments' })}
          </p>
        ) : (
          <>
            {open.length > 0 && (
              <div className='mt-4 flex flex-col gap-2'>
                {open.map(c => (
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
            <CommentResolvedSection
              comments={props.comments}
              members={props.members}
              currentActorId={props.currentActorId}
              activeCommentId={props.activeCommentId ?? null}
              onReply={props.onReply}
              onEdit={props.onEdit}
              onDelete={props.onDelete}
              onSetStatus={props.onSetStatus}
              onSelectThread={props.onSelectThread}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

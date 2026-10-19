'use client'
import { useRef } from 'react'
import { useIntl } from 'react-intl'
import { CommentEditor } from '@/app/workspace/[workspaceUrl]/components/comments/CommentEditor'
import { Button } from '@/components/ui/button'
import type { WorkspaceMemberInfo } from '@/app/workspace/[workspaceUrl]/types'

export interface NewCommentPopoverProps {
  open: boolean
  quotedText: string
  members?: WorkspaceMemberInfo[] | undefined
  onCancel: () => void
  onSubmit: (body: string) => void
}

export function NewCommentPopover(props: NewCommentPopoverProps) {
  const intl = useIntl()
  const bodyRef = useRef<string | null>(null)
  const clearRef = useRef<(() => void) | null>(null)
  if (!props.open) return null
  const submit = () => {
    const body = bodyRef.current?.trim()
    if (body) props.onSubmit(body)
  }
  return (
    <div
      role='dialog'
      className='w-full rounded-md border bg-popover p-2 shadow-elevation-2'
    >
      <div className='mb-1 line-clamp-2 text-caption text-muted-foreground'>
        &quot;{props.quotedText}&quot;
      </div>
      <CommentEditor
        onCommit={html => (bodyRef.current = html)}
        onSubmit={submit}
        clearRef={clearRef}
        {...(props.members ? { members: props.members } : {})}
      />
      <div className='mt-2 flex justify-end gap-2'>
        <Button variant='ghost' size='sm' onClick={props.onCancel}>
          {intl.formatMessage({ id: 'common.cancel' })}
        </Button>
        <Button size='sm' onClick={submit} data-testid='submit-comment'>
          {intl.formatMessage({ id: 'editor.comment' })}
        </Button>
      </div>
    </div>
  )
}

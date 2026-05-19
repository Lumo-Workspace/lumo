'use client'

import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { DescriptionEditor } from '../DescriptionEditor'
import type { ApiTask, WorkspaceMemberInfo } from '../../types'

interface Props {
  /** Stable React key — caller uses `edit-${id}` so toggling between rows
   * forces a fresh editor instance instead of reusing state across IDs. */
  editorKey: string
  initialBody: string
  /** Current draft body — drives the Save button's disabled state. */
  draftBody: string | null
  saving: boolean
  placeholderId: 'task.editCommentPlaceholder' | 'task.editReplyPlaceholder'
  mentionableMembers: WorkspaceMemberInfo[]
  tasks?: ApiTask[] | undefined
  agentActors?: { actorId: string; name: string; avatarColor: string }[]
  onChange: (html: string | null) => void
  onSave: () => void
  onCancel: () => void
}

/**
 * Inline edit-mode block: a `DescriptionEditor` plus Cancel / Save buttons.
 * Used by both top-level comments and replies — the only thing that differs
 * between them is the editor key and placeholder copy.
 *
 * Cmd/Ctrl+Enter triggers Save; Escape cancels. Both are wired here so the
 * caller doesn't have to repeat the keyboard handler.
 */
export function CommentEditMode({
  editorKey,
  initialBody,
  draftBody,
  saving,
  placeholderId,
  mentionableMembers,
  tasks,
  agentActors,
  onChange,
  onSave,
  onCancel,
}: Props) {
  const intl = useIntl()
  return (
    <div className='border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-zinc-400 transition-all'>
      <div
        className='px-3 pt-2 pb-1 text-sm'
        onKeyDown={e => {
          const isMac = /Mac|iPhone|iPad/i.test(navigator.platform)
          if ((isMac ? e.metaKey : e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            onSave()
          }
          if (e.key === 'Escape') {
            onCancel()
          }
        }}
      >
        <DescriptionEditor
          key={editorKey}
          value={initialBody}
          onCommit={onChange}
          onChange={onChange}
          placeholder={intl.formatMessage({ id: placeholderId })}
          members={mentionableMembers}
          {...(tasks ? { tasks } : {})}
          agentActors={agentActors ?? []}
        />
      </div>
      <div className='flex justify-end gap-2 px-2 pb-2'>
        <Button
          size='sm'
          variant='ghost'
          className='h-7 text-xs'
          onClick={onCancel}
        >
          {intl.formatMessage({ id: 'common.cancel' })}
        </Button>
        <Button
          size='sm'
          className='h-7 text-xs'
          disabled={!draftBody?.trim() || saving}
          onClick={onSave}
        >
          Save
        </Button>
      </div>
    </div>
  )
}

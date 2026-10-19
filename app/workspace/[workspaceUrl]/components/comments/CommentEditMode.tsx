'use client'

import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { isMac } from '@/lib/utils/keyboard'
import { DescriptionEditor } from '../DescriptionEditorLazy'
import type { MentionSources } from '@/types/mention'

interface Props {
  /** Stable React key — caller uses `edit-${id}` so toggling between rows
   * forces a fresh editor instance instead of reusing state across IDs. */
  editorKey: string
  initialBody: string
  /** Current draft body — drives the Save button's disabled state. */
  draftBody: string | null
  saving: boolean
  placeholderId: 'task.editCommentPlaceholder' | 'task.editReplyPlaceholder'
  mentionSources?: MentionSources
  onChange: (html: string | null) => void
  onSave: () => void
  onCancel: () => void
  /** i18n id for the confirm button label. Defaults to the literal "Save"
   * (task comments). Doc comments pass `common.confirm` to render 确认. */
  confirmLabelId?: string | undefined
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
  mentionSources,
  onChange,
  onSave,
  onCancel,
  confirmLabelId,
}: Props) {
  const intl = useIntl()
  return (
    <div className='border border-border rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-ring transition-all'>
      <div
        className='px-3 pt-2 pb-1 text-body'
        onKeyDown={e => {
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
          {...(mentionSources ? { mentionSources } : {})}
        />
      </div>
      <div className='flex justify-end gap-2 px-2 pb-2'>
        <Button
          size='sm'
          variant='ghost'
          className='h-7 text-caption'
          onClick={onCancel}
        >
          {intl.formatMessage({ id: 'common.cancel' })}
        </Button>
        <Button
          size='sm'
          className='h-7 text-caption'
          disabled={!draftBody?.trim() || saving}
          onClick={onSave}
        >
          {confirmLabelId ? intl.formatMessage({ id: confirmLabelId }) : 'Save'}
        </Button>
      </div>
    </div>
  )
}

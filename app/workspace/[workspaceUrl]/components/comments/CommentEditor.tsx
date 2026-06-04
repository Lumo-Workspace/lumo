'use client'

import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import { isMac } from '@/lib/utils/keyboard'
import type { ApiTask, WorkspaceMemberInfo } from '../../types'
import { DescriptionEditor } from '../DescriptionEditor'

interface Props {
  onCommit: (html: string | null) => void
  onSubmit: () => void
  /** Caller fills this ref with a `clear()` function so it can reset the
   * editor after a successful submit by re-keying it. */
  clearRef: React.MutableRefObject<(() => void) | null>
  members?: WorkspaceMemberInfo[]
  tasks?: ApiTask[] | undefined
  agentActors?: { actorId: string; name: string; avatarColor: string }[]
}

/**
 * Thin wrapper over `DescriptionEditor` used by both the new-comment input
 * and the inline reply input. Two responsibilities:
 *   1. Cmd/Ctrl+Enter submits the form (the editor itself doesn't know).
 *   2. Exposes a `clear()` via `clearRef` so the caller can reset the editor
 *      after a successful submit — we re-key it instead of trying to wire
 *      "set empty" through DescriptionEditor's value prop.
 */
export function CommentEditor({
  onCommit,
  onSubmit,
  clearRef,
  members,
  tasks,
  agentActors,
}: Props) {
  const intl = useIntl()
  const [key, setKey] = useState(0)

  useEffect(() => {
    clearRef.current = () => setKey(k => k + 1)
  })

  return (
    <div
      className='px-3 pt-2 pb-1 text-sm'
      onKeyDown={e => {
        if ((isMac ? e.metaKey : e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault()
          onSubmit()
        }
      }}
    >
      <DescriptionEditor
        key={key}
        value={null}
        onCommit={onCommit}
        onChange={onCommit}
        placeholder={intl.formatMessage({ id: 'task.commentPlaceholder' })}
        {...(members ? { members } : {})}
        {...(tasks ? { tasks } : {})}
        {...(agentActors ? { agentActors } : {})}
      />
    </div>
  )
}

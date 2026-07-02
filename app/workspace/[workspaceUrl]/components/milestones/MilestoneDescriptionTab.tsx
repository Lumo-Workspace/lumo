'use client'

import type { MilestoneUpdateInput } from '@/lib/api-client'
import type { WorkspaceMemberInfo } from '../../types'
import { DescriptionEditor } from '../DescriptionEditorLazy'
import { useMentionSources } from '../../hooks/useMentionSources'

interface MilestoneDescriptionTabProps {
  milestoneId: string
  description: string | null
  onUpdate: (fields: MilestoneUpdateInput) => void
  /** Workspace members, so the description editor can @-mention people. */
  members: WorkspaceMemberInfo[]
  archived?: boolean
}

/**
 * LUM-636 — the milestone description gets its own tab: the Overview stays a
 * read-only mission-control dashboard, the long-form prose lives here.
 */
export function MilestoneDescriptionTab({
  milestoneId,
  description,
  onUpdate,
  members,
  archived = false,
}: MilestoneDescriptionTabProps) {
  const mentionSources = useMentionSources(members)
  return (
    <div className='max-w-3xl px-4 md:px-8 py-8'>
      <DescriptionEditor
        key={milestoneId}
        value={description}
        onCommit={html => {
          if (!archived) onUpdate({ description: html || null })
        }}
        documentId={milestoneId}
        mentionSources={mentionSources}
      />
    </div>
  )
}

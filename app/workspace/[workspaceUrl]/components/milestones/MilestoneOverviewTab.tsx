'use client'

import { useIntl } from 'react-intl'
import type { ApiMilestone, MilestoneUpdateInput } from '@/lib/api-client'
import { DescriptionEditor } from '../DescriptionEditor'
import { TypographyH3 } from '@/components/ui/typography'

interface MilestoneOverviewTabProps {
  milestone: Pick<ApiMilestone, 'id' | 'name' | 'description'>
  onUpdate: (fields: MilestoneUpdateInput) => void
  archived?: boolean
}

/** Overview tab: inline-editable name + description. Mirrors ProjectOverviewTab. */
export function MilestoneOverviewTab({
  milestone,
  onUpdate,
  archived = false,
}: MilestoneOverviewTabProps) {
  const intl = useIntl()
  return (
    <div className='px-4 md:px-8 py-8'>
      <div className='mb-8'>
        <TypographyH3
          key={milestone.id}
          contentEditable={!archived}
          suppressContentEditableWarning
          onBlur={e => {
            if (archived) return
            const trimmed = e.currentTarget.textContent?.trim() ?? ''
            if (!trimmed || trimmed === milestone.name) {
              e.currentTarget.textContent = milestone.name
              return
            }
            onUpdate({ name: trimmed })
          }}
          onKeyDown={e => {
            if (archived) return
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
            if (e.key === 'Escape') {
              e.currentTarget.textContent = milestone.name
              e.currentTarget.blur()
            }
          }}
          className='outline-none cursor-text focus:outline-none'
        >
          {milestone.name}
        </TypographyH3>
      </div>

      <div className='max-w-3xl'>
        <p className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3'>
          {intl.formatMessage({ id: 'milestone.field.description' })}
        </p>
        <DescriptionEditor
          key={milestone.id}
          value={milestone.description}
          onCommit={html => { if (!archived) onUpdate({ description: html || null }) }}
          documentId={milestone.id}
        />
      </div>
    </div>
  )
}

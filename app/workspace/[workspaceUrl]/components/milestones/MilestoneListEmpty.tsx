'use client'

import { useIntl } from 'react-intl'
import { Flag, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

interface Props {
  /** Which archive-state view is empty — each one is empty for its own reason. */
  tab: 'active' | 'archived' | 'all'
  onCreate: () => void
}

// Spelled out rather than interpolated, so a grep for a message id finds it.
const COPY = {
  active: {
    title: 'milestone.empty.active.title',
    body: 'milestone.empty.active.body',
  },
  archived: {
    title: 'milestone.empty.archived.title',
    body: 'milestone.empty.archived.body',
  },
  all: { title: 'milestone.empty.all.title', body: 'milestone.empty.all.body' },
} as const

/**
 * The milestone list with nothing in it.
 *
 * The copy is per tab because the tabs are empty for different reasons: no
 * milestone has been created yet (All), none is running right now (Active), or
 * none has been put away yet (Archived). One shared "No milestones yet" told a
 * reader on Archived that the project had none at all.
 *
 * Archived gets no call to action for the same reason: archiving is something
 * you do to an existing milestone, so "create one" is not the way out of it.
 */
export function MilestoneListEmpty({ tab, onCreate }: Props) {
  const intl = useIntl()
  const copy = COPY[tab]

  return (
    <div className='overflow-hidden rounded-lg border border-border'>
      {/* The `md:` padding has to be restated: Empty's own `md:p-12` beats an
          unprefixed override at every width the list is actually read at. */}
      <Empty className='gap-4 px-5 py-14 md:px-5 md:py-14'>
        <EmptyHeader className='gap-2'>
          <EmptyMedia variant='icon'>
            <Flag />
          </EmptyMedia>
          {/* Sized to the dense rows this replaces, not to a full-page empty
              state — the list lives inside a project tab. `font-semibold` is
              not redundant with the token: EmptyTitle's own `font-medium`
              survives the merge and would otherwise win. */}
          <EmptyTitle className='text-body-strong font-semibold'>
            {intl.formatMessage({ id: copy.title })}
          </EmptyTitle>
          <EmptyDescription>
            {intl.formatMessage({ id: copy.body })}
          </EmptyDescription>
        </EmptyHeader>
        {tab !== 'archived' && (
          <EmptyContent>
            <Button onClick={onCreate}>
              <Plus className='size-4' aria-hidden />
              {intl.formatMessage({ id: 'milestone.new' })}
            </Button>
          </EmptyContent>
        )}
      </Empty>
    </div>
  )
}

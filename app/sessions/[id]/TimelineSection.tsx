'use client'

import { useIntl } from 'react-intl'
import { SESSION_MESSAGES as M } from '../messages'
import { Timeline } from './Timeline'
import type { TimelineItem } from './merge-events'

export function TimelineSection({ items }: { items: TimelineItem[] }) {
  const intl = useIntl()
  return (
    <section>
      <h2 className='mb-3 text-body-strong uppercase text-muted-foreground'>
        {intl.formatMessage(M['timeline.heading'])}
      </h2>
      <Timeline items={items} />
    </section>
  )
}

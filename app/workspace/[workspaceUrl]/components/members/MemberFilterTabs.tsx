'use client'

import { useIntl } from 'react-intl'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  MEMBER_FILTERS,
  type MemberFilter,
} from '@/lib/members/connection-status'

const LABEL_ID: Record<MemberFilter, string> = {
  all: 'members.filter.all',
  needsUpdate: 'members.filter.needsUpdate',
  notConnected: 'members.filter.notConnected',
}

/** LUM-1136: All / Needs update / Not connected, each with its count. */
export function MemberFilterTabs({
  value,
  counts,
  onChange,
}: {
  value: MemberFilter
  /** Omitted counts (connections still loading) render without a number. */
  counts: Partial<Record<MemberFilter, number>>
  onChange: (filter: MemberFilter) => void
}) {
  const intl = useIntl()
  return (
    <Tabs value={value} onValueChange={v => onChange(v as MemberFilter)}>
      <TabsList
        aria-label={intl.formatMessage({ id: 'members.filter.label' })}
        className='h-auto flex-wrap justify-start'
      >
        {MEMBER_FILTERS.map(f => (
          <TabsTrigger key={f} value={f} className='gap-1.5'>
            {intl.formatMessage({ id: LABEL_ID[f] })}
            {counts[f] !== undefined && (
              <span className='tabular-nums text-muted-foreground'>
                {counts[f]}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

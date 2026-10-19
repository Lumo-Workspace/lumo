'use client'

import { useIntl } from 'react-intl'
import {
  ToggleGroup,
  ToggleGroupItem,
  ToggleGroupItemCount,
} from '@/components/ui/toggle-group'
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
    <ToggleGroup
      type='single'
      variant='chip'
      value={value}
      onValueChange={v => {
        // Single-select: ignore the '' Radix sends when the active chip is re-clicked.
        if (v) onChange(v as MemberFilter)
      }}
      aria-label={intl.formatMessage({ id: 'members.filter.label' })}
    >
      {MEMBER_FILTERS.map(f => (
        <ToggleGroupItem key={f} value={f}>
          {intl.formatMessage({ id: LABEL_ID[f] })}
          {counts[f] !== undefined && (
            <ToggleGroupItemCount>{counts[f]}</ToggleGroupItemCount>
          )}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

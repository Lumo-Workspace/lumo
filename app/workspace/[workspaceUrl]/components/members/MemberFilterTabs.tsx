'use client'

import { useIntl } from 'react-intl'
import { cn } from '@/lib/utils'
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
    <nav
      aria-label={intl.formatMessage({ id: 'members.filter.label' })}
      className='flex flex-wrap gap-1'
    >
      {MEMBER_FILTERS.map(f => {
        const active = f === value
        return (
          <button
            key={f}
            type='button'
            aria-pressed={active}
            onClick={() => onChange(f)}
            className={cn(
              '-mb-px h-10 shrink-0 whitespace-nowrap border-b-2 px-3 text-sm transition-colors',
              active
                ? 'border-foreground font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {intl.formatMessage({ id: LABEL_ID[f] })}
            {counts[f] !== undefined && (
              <span className='ml-1.5 font-normal text-muted-foreground'>
                {counts[f]}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}

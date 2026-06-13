'use client'

import { useIntl } from 'react-intl'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { initialsOf } from '../initials'
import { fmtCompact } from './model-cost-format'
import type { PerMemberSummaryRow } from './summarize-per-member'

/** Per-person spend overview, shown above the per-model breakdown. Only renders
 *  when 2+ members split the work (single-member needs no attribution). */
export function PerMemberSummary({ rows }: { rows: PerMemberSummaryRow[] }) {
  const intl = useIntl()
  if (rows.length < 2) return null
  return (
    <div
      className='mb-3 flex flex-col gap-1.5'
      data-testid='per-member-summary'
    >
      {rows.map(r => (
        <div key={r.workspaceMemberId} className='flex items-center gap-2'>
          <Avatar className='size-4 shrink-0'>
            <AvatarImage src={r.imageUrl || undefined} />
            <AvatarFallback className='text-[8px]'>
              {initialsOf(r.name)}
            </AvatarFallback>
          </Avatar>
          <span className='w-24 truncate text-caption text-foreground'>
            {r.name}
          </span>
          <span className='h-1.5 flex-1 overflow-hidden rounded-full bg-muted'>
            <span
              className='block h-full rounded-full bg-foreground/40'
              style={{ width: `${Math.round(r.pct * 100)}%` }}
            />
          </span>
          <span className='w-14 text-right text-caption tabular-nums text-muted-foreground'>
            {fmtCompact(intl, r.total)}
          </span>
          <span className='w-10 text-right text-caption tabular-nums text-muted-foreground'>
            {Math.round(r.pct * 100)}%
          </span>
        </div>
      ))}
    </div>
  )
}

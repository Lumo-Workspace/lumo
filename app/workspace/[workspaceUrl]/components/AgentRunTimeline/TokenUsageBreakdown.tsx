'use client'

import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { Users, Cpu } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import type { AgentRunMemberStat, ModelCost } from '../../types'
import { TokenCostBreakdown } from '../TokenCostBreakdown'
import { foldMembersToCostRows, type MemberCostRow } from './fold-members-to-cost'
import { initialsOf } from '../initials'

interface TokenUsageBreakdownProps {
  totals: { runCount: number; turnCount: number; loopCount: number; byModel: ModelCost[] }
  perMember: AgentRunMemberStat[]
}

function GroupLabel({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className='mt-3 mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground first:mt-0'>
      {icon}
      {label}
    </div>
  )
}

function memberHeader(m: ModelCost) {
  const r = m as MemberCostRow
  return (
    <span className='flex items-center gap-1.5 text-caption font-semibold'>
      <Avatar className='size-4 shrink-0'>
        <AvatarImage src={r.imageUrl || undefined} />
        <AvatarFallback className='text-[8px]'>{initialsOf(r.name)}</AvatarFallback>
      </Avatar>
      {r.name}
    </span>
  )
}

export function TokenUsageBreakdown({ totals, perMember }: TokenUsageBreakdownProps) {
  const intl = useIntl()
  const memberRows = foldMembersToCostRows(perMember)
  const showGroups = memberRows.length >= 2

  return (
    <div>
      {showGroups && (
        <>
          <GroupLabel
            icon={<Users className='size-3.5' aria-hidden />}
            label={intl.formatMessage({ id: 'tokenCost.byMember', defaultMessage: 'By member' })}
          />
          <TokenCostBreakdown
            variant='full'
            showTitle={false}
            collapsibleDetails
            models={memberRows}
            loopCount={null}
            rowHeader={memberHeader}
          />
          <GroupLabel
            icon={<Cpu className='size-3.5' aria-hidden />}
            label={intl.formatMessage({ id: 'tokenCost.byModel', defaultMessage: 'By model' })}
          />
        </>
      )}
      <TokenCostBreakdown
        variant='full'
        showTitle={false}
        collapsibleDetails
        models={totals.byModel}
        loopCount={totals.loopCount}
        turnCount={totals.turnCount}
      />
    </div>
  )
}

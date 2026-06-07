'use client'

import { useIntl } from 'react-intl'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import type { AgentRunMemberStat } from '../../types'
import { TokenCostBreakdown } from '../TokenCostBreakdown'

/** First+last initial, or first two chars for a single-word name. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

/**
 * Per-person token spend on a task (LUM-307). Renders one row per workspace
 * member who owns at least one run with captured cost — avatar + name, a
 * runs/turns caption, and the same model breakdown bars used elsewhere.
 * Renders nothing when there's no per-member cost to show.
 */
export function AgentRunMemberStats({
  members,
}: {
  members: AgentRunMemberStat[]
}) {
  const intl = useIntl()
  if (members.length === 0) return null

  return (
    <div
      className='rounded-lg border border-border'
      data-testid='agent-run-member-stats'
    >
      <div className='px-3 py-2 border-b border-border text-xs text-muted-foreground'>
        {intl.formatMessage({
          id: 'agentRun.byMember',
          defaultMessage: '按人统计',
        })}
      </div>
      <div className='divide-y divide-border/60'>
        {members.map(m => (
          <div
            key={m.workspaceMemberId}
            className='px-3 py-3'
            data-testid={`member-stat-${m.workspaceMemberId}`}
          >
            <div className='flex items-center gap-2'>
              <Avatar className='size-6 shrink-0'>
                <AvatarImage src={m.imageUrl || undefined} />
                <AvatarFallback className='text-[10px]'>
                  {initialsOf(m.name)}
                </AvatarFallback>
              </Avatar>
              <span className='text-xs font-medium'>{m.name}</span>
              <span className='ml-auto text-[11px] text-muted-foreground tabular-nums'>
                {intl.formatMessage(
                  {
                    id: 'agentRun.memberSummary',
                    defaultMessage: '{runs} 次运行 · {turns} 轮',
                  },
                  { runs: m.runCount, turns: m.turnCount }
                )}
              </span>
            </div>
            <TokenCostBreakdown
              variant='compact'
              models={m.byModel}
              loopCount={m.loopCount}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

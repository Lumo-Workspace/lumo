'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { AlertTriangle, Clock, Bot, GitPullRequest } from 'lucide-react'
import type { TopBlockers } from '@/types/summary'

interface TopBlockersListProps {
  blockers: TopBlockers
  onOpenTask: (taskId: string) => void
}

interface BlockerGroup {
  key: string
  labelKey: string
  Icon: typeof AlertTriangle
  items: Array<{ id: string; label: string }>
  kind: 'task' | 'pr'
}

function useBlockerGroups(blockers: TopBlockers): BlockerGroup[] {
  return [
    {
      key: 'overdue',
      labelKey: 'summary.blockerGroup.overdue',
      Icon: AlertTriangle,
      items: blockers.overdueTaskIds.map(id => ({ id, label: id })),
      kind: 'task',
    },
    {
      key: 'stalled',
      labelKey: 'summary.blockerGroup.stalled',
      Icon: Clock,
      items: blockers.stalledTaskIds.map(id => ({ id, label: id })),
      kind: 'task',
    },
    {
      key: 'failing-agents',
      labelKey: 'summary.blockerGroup.failingAgents',
      Icon: Bot,
      items: blockers.failingAgentTaskIds.map(id => ({ id, label: id })),
      kind: 'task',
    },
    {
      key: 'stale-prs',
      labelKey: 'summary.blockerGroup.stalePrs',
      Icon: GitPullRequest,
      items: blockers.staleOpenPrNumbers.map(n => ({
        id: String(n),
        label: `#${n}`,
      })),
      kind: 'pr',
    },
  ]
}

const MAX_PER_GROUP = 5

export function TopBlockersList({
  blockers,
  onOpenTask,
}: TopBlockersListProps) {
  const intl = useIntl()
  const groups = useBlockerGroups(blockers)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const allEmpty = groups.every(g => g.items.length === 0)

  if (allEmpty) {
    return (
      <div className='rounded-lg border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/50 dark:bg-emerald-900/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300'>
        {intl.formatMessage({ id: 'summary.noBlockers' })}
      </div>
    )
  }

  return (
    <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden'>
      <div className='px-4 py-3 border-b border-zinc-100 dark:border-zinc-800'>
        <p className='text-sm font-semibold text-zinc-800 dark:text-zinc-200'>
          {intl.formatMessage({ id: 'summary.topBlockers' })}
        </p>
      </div>
      <div className='grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-zinc-100 dark:divide-zinc-800'>
        {groups
          .filter(g => g.items.length > 0)
          .map(g => {
            const showAll = expanded[g.key] ?? false
            const visible = showAll ? g.items : g.items.slice(0, MAX_PER_GROUP)
            const hidden = g.items.length - visible.length
            return (
              <div key={g.key} className='p-4 space-y-2'>
                <div className='flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400'>
                  <g.Icon className='h-3.5 w-3.5' />
                  {intl.formatMessage({ id: g.labelKey })} ({g.items.length})
                </div>
                <ul className='space-y-1'>
                  {visible.map(item => (
                    <li key={item.id}>
                      {g.kind === 'task' ? (
                        <button
                          type='button'
                          onClick={() => onOpenTask(item.id)}
                          className='text-sm text-indigo-600 dark:text-indigo-400 hover:underline'
                        >
                          {item.label}
                        </button>
                      ) : (
                        <span className='text-sm text-zinc-700 dark:text-zinc-300'>
                          {item.label}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {hidden > 0 && (
                  <button
                    type='button'
                    onClick={() =>
                      setExpanded(prev => ({ ...prev, [g.key]: true }))
                    }
                    className='text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
                  >
                    {intl.formatMessage(
                      { id: 'summary.showMore' },
                      { n: hidden }
                    )}
                  </button>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}

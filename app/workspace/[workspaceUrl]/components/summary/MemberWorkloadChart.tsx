'use client'

import { useIntl } from 'react-intl'

interface MemberWorkloadChartProps {
  workload: Array<{
    actorId: string
    name: string
    assigned: number
    completed: number
  }>
}

export function MemberWorkloadChart({ workload }: MemberWorkloadChartProps) {
  const intl = useIntl()

  const displayed = workload.slice(0, 8)
  const maxAssigned = Math.max(...displayed.map(m => m.assigned), 1)

  return (
    <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-4 space-y-3'>
      <p className='text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500'>
        {intl.formatMessage({ id: 'summary.memberWorkload' })}
      </p>

      {displayed.length === 0 ? (
        <p className='text-xs text-zinc-400 dark:text-zinc-500'>No data</p>
      ) : (
        <div className='space-y-2'>
          {displayed.map(member => (
            <div key={member.actorId} className='space-y-1'>
              <div className='flex items-center justify-between'>
                <span className='text-xs text-zinc-700 dark:text-zinc-300 truncate max-w-[70%]'>
                  {member.name}
                </span>
                <span className='text-xs font-medium text-zinc-500 dark:text-zinc-400 shrink-0 ml-2'>
                  {intl.formatMessage({ id: 'summary.assigned' })}:{' '}
                  {member.assigned}
                </span>
              </div>
              <div className='h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden'>
                <div
                  className='h-full bg-blue-500 rounded-full transition-all'
                  style={{
                    width: `${(member.assigned / maxAssigned) * 100}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

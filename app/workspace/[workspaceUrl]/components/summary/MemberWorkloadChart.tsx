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
    <div className='rounded-lg border border-border bg-muted p-4 space-y-3'>
      <p className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
        {intl.formatMessage({ id: 'summary.memberWorkload' })}
      </p>

      {displayed.length === 0 ? (
        <p className='text-xs text-muted-foreground'>No data</p>
      ) : (
        <div className='space-y-2'>
          {displayed.map(member => (
            <div key={member.actorId} className='space-y-1'>
              <div className='flex items-center justify-between'>
                <span className='text-xs text-foreground truncate max-w-[70%]'>
                  {member.name}
                </span>
                <span className='text-xs font-medium text-muted-foreground shrink-0 ml-2'>
                  {intl.formatMessage({ id: 'summary.assigned' })}:{' '}
                  {member.assigned}
                </span>
              </div>
              <div className='h-2 bg-muted rounded-full overflow-hidden'>
                <div
                  className='h-full bg-chart-1 rounded-full transition-all'
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

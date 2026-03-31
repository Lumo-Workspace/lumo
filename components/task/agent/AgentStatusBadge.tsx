'use client'

import { useState, useEffect } from 'react'

export function AgentStatusBadge({
  status,
  pausedAt,
}: {
  status: string
  error?: string | null
  pausedAt?: Date | null
}) {
  const [pausedMins, setPausedMins] = useState<number | null>(null)

  useEffect(() => {
    if (status !== 'PAUSED' || !pausedAt) {
      setPausedMins(null)
      return
    }
    const update = () =>
      setPausedMins(Math.floor((Date.now() - pausedAt.getTime()) / 60000))
    update()
    const timer = setInterval(update, 30000)
    return () => clearInterval(timer)
  }, [status, pausedAt])

  const configs: Record<string, { label: string; dot: string; text: string }> =
    {
      IDLE: { label: 'Idle', dot: 'bg-zinc-400', text: 'text-zinc-500' },
      RUNNING: {
        label: 'Running',
        dot: 'bg-blue-500 animate-pulse',
        text: 'text-blue-600 dark:text-blue-400',
      },
      PAUSED: {
        label:
          pausedMins != null && pausedMins > 0
            ? `Waiting · paused ${pausedMins}m`
            : 'Waiting · paused',
        dot: 'bg-amber-500',
        text: 'text-amber-600 dark:text-amber-400',
      },
      SPEC_REVIEW: {
        label: 'Spec review',
        dot: 'bg-amber-500',
        text: 'text-amber-600 dark:text-amber-400',
      },
      DONE: {
        label: 'Done',
        dot: 'bg-emerald-500',
        text: 'text-emerald-600 dark:text-emerald-400',
      },
      FAILED: {
        label: 'Failed',
        dot: 'bg-red-500',
        text: 'text-red-600 dark:text-red-400',
      },
      ERROR: {
        label: 'Error',
        dot: 'bg-orange-500',
        text: 'text-orange-600 dark:text-orange-400',
      },
      CANCELLED: {
        label: 'Cancelled',
        dot: 'bg-zinc-400',
        text: 'text-zinc-500',
      },
    }
  const cfg = configs[status] ?? configs['IDLE']!

  return (
    <div
      className={`flex items-center gap-1.5 text-xs font-medium ${cfg.text}`}
    >
      <span className={`inline-block size-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </div>
  )
}

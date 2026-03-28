'use client'

import { useEffect, useRef, useState } from 'react'
import Pusher from 'pusher-js'
import type { AgentEvent } from '@/lib/pusher/server'

interface AgentLog {
  id: string
  type: AgentEvent['type']
  message: string
}

interface AgentStatusProps {
  taskId: string
  initialStatus?: string | null
  initialPrUrl?: string | null
}

const ICON: Record<AgentEvent['type'], string> = {
  'agent:started': '🚀',
  'agent:thinking': '💭',
  'agent:tool': '⚡',
  'agent:progress': '●',
  'agent:clarify': '❓',
  'agent:done': '✅',
  'agent:failed': '❌',
}

const TOOL_LABEL: Record<string, string> = {
  Read: 'Reading',
  Write: 'Writing',
  Edit: 'Editing',
  Bash: 'Running',
}

function formatEvent(event: AgentEvent): string {
  switch (event.type) {
    case 'agent:started':
      return 'Agent started'
    case 'agent:thinking':
      return event.message
    case 'agent:tool':
      return `${TOOL_LABEL[event.tool] ?? event.tool}${event.input ? `: ${event.input}` : ''}`
    case 'agent:progress':
      return event.message
    case 'agent:clarify':
      return `Needs clarification: ${event.question}`
    case 'agent:done':
      return 'Done — PR created'
    case 'agent:failed':
      return `Failed: ${event.error}`
  }
}

export function AgentStatus({
  taskId,
  initialStatus,
  initialPrUrl,
}: AgentStatusProps) {
  const [logs, setLogs] = useState<AgentLog[]>([])
  const [status, setStatus] = useState<string>(initialStatus ?? 'idle')
  const [prUrl, setPrUrl] = useState<string | null>(initialPrUrl ?? null)
  const logsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  useEffect(() => {
    const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY
    const pusherCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER
    if (!pusherKey || !pusherCluster) return

    const pusher = new Pusher(pusherKey, { cluster: pusherCluster })
    const channel = pusher.subscribe(`task-${taskId}`)

    channel.bind('agent-update', (event: AgentEvent) => {
      setLogs(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          type: event.type,
          message: formatEvent(event),
        },
      ])

      if (event.type === 'agent:started') setStatus('running')
      if (event.type === 'agent:done') {
        setStatus('done')
        setPrUrl(event.prUrl)
      }
      if (event.type === 'agent:failed') setStatus('failed')
      if (event.type === 'agent:clarify') setStatus('paused')
    })

    return () => {
      channel.unbind_all()
      pusher.unsubscribe(`task-${taskId}`)
    }
  }, [taskId])

  if (status === 'idle' || logs.length === 0) return null

  return (
    <div className='rounded-lg border border-border bg-muted/30 p-4 space-y-3'>
      <div className='flex items-center gap-2 text-sm font-medium'>
        {status === 'running' && (
          <span className='h-2 w-2 rounded-full bg-blue-500 animate-pulse' />
        )}
        {status === 'done' && (
          <span className='h-2 w-2 rounded-full bg-green-500' />
        )}
        {status === 'failed' && (
          <span className='h-2 w-2 rounded-full bg-red-500' />
        )}
        {status === 'paused' && (
          <span className='h-2 w-2 rounded-full bg-yellow-500' />
        )}
        <span className='text-muted-foreground'>
          {status === 'running' && 'Agent is working...'}
          {status === 'done' && 'Agent finished'}
          {status === 'failed' && 'Agent failed'}
          {status === 'paused' && 'Waiting for clarification'}
        </span>
      </div>

      <div className='max-h-64 overflow-y-auto space-y-1 font-mono text-xs'>
        {logs.map(log => (
          <div
            key={log.id}
            className='flex items-start gap-2 text-muted-foreground'
          >
            <span className='shrink-0 w-4'>{ICON[log.type]}</span>
            <span className='break-all'>{log.message}</span>
          </div>
        ))}
        <div ref={logsEndRef} />
      </div>

      {prUrl && (
        <a
          href={prUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='inline-flex items-center gap-1 text-xs text-blue-500 hover:underline'
        >
          View Pull Request →
        </a>
      )}
    </div>
  )
}

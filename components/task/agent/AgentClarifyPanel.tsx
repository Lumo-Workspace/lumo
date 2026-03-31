'use client'

import { useState, useEffect, useCallback } from 'react'
import { HelpCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { AgentClarifyPending } from './types'

export function AgentClarifyPanel({
  clarify,
  taskId,
  workspaceId,
  pausedAt,
  onReplied,
}: {
  clarify: AgentClarifyPending
  taskId: string
  workspaceId: string
  pausedAt: Date | null
  onReplied: () => void
}) {
  const [reply, setReply] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [elapsed, setElapsed] = useState('')

  useEffect(() => {
    if (!pausedAt) return
    const update = () => {
      const mins = Math.floor((Date.now() - pausedAt.getTime()) / 60000)
      setElapsed(mins < 1 ? '< 1 分钟' : `${mins} 分钟`)
    }
    update()
    const timer = setInterval(update, 30000)
    return () => clearInterval(timer)
  }, [pausedAt])

  const handleSubmit = useCallback(async () => {
    if (!reply.trim()) return
    setSubmitting(true)
    try {
      await fetch('/api/agent/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, workspaceId, reply: reply.trim() }),
      })
      onReplied()
    } finally {
      setSubmitting(false)
    }
  }, [taskId, workspaceId, reply, onReplied])

  return (
    <div className='rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 overflow-hidden'>
      {/* Header */}
      <div className='flex items-center justify-between px-3 pt-2.5 pb-2 border-b border-amber-200/60 dark:border-amber-800/60'>
        <div className='flex items-center gap-1.5'>
          <HelpCircle size={12} className='text-amber-500 shrink-0' />
          <span className='text-xs font-semibold text-amber-800 dark:text-amber-200'>
            Agent 需要确认
          </span>
        </div>
        {elapsed && (
          <span className='text-[10px] text-amber-600 dark:text-amber-400'>
            已停待等 · {elapsed}
          </span>
        )}
      </div>

      <div className='p-3 space-y-2.5'>
        <p className='text-xs text-amber-800 dark:text-amber-200 leading-snug'>
          {clarify.question}
        </p>
        {clarify.context && (
          <p className='text-[11px] text-amber-700/80 dark:text-amber-300/80 leading-snug'>
            {clarify.context}
          </p>
        )}
        <Textarea
          value={reply}
          onChange={e => setReply(e.target.value)}
          placeholder='回复后 Agent 立即继续...'
          className='min-h-[56px] text-xs resize-none bg-white/70 dark:bg-zinc-900/50 border-amber-200 dark:border-amber-800 focus-visible:ring-amber-400'
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
          }}
        />
        <Button
          size='sm'
          className='w-full h-7 text-xs bg-amber-500 hover:bg-amber-600 text-white border-0'
          disabled={!reply.trim() || submitting}
          onClick={handleSubmit}
        >
          {submitting ? (
            <Loader2 size={12} className='animate-spin mr-1' />
          ) : null}
          发送
        </Button>
      </div>
    </div>
  )
}

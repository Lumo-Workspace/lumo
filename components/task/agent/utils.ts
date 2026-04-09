import type { AgentEvent } from '@/lib/integrations/pusher'

export function formatEvent(event: AgentEvent): string {
  switch (event.type) {
    case 'agent:started':
      return 'Agent started'
    case 'agent:thinking':
      return event.message
    case 'agent:tool': {
      const labels: Record<string, string> = {
        Read: 'Reading',
        Write: 'Writing',
        Edit: 'Editing',
        Bash: 'Running',
      }
      return `${labels[event.tool] ?? event.tool}${event.input ? `: ${event.input}` : ''}`
    }
    case 'agent:progress':
      return event.message
    case 'agent:clarify':
      return `Needs clarification: ${event.question}`
    case 'agent:spec_draft':
      return 'Spec draft ready for review'
    case 'agent:done':
      return 'Done — PR created'
    case 'agent:failed':
      return `Failed: ${event.error}`
  }
}

export function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
}

export function formatStepElapsed(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function formatRelativeTime(
  dateStr: string,
  locale: string = 'en'
): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const seconds = Math.floor(diff / 1000)

  if (seconds < 60)
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
      0,
      'second'
    )

  const rtf = new Intl.RelativeTimeFormat(locale, {
    numeric: 'always',
    style: 'narrow',
  })
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return rtf.format(-mins, 'minute')
  const hours = Math.floor(mins / 60)
  if (hours < 24) return rtf.format(-hours, 'hour')
  const days = Math.floor(hours / 24)
  return rtf.format(-days, 'day')
}

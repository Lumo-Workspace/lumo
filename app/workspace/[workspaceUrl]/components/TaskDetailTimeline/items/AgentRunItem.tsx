'use client'

import { useIntl } from 'react-intl'
import { Bot, CheckCircle2, XCircle, MessageCircleQuestion } from 'lucide-react'
import type { TimelineActivityEntry } from '../../../types'

interface AgentRunItemProps {
  entry: TimelineActivityEntry
}

export function AgentRunItem({ entry }: AgentRunItemProps) {
  const intl = useIntl()
  const payload = entry.payload ?? {}
  const runNumber = payload.runNumber as number | undefined

  const config: Record<
    string,
    { icon: typeof Bot; color: string; label: string }
  > = {
    AGENT_RUN_STARTED: {
      icon: Bot,
      color: 'text-info-text',
      label: intl.formatMessage(
        {
          id: 'activity.agentRunStarted',
          defaultMessage: 'Agent run #{n} started',
        },
        { n: runNumber }
      ),
    },
    AGENT_RUN_COMPLETED: {
      icon: CheckCircle2,
      color: 'text-success-text',
      label: intl.formatMessage(
        {
          id: 'activity.agentRunCompleted',
          defaultMessage: 'Agent run #{n} completed',
        },
        { n: runNumber }
      ),
    },
    AGENT_RUN_FAILED: {
      icon: XCircle,
      color: 'text-danger-text',
      label: intl.formatMessage(
        {
          id: 'activity.agentRunFailed',
          defaultMessage: 'Agent run #{n} failed',
        },
        { n: runNumber }
      ),
    },
    AGENT_INPUT_REQUIRED: {
      icon: MessageCircleQuestion,
      color: 'text-warning-text',
      label: intl.formatMessage(
        {
          id: 'activity.agentInputRequired',
          defaultMessage: 'Agent run #{n} needs input',
        },
        { n: runNumber }
      ),
    },
  }

  const c = config[entry.type] ?? {
    icon: Bot,
    color: 'text-muted-foreground',
    label: entry.type,
  }
  const Icon = c.icon

  return (
    <div className='flex items-start gap-2.5 py-2 px-3 rounded-md bg-muted border border-border'>
      <Icon size={16} className={`mt-0.5 shrink-0 ${c.color}`} />
      <div className='flex-1 min-w-0'>
        <p className='text-caption text-foreground'>{c.label}</p>
        {payload.errorCode != null && (
          <p className='text-[11px] text-danger-text mt-0.5'>
            {String(payload.errorCode)}
          </p>
        )}
        {payload.reason != null && (
          <p className='text-[11px] text-warning-text mt-0.5'>
            {String(payload.reason)}
          </p>
        )}
      </div>
      <span className='text-[11px] text-muted-foreground shrink-0'>
        {new Date(entry.createdAt).toLocaleTimeString(intl.locale, {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </span>
    </div>
  )
}

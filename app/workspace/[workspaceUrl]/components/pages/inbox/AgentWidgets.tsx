'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import {
  Loader2,
  SendHorizonal,
  ThumbsUp,
  RotateCcw,
  ShieldCheck,
  ShieldX,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ItemActions } from '@/components/ui/item'
import type {
  AgentClarifyWidgetProps,
  AgentVerifyWidgetProps,
  AgentAuthorizeWidgetProps,
} from './types'

export function AgentClarifyWidget({
  notification,
  onRespond,
}: AgentClarifyWidgetProps) {
  const intl = useIntl()
  const [reply, setReply] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    const trimmed = reply.trim()
    if (!trimmed) return
    setSubmitting(true)
    onRespond(notification.id, 'reply', trimmed)
  }

  return (
    <div className='mt-2 space-y-1.5' onClick={e => e.stopPropagation()}>
      {notification.clarifyQuestion && (
        <p className='text-xs text-foreground/80 italic leading-snug'>
          {notification.clarifyQuestion}
        </p>
      )}
      {notification.clarifyContext && (
        <p className='text-xs text-muted-foreground leading-snug'>
          {notification.clarifyContext}
        </p>
      )}
      <Textarea
        value={reply}
        onChange={e => setReply(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            handleSubmit()
          }
        }}
        placeholder={intl.formatMessage({
          id: 'agent.clarify.placeholder',
          defaultMessage: 'Reply to the agent...',
        })}
        className='text-xs min-h-[56px] resize-none'
        disabled={submitting}
        autoFocus={false}
      />
      <Button
        size='sm'
        className='h-6 text-[11px] px-2'
        disabled={!reply.trim() || submitting}
        onClick={handleSubmit}
      >
        {submitting ? (
          <Loader2
            size={11}
            className='animate-spin'
            data-icon='inline-start'
          />
        ) : (
          <SendHorizonal size={11} data-icon='inline-start' />
        )}
        {intl.formatMessage({
          id: 'agent.clarify.send',
          defaultMessage: 'Send reply',
        })}
      </Button>
    </div>
  )
}

export function AgentVerifyWidget({
  notification,
  onRespond,
}: AgentVerifyWidgetProps) {
  const intl = useIntl()
  const [actionTaken, setActionTaken] = useState<
    'confirm' | 'send_back' | null
  >(null)

  return (
    <ItemActions className='mt-0.5' onClick={e => e.stopPropagation()}>
      <Button
        size='sm'
        className={cn(
          'h-6 text-[11px] px-2',
          actionTaken === 'send_back' && 'opacity-40'
        )}
        disabled={!!actionTaken}
        onClick={() => {
          setActionTaken('confirm')
          onRespond(notification.id, 'confirm')
        }}
      >
        <ThumbsUp size={11} data-icon='inline-start' />
        {intl.formatMessage({
          id: 'agent.verify.confirm',
          defaultMessage: 'Confirm',
        })}
      </Button>
      <Button
        size='sm'
        variant='outline'
        className={cn(
          'h-6 text-[11px] px-2',
          actionTaken === 'confirm' && 'opacity-40'
        )}
        disabled={!!actionTaken}
        onClick={() => {
          setActionTaken('send_back')
          onRespond(notification.id, 'send_back')
        }}
      >
        <RotateCcw size={11} data-icon='inline-start' />
        {intl.formatMessage({
          id: 'notification.action.sendBack',
          defaultMessage: 'Send back',
        })}
      </Button>
    </ItemActions>
  )
}

export function AgentAuthorizeWidget({
  notification,
  onRespond,
}: AgentAuthorizeWidgetProps) {
  const intl = useIntl()
  const [actionTaken, setActionTaken] = useState<'approve' | 'deny' | null>(
    null
  )

  return (
    <ItemActions className='mt-0.5' onClick={e => e.stopPropagation()}>
      <Button
        size='sm'
        className={cn(
          'h-6 text-[11px] px-2',
          actionTaken === 'deny' && 'opacity-40'
        )}
        disabled={!!actionTaken}
        onClick={() => {
          setActionTaken('approve')
          onRespond(notification.id, 'approve')
        }}
      >
        <ShieldCheck size={11} data-icon='inline-start' />
        {intl.formatMessage({
          id: 'agent.authorize.approve',
          defaultMessage: 'Approve',
        })}
      </Button>
      <Button
        size='sm'
        variant='outline'
        className={cn(
          'h-6 text-[11px] px-2 text-destructive hover:text-destructive',
          actionTaken === 'approve' && 'opacity-40'
        )}
        disabled={!!actionTaken}
        onClick={() => {
          setActionTaken('deny')
          onRespond(notification.id, 'deny')
        }}
      >
        <ShieldX size={11} data-icon='inline-start' />
        {intl.formatMessage({
          id: 'agent.authorize.deny',
          defaultMessage: 'Deny',
        })}
      </Button>
    </ItemActions>
  )
}

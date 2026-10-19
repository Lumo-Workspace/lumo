'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import Link from 'next/link'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { SectionAddButton } from './TaskDetailTimeline/SectionAddButton'

export interface LinkSlackPopoverProps {
  connected: boolean
  integrationsHref: string
  onAttach: (permalink: string) => Promise<void>
}

/**
 * Map service-level Slack error codes (carried as `Error.message`) to
 * user-facing i18n keys. Mirrors the mapping used in the old
 * AddSlackContextDialog so error copy is preserved during the popover
 * migration.
 */
const ERROR_CODE_TO_KEY: Record<string, string> = {
  invalid_permalink: 'slackContext.error.invalidPermalink',
  not_connected: 'slackContext.error.notConnected',
  wrong_team: 'slackContext.error.wrongTeam',
  not_in_channel: 'slackContext.error.notInChannel',
  message_gone: 'slackContext.error.messageGone',
  missing_scope: 'slackContext.error.missingScope',
  slack_unavailable: 'slackContext.error.slackUnavailable',
}

export function LinkSlackPopover({
  connected,
  integrationsHref,
  onAttach,
}: LinkSlackPopoverProps): React.ReactElement {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const [permalink, setPermalink] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setPermalink('')
    setError(null)
    setSubmitting(false)
  }

  const submit = async () => {
    const trimmed = permalink.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onAttach(trimmed)
      reset()
      setOpen(false)
    } catch (err) {
      const code = err instanceof Error ? err.message : null
      const key = code ? ERROR_CODE_TO_KEY[code] : undefined
      if (key) {
        setError(intl.formatMessage({ id: key }))
      } else if (err instanceof Error && err.message) {
        setError(err.message)
      } else {
        setError(
          intl.formatMessage({ id: 'task.contextLink.common.errors.network' })
        )
      }
    } finally {
      setSubmitting(false)
    }
  }

  const label = intl.formatMessage({ id: 'slackContext.add' })

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <PopoverTrigger asChild>
        <SectionAddButton label={label} />
      </PopoverTrigger>
      <PopoverContent align='end' className='w-80 p-0'>
        {connected ? (
          <>
            <div className='p-2 border-b border-border'>
              <input
                type='url'
                value={permalink}
                onChange={e => setPermalink(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void submit()
                  }
                }}
                disabled={submitting}
                placeholder={intl.formatMessage({
                  id: 'task.contextLink.slack.placeholder',
                })}
                className='w-full text-sm bg-transparent outline-none placeholder:text-muted-foreground text-foreground px-1 py-1 disabled:opacity-50'
                autoFocus
              />
            </div>
            {error && (
              <p role='alert' className='px-3 py-2 text-xs text-danger-text'>
                {error}
              </p>
            )}
          </>
        ) : (
          <div className='p-3 space-y-2'>
            <p className='text-xs text-muted-foreground'>
              {intl.formatMessage({
                id: 'task.contextLink.slack.errors.workspaceNotConnected',
              })}
            </p>
            <Link
              href={integrationsHref}
              className='inline-block text-xs font-medium text-info-text hover:underline'
            >
              {intl.formatMessage({ id: 'task.contextLink.slack.connectCta' })}
            </Link>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

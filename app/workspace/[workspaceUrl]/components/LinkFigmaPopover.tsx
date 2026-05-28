'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { SectionAddButton } from './TaskDetailTimeline/SectionAddButton'
import { ApiClientError } from '@/lib/api-client/base'

export interface LinkFigmaPopoverProps {
  onAttach: (url: string) => Promise<void>
}

export function LinkFigmaPopover({
  onAttach,
}: LinkFigmaPopoverProps): React.ReactElement {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setUrl('')
    setError(null)
    setSubmitting(false)
  }

  const submit = async () => {
    const trimmed = url.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onAttach(trimmed)
      reset()
      setOpen(false)
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === 'figma_not_connected') {
          setError(
            intl.formatMessage({
              id: 'task.figma.notConnected',
              defaultMessage:
                'Figma is not connected. Go to Settings → Integrations to connect.',
            })
          )
        } else if (err.code === 'figma_needs_reauth') {
          setError(
            intl.formatMessage({
              id: 'task.figma.needsReauth',
              defaultMessage:
                'Figma token expired. Reconnect Figma in Settings → Integrations.',
            })
          )
        } else {
          setError(
            err.message ??
              intl.formatMessage({
                id: 'task.contextLink.common.errors.network',
              })
          )
        }
      } else {
        const e = err as { message?: string }
        setError(
          e?.message ??
            intl.formatMessage({
              id: 'task.contextLink.common.errors.network',
            })
        )
      }
    } finally {
      setSubmitting(false)
    }
  }

  const label = intl.formatMessage({ id: 'task.figma.addButton' })

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
        <div className='p-2 border-b border-zinc-100 dark:border-zinc-800'>
          <input
            type='url'
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void submit()
              }
            }}
            disabled={submitting}
            placeholder={intl.formatMessage({
              id: 'task.figma.urlPlaceholder',
              defaultMessage: 'Paste a Figma URL…',
            })}
            className='w-full text-sm bg-transparent outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500 text-zinc-900 dark:text-zinc-100 px-1 py-1 disabled:opacity-50'
            autoFocus
          />
        </div>
        {error && (
          <p
            role='alert'
            className='px-3 py-2 text-xs text-red-500 dark:text-red-400'
          >
            {error}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}

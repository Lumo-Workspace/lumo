'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { SectionAddButton } from './TaskDetailTimeline/SectionAddButton'

export interface LinkWebLinkPopoverProps {
  onAttach: (url: string) => Promise<void>
}

export function LinkWebLinkPopover({
  onAttach,
}: LinkWebLinkPopoverProps): React.ReactElement {
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
      const e = err as { message?: string }
      setError(
        e?.message ??
          intl.formatMessage({ id: 'task.contextLink.common.errors.network' })
      )
    } finally {
      setSubmitting(false)
    }
  }

  const label = intl.formatMessage({ id: 'task.webLinks.addButton' })

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
        <div className='p-2 border-b border-border'>
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
              id: 'task.contextLink.weblink.placeholder',
            })}
            className='w-full text-body bg-transparent outline-none placeholder:text-muted-foreground text-foreground px-1 py-1 disabled:opacity-50'
            autoFocus
          />
        </div>
        {error && (
          <p role='alert' className='px-3 py-2 text-caption text-danger-text'>
            {error}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}

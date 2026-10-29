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
import { ApiClientError } from '@/lib/api-client/base'

export interface LinkFigmaPopoverProps {
  onAttach: (url: string) => Promise<void>
  /**
   * Whether the workspace's Figma integration is connected. `undefined` means
   * the caller does not gate — the input renders and a missing integration
   * surfaces lazily as a `figma_not_connected` error on attach (the Task
   * variant's long-standing behaviour). Pass `false` to swap the input for a
   * pointer at workspace settings instead of letting someone paste a URL into
   * a dead end (LUM-684).
   */
  connected?: boolean
  /** Required to render the not-connected pointer; ignored otherwise. */
  integrationsHref?: string
}

export function LinkFigmaPopover({
  onAttach,
  connected,
  integrationsHref,
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
                'Figma is not connected. Go to Settings → Connected accounts to connect.',
            })
          )
        } else if (err.code === 'figma_needs_reauth') {
          setError(
            intl.formatMessage({
              id: 'task.figma.needsReauth',
              defaultMessage:
                'Figma token expired. Reconnect Figma in Settings → Connected accounts.',
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
        {connected === false && integrationsHref ? (
          <div className='p-3 space-y-2'>
            <p className='text-caption text-muted-foreground'>
              {intl.formatMessage({
                id: 'task.figma.notConnected',
                defaultMessage:
                  'Figma is not connected. Go to Settings → Connected accounts to connect.',
              })}
            </p>
            <Link
              href={integrationsHref}
              className='inline-block text-caption text-info-text hover:underline'
            >
              {intl.formatMessage({
                id: 'task.contextLink.figma.connectCta',
                defaultMessage: 'Open integrations →',
              })}
            </Link>
          </div>
        ) : (
          <>
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
                  id: 'task.figma.urlPlaceholder',
                  defaultMessage: 'Paste a Figma URL…',
                })}
                className='w-full text-body bg-transparent outline-none placeholder:text-muted-foreground text-foreground px-1 py-1 disabled:opacity-50'
                autoFocus
              />
            </div>
            {error && (
              <p
                role='alert'
                className='px-3 py-2 text-caption text-danger-text'
              >
                {error}
              </p>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

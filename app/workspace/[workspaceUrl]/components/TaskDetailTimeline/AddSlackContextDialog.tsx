'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (permalink: string) => Promise<void>
}

const ERROR_CODE_TO_KEY: Record<string, string> = {
  invalid_permalink: 'slackContext.error.invalidPermalink',
  not_connected: 'slackContext.error.notConnected',
  wrong_team: 'slackContext.error.wrongTeam',
  not_in_channel: 'slackContext.error.notInChannel',
  message_gone: 'slackContext.error.messageGone',
  missing_scope: 'slackContext.error.missingScope',
  slack_unavailable: 'slackContext.error.slackUnavailable',
}

export function AddSlackContextDialog({
  open,
  onClose,
  onSubmit,
}: Props): React.ReactElement | null {
  const intl = useIntl()
  const [permalink, setPermalink] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!open) return null

  const handleSubmit = async () => {
    setSubmitting(true)
    setErrorMsg(null)
    try {
      await onSubmit(permalink)
      setPermalink('')
      onClose()
    } catch (e) {
      const code = e instanceof Error ? e.message : 'slack_unavailable'
      const key =
        ERROR_CODE_TO_KEY[code] ?? 'slackContext.error.slackUnavailable'
      setErrorMsg(intl.formatMessage({ id: key, defaultMessage: code }))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40'>
      <div className='bg-white dark:bg-zinc-900 rounded-md shadow-lg p-4 w-[480px] max-w-[90vw]'>
        <h2 className='text-sm font-semibold mb-3'>
          {intl.formatMessage({
            id: 'slackContext.dialog.title',
            defaultMessage: 'Attach a Slack message',
          })}
        </h2>
        <label className='block text-xs text-zinc-500 mb-1'>
          {intl.formatMessage({
            id: 'slackContext.dialog.permalinkLabel',
            defaultMessage: 'Slack permalink',
          })}
        </label>
        <input
          autoFocus
          value={permalink}
          onChange={e => setPermalink(e.target.value)}
          placeholder={intl.formatMessage({
            id: 'slackContext.dialog.permalinkPlaceholder',
            defaultMessage: '',
          })}
          className='w-full text-sm border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 bg-transparent'
        />
        {errorMsg && <p className='mt-2 text-xs text-red-500'>{errorMsg}</p>}
        <div className='mt-4 flex justify-end gap-2'>
          <button
            onClick={onClose}
            className='text-sm px-3 py-1 text-zinc-500 hover:text-zinc-700'
          >
            {intl.formatMessage({
              id: 'common.cancel',
              defaultMessage: 'Cancel',
            })}
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || permalink.length === 0}
            className='text-sm px-3 py-1 rounded bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900 disabled:opacity-50'
          >
            {intl.formatMessage({
              id: 'slackContext.dialog.submit',
              defaultMessage: 'Attach',
            })}
          </button>
        </div>
      </div>
    </div>
  )
}

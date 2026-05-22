'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (payload: { url: string; note?: string }) => void
}

export function WebLinkAddDialog({
  open,
  onClose,
  onSubmit,
}: Props): React.ReactElement | null {
  const intl = useIntl()
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  if (!open) return null

  const handleSubmit = () => {
    setErrorMsg(null)
    const trimmedNote = note.trim()
    try {
      onSubmit(trimmedNote ? { url, note: trimmedNote } : { url })
      setUrl('')
      setNote('')
      onClose()
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : 'Failed to add link. Please try again.'
      setErrorMsg(msg)
    }
  }

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40'>
      <div className='bg-white dark:bg-zinc-900 rounded-md shadow-lg p-4 w-[480px] max-w-[90vw]'>
        <h2 className='text-sm font-semibold mb-3'>
          {intl.formatMessage({
            id: 'task.webLinks.dialog.title',
            defaultMessage: 'Add a web link',
          })}
        </h2>

        <label className='block text-xs text-zinc-500 mb-1'>
          {intl.formatMessage({
            id: 'task.webLinks.dialog.urlLabel',
            defaultMessage: 'URL',
          })}
        </label>
        <input
          autoFocus
          type='url'
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder={intl.formatMessage({
            id: 'task.webLinks.dialog.urlPlaceholder',
            defaultMessage: 'https://',
          })}
          className='w-full text-sm border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 bg-transparent'
        />

        <label className='block text-xs text-zinc-500 mt-3 mb-1'>
          {intl.formatMessage({
            id: 'task.webLinks.dialog.noteLabel',
            defaultMessage: 'Notes (optional)',
          })}
        </label>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          maxLength={500}
          rows={3}
          className='w-full text-sm border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 bg-transparent resize-none'
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
            disabled={url.length === 0}
            className='text-sm px-3 py-1 rounded bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900 disabled:opacity-50'
          >
            {intl.formatMessage({
              id: 'task.webLinks.dialog.submit',
              defaultMessage: 'Add link',
            })}
          </button>
        </div>
      </div>
    </div>
  )
}

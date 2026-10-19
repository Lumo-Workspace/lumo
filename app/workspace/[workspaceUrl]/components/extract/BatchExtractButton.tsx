'use client'
import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import type { Editor } from '@tiptap/core'
import { useDocExtractContext } from '@/lib/editor/doc-extract-context'
import { extractTasks } from '@/lib/api-client/documents-extract'

function countUncheckedUnlinked(editor: Editor): number {
  let n = 0
  editor.state.doc.descendants(node => {
    if (node.type.name !== 'taskItem') return true
    if (node.attrs.checked) return false
    if (node.attrs.taskId) return false
    n += 1
    return false
  })
  return n
}

export function BatchExtractButton({ editor }: { editor: Editor }) {
  const ctx = useDocExtractContext()
  const intl = useIntl()
  const [count, setCount] = useState(() => countUncheckedUnlinked(editor))
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const update = () => setCount(countUncheckedUnlinked(editor))
    editor.on('update', update)
    return () => {
      editor.off('update', update)
    }
  }, [editor])

  if (count === 0 || !ctx) return null

  async function go() {
    setPending(true)
    try {
      const res = await extractTasks(ctx!.documentId, {
        content: editor.getHTML(),
        selector: { type: 'all_unchecked' },
      })
      ctx!.onApplied(res)
    } catch (err) {
      ctx!.onError(err as Error)
    } finally {
      setPending(false)
      setConfirming(false)
    }
  }

  const batchLabel = intl.formatMessage(
    {
      id: 'doc.extract.button.batch',
      defaultMessage: 'Extract {count} unchecked',
    },
    { count }
  )
  const confirmTitle = intl.formatMessage(
    {
      id: 'doc.extract.confirm.title',
      defaultMessage: 'Create {count, plural, one {1 task} other {# tasks}}?',
    },
    { count }
  )
  const confirmMessage = intl.formatMessage({
    id: 'doc.extract.confirm.message',
    defaultMessage: 'Each task will be assigned to you with priority Low.',
  })
  const confirmCta = intl.formatMessage(
    {
      id: 'doc.extract.confirm.cta',
      defaultMessage: 'Create {count, plural, one {task} other {# tasks}}',
    },
    { count }
  )
  const cancelLabel = intl.formatMessage({
    id: 'common.cancel',
    defaultMessage: 'Cancel',
  })

  return (
    <>
      <button
        type='button'
        onClick={() => setConfirming(true)}
        className='inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-body'
      >
        {batchLabel}
      </button>
      {confirming && (
        <ConfirmDialog
          title={confirmTitle}
          message={confirmMessage}
          cta={confirmCta}
          cancelLabel={cancelLabel}
          pending={pending}
          onCancel={() => setConfirming(false)}
          onConfirm={go}
        />
      )}
    </>
  )
}

function ConfirmDialog({
  title,
  message,
  cta,
  cancelLabel,
  pending,
  onCancel,
  onConfirm,
}: {
  title: string
  message: string
  cta: string
  cancelLabel: string
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      role='dialog'
      aria-modal='true'
      className='fixed inset-0 z-modal flex items-center justify-center bg-black/30'
    >
      <div className='w-96 rounded-sm bg-background p-4 shadow-elevation-3'>
        <h2 className='mb-2 text-title'>{title}</h2>
        <p className='mb-4 text-body text-muted-foreground'>{message}</p>
        <div className='flex justify-end gap-2'>
          <button
            type='button'
            onClick={onCancel}
            disabled={pending}
            className='rounded-sm border px-3 py-1 text-body'
          >
            {cancelLabel}
          </button>
          <button
            type='button'
            onClick={onConfirm}
            disabled={pending}
            className='rounded-sm bg-primary px-3 py-1 text-body text-primary-foreground'
          >
            {cta}
          </button>
        </div>
      </div>
    </div>
  )
}

'use client'
import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import type { Editor } from '@tiptap/core'
import { useDocExtractContext } from '@/lib/editor/doc-extract-context'
import { extractTasks } from '@/lib/api-client/documents-extract'
import { ConfirmActionDialog } from '../ConfirmActionDialog'

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

  return (
    <>
      <button
        type='button'
        onClick={() => setConfirming(true)}
        className='inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-body'
      >
        {batchLabel}
      </button>
      <ConfirmActionDialog
        open={confirming}
        onOpenChange={open => {
          // Keep the dialog up while the extract request is in flight.
          if (!pending) setConfirming(open)
        }}
        title={confirmTitle}
        description={confirmMessage}
        confirmLabel={confirmCta}
        pending={pending}
        onConfirm={() => void go()}
      />
    </>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import { Star } from 'lucide-react'
import {
  useDocumentRevisions,
  type RevisionListItem,
} from '@/app/workspace/[workspaceUrl]/hooks/useDocumentRevisions'
import { RevisionDiffView } from './RevisionDiffView'
import { LoadingState } from '../AsyncContent'
import { RowListSkeleton } from '../skeletons/RowListSkeleton'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

interface DocumentHistoryModalProps {
  open: boolean
  documentId: string
  currentHtml: string | null
  onClose: () => void
  onRestored: (document: unknown) => void
}

export function DocumentHistoryModal({
  open,
  documentId,
  currentHtml,
  onClose,
  onRestored,
}: DocumentHistoryModalProps) {
  const intl = useIntl()
  const { revisions, loading, getRevision, restore } = useDocumentRevisions(
    documentId,
    open
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedHtml, setSelectedHtml] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    void getRevision(selectedId).then(r => {
      if (!cancelled) setSelectedHtml(r.content)
    })
    return () => {
      cancelled = true
    }
  }, [selectedId, getRevision])

  const onRestore = async () => {
    if (!selectedId) return
    setRestoring(true)
    try {
      const doc = await restore(selectedId)
      onRestored(doc)
      onClose()
    } finally {
      setRestoring(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className='flex h-[80vh] w-[calc(100%-3rem)] max-w-5xl gap-0 overflow-hidden rounded-lg p-0'
      >
        {/* Left: timeline */}
        <aside className='w-72 shrink-0 overflow-y-auto border-r border-border p-2'>
          <DialogTitle className='px-2 py-2 text-body-strong'>
            {intl.formatMessage({
              id: 'documentHistory.title',
              defaultMessage: 'Version history',
            })}
          </DialogTitle>
          {loading && (
            <LoadingState
              label={intl.formatMessage({ id: 'documentHistory.loading' })}
            >
              <RowListSkeleton
                rows={5}
                subtitle
                trailing={false}
                rowClassName='px-2 py-1.5'
              />
            </LoadingState>
          )}
          <ul>
            {revisions.map((r: RevisionListItem) => (
              <li key={r.id}>
                <button
                  type='button'
                  onClick={() => setSelectedId(r.id)}
                  className={`flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-body hover:bg-muted ${
                    selectedId === r.id ? 'bg-muted' : ''
                  }`}
                >
                  <span className='flex items-center gap-1.5'>
                    {r.isManual && (
                      <Star
                        size={12}
                        className='text-warning-text'
                        aria-hidden
                      />
                    )}
                    <span className='text-body-strong'>
                      {r.label ??
                        intl.formatDate(r.createdAt, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                    </span>
                  </span>
                  <span className='text-caption text-muted-foreground'>
                    {r.author.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Right: diff + actions */}
        <section className='flex flex-1 flex-col'>
          <header className='flex items-center justify-end border-b border-border px-4 py-2'>
            <div className='flex gap-2'>
              <button
                type='button'
                onClick={onRestore}
                disabled={!selectedId || restoring}
                className='rounded-md bg-primary px-3 py-1.5 text-body text-primary-foreground disabled:opacity-50'
              >
                {intl.formatMessage({
                  id: 'documentHistory.restore',
                  defaultMessage: 'Restore this version',
                })}
              </button>
              <button
                type='button'
                onClick={onClose}
                className='rounded-md border border-border px-3 py-1.5 text-body'
              >
                {intl.formatMessage({
                  id: 'documentHistory.close',
                  defaultMessage: 'Close',
                })}
              </button>
            </div>
          </header>
          <div className='flex-1 overflow-y-auto p-4'>
            {selectedId ? (
              <RevisionDiffView oldHtml={selectedHtml} newHtml={currentHtml} />
            ) : (
              <p className='text-body text-muted-foreground'>
                {intl.formatMessage({
                  id: 'documentHistory.selectPrompt',
                  defaultMessage:
                    'Select a version to compare with the current document.',
                })}
              </p>
            )}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  )
}

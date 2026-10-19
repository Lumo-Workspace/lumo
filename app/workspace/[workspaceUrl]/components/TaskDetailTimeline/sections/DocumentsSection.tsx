'use client'

import { useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useIntl } from 'react-intl'
import { FileText, X } from 'lucide-react'
import { toast } from 'sonner'
import { ApiClientError } from '@/lib/api-client/base'
import {
  taskDocumentsClient,
  type TaskDocumentResource,
} from '@/lib/api-client/task-documents'
import { ContextSection } from '../ContextSection'
import { LinkDocPopover } from '../../LinkDocPopover'

interface Props {
  documents: TaskDocumentResource[]
  workspaceUrl: string
  taskId: string
  // Refresh callback fired after either an attach or a detach completes.
  // Kept named `onAttached` to avoid churn in ContextTab; functionally it's
  // a "documents changed, please refetch" signal regardless of direction.
  onAttached: () => void | Promise<void>
}

// CONTENT backlinks (mentioned in a doc body) lead; EXPLICIT manual binds
// follow. Array.prototype.sort is stable, so same-source order is preserved.
const SOURCE_ORDER: Record<TaskDocumentResource['source'], number> = {
  CONTENT: 0,
  EXPLICIT: 1,
}

export function DocumentsSection({
  documents,
  workspaceUrl,
  taskId,
  onAttached,
}: Props): React.ReactElement {
  const intl = useIntl()

  const sorted = useMemo(
    () =>
      [...documents].sort(
        (a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source]
      ),
    [documents]
  )

  const handleSearch = useCallback(async (q: string) => {
    const { documents: hits } = await taskDocumentsClient.search(q)
    return hits
  }, [])

  const handleAttach = useCallback(
    async (payload: { identifier: string } | { documentId: string }) => {
      await taskDocumentsClient.attach(taskId, payload)
      await onAttached()
    },
    [taskId, onAttached]
  )

  const handleDetach = useCallback(
    async (documentId: string) => {
      try {
        await taskDocumentsClient.detach(taskId, documentId)
        await onAttached()
      } catch (err) {
        if (
          err instanceof ApiClientError &&
          err.code === 'CONTENT_MENTION_ONLY'
        ) {
          toast.error(
            intl.formatMessage({
              id: 'task.contextLink.doc.errors.contentMentionOnly',
              defaultMessage:
                'This document is mentioned in the task body. Edit the task description to remove it.',
            })
          )
          return
        }
        toast.error(
          intl.formatMessage({
            id: 'task.contextLink.common.errors.network',
            defaultMessage: 'Something went wrong. Please try again.',
          })
        )
      }
    },
    [taskId, onAttached, intl]
  )

  const addSlot = (
    <LinkDocPopover onSearch={handleSearch} onAttach={handleAttach} />
  )

  return (
    <ContextSection
      value='documents'
      label={intl.formatMessage({
        id: 'task.context.section.documents',
        defaultMessage: 'Documents',
      })}
      icon={<FileText size={14} className='text-muted-foreground' />}
      count={documents.length}
      addSlot={addSlot}
    >
      <p className='mb-2 text-caption text-muted-foreground'>
        {intl.formatMessage({ id: 'taskArtifact.docsRefOnly' })}
      </p>
      {sorted.length === 0 ? (
        <div className='py-4 text-caption text-muted-foreground text-center'>
          {intl.formatMessage({
            id: 'task.context.documents.empty',
            defaultMessage: 'No documents mention this task',
          })}
        </div>
      ) : (
        <ul className='space-y-1.5'>
          {sorted.map(doc => (
            <li
              key={doc.id}
              className='group flex items-center gap-2 text-caption'
            >
              {doc.emoji ? (
                <span>{doc.emoji}</span>
              ) : (
                <FileText size={12} className='text-muted-foreground' />
              )}
              <Link
                href={`/workspace/${workspaceUrl}/documents/${doc.slug}`}
                className='flex-1 text-foreground hover:underline truncate'
              >
                {doc.title}
              </Link>
              <span className='shrink-0 rounded-sm px-1 py-0.5 text-caption text-muted-foreground bg-muted'>
                {doc.source === 'CONTENT'
                  ? intl.formatMessage({
                      id: 'task.context.documents.source.content',
                      defaultMessage: 'In body',
                    })
                  : intl.formatMessage({
                      id: 'task.context.documents.source.explicit',
                      defaultMessage: 'Linked',
                    })}
              </span>
              {doc.source === 'EXPLICIT' && (
                <button
                  type='button'
                  onClick={() => {
                    void handleDetach(doc.id)
                  }}
                  aria-label={intl.formatMessage({
                    id: 'task.contextLink.doc.detachAction',
                    defaultMessage: 'Remove document',
                  })}
                  title={intl.formatMessage({
                    id: 'task.contextLink.doc.detachAction',
                    defaultMessage: 'Remove document',
                  })}
                  className='p-0.5 rounded-sm text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-muted hover:text-foreground transition-opacity'
                >
                  <X size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </ContextSection>
  )
}

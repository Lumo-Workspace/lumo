'use client'

import { useCallback } from 'react'
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

export function DocumentsSection({
  documents,
  workspaceUrl,
  taskId,
  onAttached,
}: Props): React.ReactElement {
  const intl = useIntl()

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
      icon={<FileText size={14} className='text-zinc-500 dark:text-zinc-400' />}
      count={documents.length}
      addSlot={addSlot}
    >
      <p className='mb-2 text-[11px] text-muted-foreground'>
        {intl.formatMessage({ id: 'taskArtifact.docsRefOnly' })}
      </p>
      {documents.length === 0 ? (
        <div className='py-4 text-xs text-zinc-400 dark:text-zinc-500 text-center'>
          {intl.formatMessage({
            id: 'task.context.documents.empty',
            defaultMessage: 'No documents linked',
          })}
        </div>
      ) : (
        <ul className='space-y-1.5'>
          {documents.map(doc => (
            <li key={doc.id} className='group flex items-center gap-2 text-xs'>
              {doc.emoji ? (
                <span>{doc.emoji}</span>
              ) : (
                <FileText size={12} className='text-zinc-400' />
              )}
              <Link
                href={`/workspace/${workspaceUrl}/documents/${doc.slug}`}
                className='flex-1 text-zinc-700 dark:text-zinc-300 hover:underline truncate'
              >
                {doc.title}
              </Link>
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
                className='p-0.5 rounded text-zinc-400 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200 transition-opacity'
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </ContextSection>
  )
}

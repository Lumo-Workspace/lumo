'use client'

import { useCallback } from 'react'
import Link from 'next/link'
import { useIntl } from 'react-intl'
import { FileText } from 'lucide-react'
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
            <li key={doc.id} className='flex items-center gap-2 text-xs'>
              {doc.emoji ? (
                <span>{doc.emoji}</span>
              ) : (
                <FileText size={12} className='text-zinc-400' />
              )}
              <Link
                href={`/workspace/${workspaceUrl}/documents/${doc.slug}`}
                className='text-zinc-700 dark:text-zinc-300 hover:underline truncate'
              >
                {doc.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ContextSection>
  )
}

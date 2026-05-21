'use client'

import Link from 'next/link'
import { useIntl } from 'react-intl'
import { FileText } from 'lucide-react'
import type { TaskDocumentResource } from '@/lib/api-client/task-documents'
import { ContextSection } from '../ContextSection'

interface Props {
  documents: TaskDocumentResource[]
  workspaceUrl: string
}

export function DocumentsSection({
  documents,
  workspaceUrl,
}: Props): React.ReactElement {
  const intl = useIntl()

  return (
    <ContextSection
      value='documents'
      label={intl.formatMessage({
        id: 'task.context.section.documents',
        defaultMessage: 'Documents',
      })}
      icon={<FileText size={14} className='text-zinc-500 dark:text-zinc-400' />}
      count={documents.length}
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
                href={`/workspace/${workspaceUrl}/documents/${doc.id}`}
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

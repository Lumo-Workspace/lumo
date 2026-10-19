'use client'

import { useIntl } from 'react-intl'
import { ChevronRight } from 'lucide-react'

interface BreadcrumbItem {
  id: string
  title: string
  emoji?: string | null
}

interface DocumentBreadcrumbProps {
  ancestors: BreadcrumbItem[]
  current: BreadcrumbItem
  onNavigate: (id: string | null) => void
}

export function DocumentBreadcrumb({
  ancestors,
  current,
  onNavigate,
}: DocumentBreadcrumbProps) {
  const intl = useIntl()
  const untitledLabel = intl.formatMessage({
    id: 'documents.untitled',
    defaultMessage: 'Untitled',
  })

  return (
    <nav className='flex items-center gap-1 text-caption text-muted-foreground'>
      <button
        type='button'
        className='hover:text-foreground transition-colors'
        onClick={() => onNavigate(null)}
      >
        {intl.formatMessage({ id: 'sidebar.documents' })}
      </button>
      {ancestors.map(item => (
        <span key={item.id} className='flex items-center gap-1'>
          <ChevronRight className='size-3' />
          <button
            type='button'
            className='hover:text-foreground transition-colors'
            onClick={() => onNavigate(item.id)}
          >
            {item.emoji ? `${item.emoji} ` : ''}
            {item.title || untitledLabel}
          </button>
        </span>
      ))}
      <ChevronRight className='size-3' />
      <span className='text-foreground'>
        {current.emoji ? `${current.emoji} ` : ''}
        {current.title || untitledLabel}
      </span>
    </nav>
  )
}

'use client'

import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { Plus, Search, MoreHorizontal, Trash2, Link } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { getInitials } from '@/lib/utils/getInitials'
import { AsyncContent } from '../AsyncContent'
import { ApiDocument, DocVisibility } from '../../types'
import { cn } from '@/lib/utils'

interface DocumentsPageProps {
  documents: ApiDocument[]
  loading: boolean
  error: string | null
  onRetry: () => void
  onNewDocument: () => void
  onSelectDocument: (doc: ApiDocument) => void
  onDeleteDocument: (id: string) => void
}

const FILTERS: { key: DocVisibility | 'ALL'; msgId: string }[] = [
  { key: 'ALL', msgId: 'documents.filterAll' },
  { key: 'PRIVATE', msgId: 'documents.filterPersonal' },
  { key: 'SHARED', msgId: 'documents.filterShared' },
  { key: 'WORKSPACE', msgId: 'documents.filterWorkspace' },
]

export function DocumentsPage({
  documents,
  loading,
  error,
  onRetry,
  onNewDocument,
  onSelectDocument,
  onDeleteDocument,
}: DocumentsPageProps) {
  const intl = useIntl()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<DocVisibility | 'ALL'>('ALL')
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    let result = documents
    if (filter !== 'ALL') {
      result = result.filter(d => d.visibility === filter)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(d => d.title.toLowerCase().includes(q))
    }
    return result
  }, [documents, filter, search])

  function formatRelativeTime(dateStr: string): string {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  }

  function getSubtitle(doc: ApiDocument): string {
    if (doc.project) return `in ${doc.project.name}`
    if (doc.visibility === 'PRIVATE')
      return intl.formatMessage({ id: 'documents.filterPersonal' })
    if (doc.visibility === 'SHARED')
      return intl.formatMessage({ id: 'documents.filterShared' })
    return intl.formatMessage({ id: 'documents.filterWorkspace' })
  }

  return (
    <div className='flex-1 flex flex-col overflow-hidden'>
      <div className='px-6 pt-6 pb-4'>
        <div className='flex items-center justify-between mb-1'>
          <div>
            <h1 className='text-2xl font-bold'>
              {intl.formatMessage({ id: 'documents.title' })}
            </h1>
            <p className='text-sm text-muted-foreground'>
              {intl.formatMessage({ id: 'documents.subtitle' })}
            </p>
          </div>
          <Button size='sm' onClick={onNewDocument}>
            <Plus className='size-4 mr-1' />
            {intl.formatMessage({ id: 'documents.newDocument' })}
          </Button>
        </div>

        <div className='flex items-center gap-2 mt-4'>
          {FILTERS.map(f => (
            <button
              key={f.key}
              type='button'
              className={cn(
                'px-3 py-1 text-xs rounded-md transition-colors',
                filter === f.key
                  ? 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setFilter(f.key)}
            >
              {intl.formatMessage({ id: f.msgId })}
            </button>
          ))}

          <div className='ml-auto relative'>
            <Search className='absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground' />
            <Input
              placeholder={intl.formatMessage({ id: 'documents.search' })}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className='pl-8 h-8 w-48 text-xs'
            />
          </div>
        </div>
      </div>

      <div className='flex-1 overflow-y-auto px-6'>
        <AsyncContent
          loading={loading}
          error={error}
          onRetry={onRetry}
          empty={filtered.length === 0}
          emptyState={
            <div className='text-center text-muted-foreground text-sm py-12'>
              {intl.formatMessage({
                id:
                  search || filter !== 'ALL'
                    ? 'documents.emptyFiltered'
                    : 'documents.empty',
              })}
            </div>
          }
        >
          <div className='divide-y divide-border'>
            {filtered.map(doc => (
              <div
                key={doc.id}
                className='flex items-center justify-between py-3 px-2 hover:bg-muted/50 rounded-md cursor-pointer transition-colors group'
                onClick={() => onSelectDocument(doc)}
              >
                <div className='flex items-center gap-3 min-w-0'>
                  <span className='text-lg shrink-0'>{doc.emoji ?? '📄'}</span>
                  <div className='min-w-0'>
                    <div className='font-medium text-sm truncate'>
                      {doc.title}
                    </div>
                    <div className='text-xs text-muted-foreground truncate'>
                      {getSubtitle(doc)}
                    </div>
                  </div>
                </div>

                <div className='flex items-center gap-3 shrink-0'>
                  <Avatar className='size-5'>
                    <AvatarImage src={doc.createdBy.imageUrl ?? undefined} />
                    <AvatarFallback className='text-[9px]'>
                      {getInitials(doc.createdBy.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className='text-xs text-muted-foreground w-16 text-right'>
                    {formatRelativeTime(doc.updatedAt)}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant='ghost'
                        size='icon'
                        className='size-6 opacity-0 group-hover:opacity-100'
                        onClick={e => e.stopPropagation()}
                      >
                        <MoreHorizontal className='size-3.5' />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                      <DropdownMenuItem
                        onClick={e => {
                          e.stopPropagation()
                        }}
                      >
                        <Link className='size-3.5 mr-2' />
                        {intl.formatMessage({ id: 'documents.copyLink' })}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className='text-red-500'
                        onClick={e => {
                          e.stopPropagation()
                          setDeleteId(doc.id)
                        }}
                      >
                        <Trash2 className='size-3.5 mr-2' />
                        {intl.formatMessage({ id: 'documents.delete' })}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        </AsyncContent>
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({ id: 'documents.delete' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({ id: 'documents.deleteConfirm' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteId) onDeleteDocument(deleteId)
                setDeleteId(null)
              }}
            >
              {intl.formatMessage({ id: 'documents.delete' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

'use client'

import { getInitials } from '@/lib/utils/getInitials'
import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import {
  Plus,
  Search,
  MoreHorizontal,
  Trash2,
  Link,
  List,
  Table2,
  ArrowDown,
  ArrowUpDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { AsyncContent } from '../AsyncContent'
import { ApiDocument, DocVisibility } from '../../types'
import { TagList } from '../document/TagBadge'
import { CollaboratorAvatars } from '../document/CollaboratorAvatars'
import { CACHE_KEY } from '../../constants'
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

type SortKey = 'updatedAt' | 'createdAt' | 'title'

function sortDocuments(docs: ApiDocument[], sortBy: SortKey): ApiDocument[] {
  return [...docs].sort((a, b) => {
    switch (sortBy) {
      case 'updatedAt':
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      case 'createdAt':
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      case 'title':
        return a.title.localeCompare(b.title)
    }
  })
}

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
  const [viewMode, setViewMode] = useState<'list' | 'table'>(() => {
    if (typeof window === 'undefined') return 'list'
    return (
      (localStorage.getItem(CACHE_KEY.docViewMode) as 'list' | 'table') ||
      'list'
    )
  })
  const [sortBy, setSortBy] = useState<SortKey>(() => {
    if (typeof window === 'undefined') return 'updatedAt'
    return (localStorage.getItem(CACHE_KEY.docSort) as SortKey) || 'updatedAt'
  })

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

  const sorted = useMemo(
    () => sortDocuments(filtered, sortBy),
    [filtered, sortBy]
  )

  function handleSetViewMode(mode: 'list' | 'table') {
    setViewMode(mode)
    localStorage.setItem(CACHE_KEY.docViewMode, mode)
  }

  function handleSetSortBy(key: SortKey) {
    setSortBy(key)
    localStorage.setItem(CACHE_KEY.docSort, key)
  }

  function getSubtitle(doc: ApiDocument): string {
    if (doc.project) return `in ${doc.project.name}`
    if (doc.visibility === 'PRIVATE')
      return intl.formatMessage({ id: 'documents.filterPersonal' })
    if (doc.visibility === 'SHARED')
      return intl.formatMessage({ id: 'documents.filterShared' })
    return intl.formatMessage({ id: 'documents.filterWorkspace' })
  }

  function renderRowMenu(doc: ApiDocument) {
    return (
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
    )
  }

  function renderListView() {
    return (
      <div className='divide-y divide-border'>
        {sorted.map(doc => (
          <div
            key={doc.id}
            className='flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/50 cursor-pointer transition-colors group'
            onClick={() => onSelectDocument(doc)}
          >
            <span className='text-lg shrink-0'>{doc.emoji ?? '📄'}</span>
            <div className='min-w-0 flex-1'>
              <div className='font-medium text-sm truncate'>{doc.title}</div>
              <div className='text-xs text-muted-foreground truncate'>
                {getSubtitle(doc)}
              </div>
            </div>
            {/* Creator */}
            <span className='flex items-center gap-1.5 shrink-0 hidden sm:flex'>
              <span className='size-[18px] rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0'>
                {doc.createdBy.imageUrl ? (
                  <img
                    src={doc.createdBy.imageUrl}
                    alt={doc.createdBy.name}
                    className='w-full h-full object-cover'
                  />
                ) : (
                  <span className='text-[8px] font-medium text-muted-foreground'>
                    {getInitials(doc.createdBy.name)}
                  </span>
                )}
              </span>
              <span className='text-xs text-muted-foreground'>
                {doc.createdBy.name}
              </span>
            </span>
            {/* Creator avatar only on mobile */}
            <span className='shrink-0 sm:hidden'>
              <span className='size-[18px] rounded-full bg-muted flex items-center justify-center overflow-hidden'>
                {doc.createdBy.imageUrl ? (
                  <img
                    src={doc.createdBy.imageUrl}
                    alt={doc.createdBy.name}
                    className='w-full h-full object-cover'
                  />
                ) : (
                  <span className='text-[8px] font-medium text-muted-foreground'>
                    {getInitials(doc.createdBy.name)}
                  </span>
                )}
              </span>
            </span>
            {doc.tags && doc.tags.length > 0 && (
              <div className='shrink-0 hidden sm:block'>
                <TagList tags={doc.tags} max={2} />
              </div>
            )}
            {doc.editors && doc.editors.length > 0 && (
              <div className='shrink-0 hidden sm:block'>
                <CollaboratorAvatars editors={doc.editors} max={3} size={22} />
              </div>
            )}
            <span className='text-xs text-muted-foreground w-16 text-right shrink-0'>
              {formatRelativeTime(doc.updatedAt)}
            </span>
            {renderRowMenu(doc)}
          </div>
        ))}
      </div>
    )
  }

  function renderSortableHeader(label: string, key: SortKey) {
    const isActive = sortBy === key
    return (
      <button
        type='button'
        className={cn(
          'inline-flex items-center gap-1 text-xs',
          isActive
            ? 'font-bold text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        )}
        onClick={() => handleSetSortBy(key)}
      >
        {label}
        {isActive ? (
          <ArrowDown className='size-3' />
        ) : (
          <ArrowUpDown className='size-3' />
        )}
      </button>
    )
  }

  function renderTableView() {
    return (
      <div className='overflow-x-auto'>
        <table className='w-full text-sm'>
          <thead>
            <tr className='border-b border-border'>
              <th className='text-left py-2 px-3 text-xs font-medium text-muted-foreground'>
                {intl.formatMessage({ id: 'documents.colName' })}
              </th>
              <th className='text-left py-2 px-3 text-xs font-medium text-muted-foreground'>
                {intl.formatMessage({ id: 'documents.colCreator' })}
              </th>
              <th className='text-left py-2 px-3 text-xs font-medium text-muted-foreground'>
                {intl.formatMessage({ id: 'documents.colTags' })}
              </th>
              <th className='text-left py-2 px-3 text-xs font-medium text-muted-foreground'>
                {intl.formatMessage({ id: 'documents.colCollaborators' })}
              </th>
              <th className='text-left py-2 px-3'>
                {renderSortableHeader(
                  intl.formatMessage({ id: 'documents.colUpdatedAt' }),
                  'updatedAt'
                )}
              </th>
              <th className='w-8' />
            </tr>
          </thead>
          <tbody>
            {sorted.map(doc => (
              <tr
                key={doc.id}
                className='border-b border-border hover:bg-muted/50 cursor-pointer transition-colors group'
                onClick={() => onSelectDocument(doc)}
              >
                <td className='py-2 px-3'>
                  <div className='flex items-center gap-2 min-w-0'>
                    <span className='text-base shrink-0'>
                      {doc.emoji ?? '📄'}
                    </span>
                    <span className='truncate font-medium'>{doc.title}</span>
                  </div>
                </td>
                <td className='py-2 px-3'>
                  <span className='flex items-center gap-1.5'>
                    <span className='size-[18px] rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0'>
                      {doc.createdBy.imageUrl ? (
                        <img
                          src={doc.createdBy.imageUrl}
                          alt={doc.createdBy.name}
                          className='w-full h-full object-cover'
                        />
                      ) : (
                        <span className='text-[8px] font-medium text-muted-foreground'>
                          {getInitials(doc.createdBy.name)}
                        </span>
                      )}
                    </span>
                    <span className='text-xs text-muted-foreground'>
                      {doc.createdBy.name}
                    </span>
                  </span>
                </td>
                <td className='py-2 px-3'>
                  {doc.tags && doc.tags.length > 0 && (
                    <TagList tags={doc.tags} max={3} />
                  )}
                </td>
                <td className='py-2 px-3'>
                  {doc.editors && doc.editors.length > 0 && (
                    <CollaboratorAvatars
                      editors={doc.editors}
                      max={3}
                      size={22}
                    />
                  )}
                </td>
                <td className='py-2 px-3 text-xs text-muted-foreground whitespace-nowrap'>
                  {formatRelativeTime(doc.updatedAt)}
                </td>
                <td className='py-2 px-1'>{renderRowMenu(doc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
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

          <div className='ml-auto flex items-center gap-2'>
            <Select
              value={sortBy}
              onValueChange={(v: string) => handleSetSortBy(v as SortKey)}
            >
              <SelectTrigger className='h-8 w-36 text-xs'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='updatedAt'>
                  {intl.formatMessage({ id: 'documents.sortUpdated' })}
                </SelectItem>
                <SelectItem value='createdAt'>
                  {intl.formatMessage({ id: 'documents.sortCreated' })}
                </SelectItem>
                <SelectItem value='title'>
                  {intl.formatMessage({ id: 'documents.sortTitle' })}
                </SelectItem>
              </SelectContent>
            </Select>

            <div className='flex items-center border rounded-md'>
              <Button
                variant='ghost'
                size='icon'
                className={cn(
                  'size-8 rounded-r-none',
                  viewMode === 'list' && 'bg-muted'
                )}
                onClick={() => handleSetViewMode('list')}
              >
                <List className='size-3.5' />
              </Button>
              <Button
                variant='ghost'
                size='icon'
                className={cn(
                  'size-8 rounded-l-none',
                  viewMode === 'table' && 'bg-muted'
                )}
                onClick={() => handleSetViewMode('table')}
              >
                <Table2 className='size-3.5' />
              </Button>
            </div>

            <div className='relative'>
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
      </div>

      <div className='flex-1 overflow-y-auto px-6'>
        <AsyncContent
          loading={loading}
          error={error}
          onRetry={onRetry}
          empty={sorted.length === 0}
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
          {viewMode === 'list' ? renderListView() : renderTableView()}
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

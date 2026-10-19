'use client'

import { getInitials } from '@/lib/utils/getInitials'
import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { Card } from '@/components/ui/card'
import { Plus, MoreHorizontal, Trash2, Link } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { TagListNew } from '../document/TagPicker'
import { CollaboratorAvatars } from '../document/CollaboratorAvatars'
import { ViewToggle } from '../ViewToggle'
import { PageBreadcrumb } from '../PageBreadcrumb'
import { SearchInput } from '../SearchInput'
import { CACHE_KEY } from '../../constants'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/datetime/relative'

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
  const [viewMode, setViewMode] = useState<'list' | 'board'>(() => {
    if (typeof window === 'undefined') return 'list'
    // Migrate the pre-board cache value: anyone with 'table' stored gets the
    // board view that replaced it. Unknown values fall back to 'list'.
    const stored = localStorage.getItem(CACHE_KEY.docViewMode)
    if (stored === 'board' || stored === 'table') return 'board'
    return 'list'
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

  function handleSetViewMode(mode: 'list' | 'board') {
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
              <div className='font-medium text-sm truncate'>
                {doc.title ||
                  intl.formatMessage({
                    id: 'documents.untitled',
                    defaultMessage: 'Untitled',
                  })}
              </div>
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
            {doc.docTags && doc.docTags.length > 0 ? (
              <div className='shrink-0 hidden sm:block'>
                <TagListNew tags={doc.docTags} max={2} />
              </div>
            ) : doc.tags && doc.tags.length > 0 ? (
              <div className='shrink-0 hidden sm:block'>
                <TagList tags={doc.tags} max={2} />
              </div>
            ) : null}
            {doc.editors && doc.editors.length > 0 && (
              <div className='shrink-0 hidden sm:block'>
                <CollaboratorAvatars editors={doc.editors} max={3} size={22} />
              </div>
            )}
            <span className='text-xs text-muted-foreground w-16 text-right shrink-0'>
              {formatRelativeTime(doc.updatedAt, intl.locale)}
            </span>
            {renderRowMenu(doc)}
          </div>
        ))}
      </div>
    )
  }

  function renderBoardView() {
    return (
      <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 pb-4'>
        {sorted.map(doc => (
          <Card
            key={doc.id}
            className='group flex h-64 cursor-pointer flex-col p-4 transition-colors hover:bg-muted/50'
            onClick={() => onSelectDocument(doc)}
          >
            <div className='flex items-start justify-between gap-2'>
              <div className='flex min-w-0 items-center gap-2'>
                <span className='shrink-0 text-base'>{doc.emoji ?? '📄'}</span>
                <span className='truncate text-sm font-medium'>
                  {doc.title ||
                    intl.formatMessage({
                      id: 'documents.untitled',
                      defaultMessage: 'Untitled',
                    })}
                </span>
              </div>
              {renderRowMenu(doc)}
            </div>
            <div className='mt-3 flex-1 overflow-hidden text-xs leading-relaxed text-muted-foreground whitespace-pre-line line-clamp-6'>
              {doc.preview ?? ''}
            </div>
            <div className='mt-3 flex items-center gap-2'>
              <span className='flex size-[20px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted'>
                {doc.createdBy.imageUrl ? (
                  <img
                    src={doc.createdBy.imageUrl}
                    alt={doc.createdBy.name}
                    className='h-full w-full object-cover'
                  />
                ) : (
                  <span className='text-[9px] font-medium text-muted-foreground'>
                    {getInitials(doc.createdBy.name)}
                  </span>
                )}
              </span>
              <span className='truncate text-xs text-muted-foreground'>
                {intl.formatMessage(
                  { id: 'documents.editedAt' },
                  { time: formatRelativeTime(doc.updatedAt, intl.locale) }
                )}
              </span>
            </div>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className='flex-1 flex flex-col overflow-hidden'>
      <PageBreadcrumb
        title={intl.formatMessage({ id: 'sidebar.documents' })}
        actions={
          <div className='flex items-center gap-2'>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={intl.formatMessage({ id: 'documents.search' })}
              className='w-48'
            />
            <ViewToggle value={viewMode} onChange={handleSetViewMode} />
            <Button size='sm' onClick={onNewDocument} className='gap-1.5'>
              <Plus size={14} />
              {intl.formatMessage({ id: 'documents.newDocument' })}
            </Button>
          </div>
        }
      />

      <div className='px-4 md:px-8 pt-4 pb-4 flex items-center gap-2 shrink-0'>
        {FILTERS.map(f => (
          <button
            key={f.key}
            type='button'
            className={cn(
              'px-3 py-1 text-xs rounded-md transition-colors',
              filter === f.key
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setFilter(f.key)}
          >
            {intl.formatMessage({ id: f.msgId })}
          </button>
        ))}

        <div className='ml-auto'>
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
        </div>
      </div>

      <div className='flex-1 overflow-y-auto px-4 md:px-8'>
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
          {viewMode === 'list' ? renderListView() : renderBoardView()}
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
            <AlertDialogCancel>
              {intl.formatMessage({ id: 'common.cancel' })}
            </AlertDialogCancel>
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

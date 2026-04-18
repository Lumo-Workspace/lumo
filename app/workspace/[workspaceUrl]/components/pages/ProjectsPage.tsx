'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { useIntl } from 'react-intl'
import { useParams } from 'next/navigation'
import { Search, Plus, Layers, Link as LinkIcon, Trash2 } from 'lucide-react'
import { ApiProject } from '../../types'
import { SortableHeader } from '../SortableHeader'
import { AsyncContent } from '../AsyncContent'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  useTableSort,
  applyDir,
  cmpString,
  cmpNumber,
  cmpDate,
} from '../../hooks/useTableSort'
import { IDEA_BADGE_CLS } from '../../constants'
import { PageBreadcrumb } from '../PageBreadcrumb'
import { copyLink } from '@/lib/utils/copyLink'
import { slugify } from '@/lib/utils/slugify'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Checkbox } from '@/components/ui/checkbox'
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

type ProjectSortKey =
  | 'name'
  | 'tasks'
  | 'todo'
  | 'inProgress'
  | 'inReview'
  | 'done'
  | 'owner'
  | 'updatedAt'

interface ProjectsPageProps {
  projects: ApiProject[]
  loading: boolean
  error: string | null
  onRetry: () => void
  onSelectProject: (project: ApiProject) => void
  onNewProject: () => void
  onBulkDelete: (projectIds: string[]) => Promise<void> | void
}

const STATUS_DOT_CLS = {
  TODO: 'bg-zinc-300 dark:bg-zinc-600',
  IN_PROGRESS: 'bg-blue-500',
  IN_REVIEW: 'bg-purple-500',
  DONE: 'bg-green-500',
} as const

function StatusCell({
  count,
  status,
}: {
  count: number
  status: keyof typeof STATUS_DOT_CLS
}) {
  return (
    <td className='py-4 px-6 border-b border-zinc-200 dark:border-zinc-800'>
      <div className='flex items-center gap-2'>
        <div className={`size-2 rounded-full ${STATUS_DOT_CLS[status]}`} />
        <span className='text-xs text-zinc-700 dark:text-zinc-300'>
          {count}
        </span>
      </div>
    </td>
  )
}

export function ProjectsPage({
  projects,
  loading,
  error,
  onRetry,
  onSelectProject,
  onNewProject,
  onBulkDelete,
}: ProjectsPageProps) {
  const intl = useIntl()
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const { sort, toggle } = useTableSort<ProjectSortKey>('updatedAt', 'desc')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const filtered = query.trim()
    ? projects.filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
    : projects

  const sorted = useMemo(() => {
    if (!sort.key) return projects
    return [...projects].sort((a, b) => {
      switch (sort.key) {
        case 'name':
          return applyDir(cmpString(a.name, b.name), sort.dir)
        case 'tasks':
          return applyDir(cmpNumber(a._count.tasks, b._count.tasks), sort.dir)
        case 'todo':
          return applyDir(cmpNumber(a.todoCount, b.todoCount), sort.dir)
        case 'inProgress':
          return applyDir(cmpNumber(a.inProgressCount, b.inProgressCount), sort.dir)
        case 'inReview':
          return applyDir(cmpNumber(a.inReviewCount, b.inReviewCount), sort.dir)
        case 'done':
          return applyDir(cmpNumber(a.doneCount, b.doneCount), sort.dir)
        case 'owner':
          return applyDir(
            cmpString(a.defaultReviewer?.name ?? '', b.defaultReviewer?.name ?? ''),
            sort.dir
          )
        case 'updatedAt':
          return applyDir(cmpDate(a.updatedAt, b.updatedAt), sort.dir)
        default:
          return 0
      }
    })
  }, [projects, sort])

  const visibleIds = useMemo(() => sorted.map(p => p.id), [sorted])
  const selectedVisibleCount = useMemo(
    () => visibleIds.filter(id => selected.has(id)).length,
    [visibleIds, selected]
  )
  const headerCheckboxState: boolean | 'indeterminate' =
    selectedVisibleCount === 0
      ? false
      : selectedVisibleCount === visibleIds.length
        ? true
        : 'indeterminate'

  const toggleAll = () => {
    setSelected(prev => {
      if (selectedVisibleCount === visibleIds.length) {
        // All selected → clear those
        const next = new Set(prev)
        visibleIds.forEach(id => next.delete(id))
        return next
      }
      // Otherwise select all visible
      const next = new Set(prev)
      visibleIds.forEach(id => next.add(id))
      return next
    })
  }

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const selectedIds = useMemo(() => Array.from(selected), [selected])
  const selectedCount = selectedIds.length

  const runBulkDelete = async () => {
    setDeleting(true)
    try {
      await onBulkDelete(selectedIds)
      setSelected(new Set())
    } finally {
      setDeleting(false)
      setConfirmOpen(false)
    }
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div className='flex-1 flex flex-col overflow-hidden'>
      {/* Breadcrumb */}
      <PageBreadcrumb title={intl.formatMessage({ id: 'sidebar.projects' })} />

      {/* Page header */}
      <header className='pt-4 pb-4 px-4 md:px-8 flex items-center justify-end shrink-0'>
        <div className='flex items-center gap-2'>
          <div className='relative w-56' ref={searchRef}>
            <Search
              size={16}
              className='absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400'
            />
            <input
              className='w-full bg-zinc-100/50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-md py-1.5 pl-9 pr-4 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:ring-1 focus:ring-zinc-400 transition-all outline-none'
              placeholder='Search projects...'
              type='text'
              value={query}
              onChange={e => {
                setQuery(e.target.value)
                setOpen(true)
              }}
              onFocus={() => setOpen(true)}
            />
            {open && query.trim() && (
              <div className='absolute top-full mt-1 w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md shadow-lg z-50 overflow-hidden'>
                {filtered.length === 0 ? (
                  <p className='px-3 py-2.5 text-xs text-zinc-400'>
                    No projects match.
                  </p>
                ) : (
                  filtered.map(p => (
                    <Button
                      key={p.id}
                      variant='ghost'
                      className='w-full justify-between h-auto px-3 py-2.5 text-xs text-zinc-900 dark:text-zinc-100 rounded-none font-normal gap-2'
                      onMouseDown={() => {
                        setQuery('')
                        setOpen(false)
                        onSelectProject(p)
                      }}
                    >
                      <span className='font-medium truncate'>{p.name}</span>
                      {p.isIdea && (
                        <span className={`shrink-0 ${IDEA_BADGE_CLS}`}>
                          Draft
                        </span>
                      )}
                    </Button>
                  ))
                )}
              </div>
            )}
          </div>
          <Button onClick={onNewProject} size='sm' className='gap-1.5'>
            <Plus size={14} />
            New Project
          </Button>
        </div>
      </header>

      {/* Spacer — matches the h-12 toolbar in MyTasksPage so empty state aligns */}
      <div className='h-12 shrink-0' />

      {/* Body */}
      <div className='flex-1 overflow-auto'>
        {selectedCount > 0 && (
          <div className='sticky top-0 z-20 flex items-center justify-between gap-3 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-6 py-2.5'>
            <span className='text-xs font-medium text-zinc-700 dark:text-zinc-300'>
              {selectedCount} selected
            </span>
            <div className='flex items-center gap-2'>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => setSelected(new Set())}
              >
                Cancel
              </Button>
              <Button
                variant='destructive'
                size='sm'
                className='gap-1.5'
                onClick={() => setConfirmOpen(true)}
              >
                <Trash2 size={14} />
                Delete {selectedCount} project{selectedCount === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        )}
        <AsyncContent
          loading={loading}
          error={error}
          empty={projects.length === 0}
          onRetry={onRetry}
          emptyState={
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <Layers />
                </EmptyMedia>
                <EmptyTitle>No projects yet</EmptyTitle>
                <EmptyDescription>
                  Projects you create will appear here.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={onNewProject}>
                  <Plus size={16} />
                  New Project
                </Button>
              </EmptyContent>
            </Empty>
          }
        >
          <table className='w-full border-collapse'>
            <thead className='sticky top-0 bg-white dark:bg-zinc-950 z-10'>
              <tr>
                <th className='py-3 px-4 w-10'>
                  <Checkbox
                    checked={headerCheckboxState}
                    onCheckedChange={toggleAll}
                    aria-label='Select all projects'
                  />
                </th>
                <SortableHeader
                  col='name'
                  label='Project'
                  sort={sort}
                  onToggle={toggle}
                  className='text-left py-3 px-6'
                />
                <SortableHeader
                  col='tasks'
                  label='Tasks'
                  sort={sort}
                  onToggle={toggle}
                  className='text-left py-3 px-6 w-24'
                />
                <SortableHeader
                  col='todo'
                  label='To Do'
                  sort={sort}
                  onToggle={toggle}
                  className='text-left py-3 px-6 w-24'
                />
                <SortableHeader
                  col='inProgress'
                  label='In Progress'
                  sort={sort}
                  onToggle={toggle}
                  className='text-left py-3 px-6 w-28'
                />
                <SortableHeader
                  col='inReview'
                  label='In Review'
                  sort={sort}
                  onToggle={toggle}
                  className='text-left py-3 px-6 w-28'
                />
                <SortableHeader
                  col='done'
                  label='Done'
                  sort={sort}
                  onToggle={toggle}
                  className='text-left py-3 px-6 w-24'
                />
                <SortableHeader
                  col='owner'
                  label='Owner'
                  sort={sort}
                  onToggle={toggle}
                  className='text-left py-3 px-6 w-32'
                />
                <SortableHeader
                  col='updatedAt'
                  label='Updated'
                  sort={sort}
                  onToggle={toggle}
                  className='text-right py-3 px-6'
                />
              </tr>
            </thead>
            <tbody className='divide-y divide-zinc-100 dark:divide-zinc-800'>
              {sorted.map(project => (
                <tr
                  key={project.id}
                  onClick={() => onSelectProject(project)}
                  className='hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors cursor-pointer group'
                >
                  <td
                    className='py-4 px-4 border-b border-zinc-200 dark:border-zinc-800'
                    onClick={e => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={selected.has(project.id)}
                      onCheckedChange={() => toggleOne(project.id)}
                      aria-label={`Select ${project.name}`}
                    />
                  </td>
                  <td className='py-4 px-6 border-b border-zinc-200 dark:border-zinc-800'>
                    <div className='flex items-center gap-3'>
                      <span className='font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors'>
                        {project.name}
                      </span>
                      {project.isIdea && <span className={IDEA_BADGE_CLS}>Draft</span>}
                    </div>
                  </td>
                  <td className='py-4 px-6 border-b border-zinc-200 dark:border-zinc-800'>
                    <span className='px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[11px] font-medium text-zinc-600 dark:text-zinc-400'>
                      {project._count.tasks}
                    </span>
                  </td>
                  <StatusCell count={project.todoCount} status='TODO' />
                  <StatusCell count={project.inProgressCount} status='IN_PROGRESS' />
                  <StatusCell count={project.inReviewCount} status='IN_REVIEW' />
                  <StatusCell count={project.doneCount} status='DONE' />
                  <td className='py-4 px-6 border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-700 dark:text-zinc-300'>
                    {project.defaultReviewer?.name ?? '—'}
                  </td>
                  <td className='py-4 px-6 text-right text-zinc-500 dark:text-zinc-400 text-xs border-b border-zinc-200 dark:border-zinc-800'>
                    <div className='flex items-center justify-end gap-2'>
                      <span>{new Date(project.updatedAt).toLocaleDateString()}</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            className='size-6 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-300 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors opacity-0 group-hover:opacity-100'
                            onClick={e => {
                              e.stopPropagation()
                              copyLink(
                                `${window.location.origin}/workspace/${workspaceUrl}/project/${slugify(project.name)}`
                              )
                            }}
                          >
                            <LinkIcon size={12} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Copy link</TooltipContent>
                      </Tooltip>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AsyncContent>
      </div>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={open => !deleting && setConfirmOpen(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedCount} project{selectedCount === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. All tasks, views, and documents in{' '}
              {selectedCount === 1
                ? 'this project'
                : `these ${selectedCount} projects`}{' '}
              will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={runBulkDelete}
              className='bg-red-600 hover:bg-red-700 focus:ring-red-600'
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

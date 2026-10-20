'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { useIntl } from 'react-intl'
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from 'next/navigation'
import { Plus, Layers, Link as LinkIcon, Trash2 } from 'lucide-react'
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
import { PROJECT_STATUS_LABEL_ID } from '../fields/ProjectStatusSelect'
import { PageBreadcrumb } from '../PageBreadcrumb'
import { SearchInput } from '../SearchInput'
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
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Command, CommandItem, CommandList } from '@/components/ui/command'

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

// Status dot colors come from the semantic --status-* tokens (single source of
// truth, shared with <StatusIcon>); the tokens carry their own light/dark
// values, so no per-class dark: variant is needed.
const STATUS_DOT_CLS = {
  TODO: 'bg-status-todo',
  IN_PROGRESS: 'bg-status-in-progress',
  IN_REVIEW: 'bg-status-in-review',
  DONE: 'bg-status-done',
} as const

function StatusCell({
  count,
  status,
}: {
  count: number
  status: keyof typeof STATUS_DOT_CLS
}) {
  return (
    <td className='py-4 px-6 border-b border-border'>
      <div className='flex items-center justify-center gap-2'>
        <div className={`size-2 rounded-full ${STATUS_DOT_CLS[status]}`} />
        <span className='text-caption text-foreground'>{count}</span>
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
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Sidebar's `+ New project` row on standalone pages navigates here with
  // `?new=1` because those shells don't host NewProjectModal. Open it on
  // mount and scrub the param so a refresh does not re-trigger the modal.
  useEffect(() => {
    if (searchParams?.get('new') === '1') {
      onNewProject()
      const rest = new URLSearchParams(searchParams.toString())
      rest.delete('new')
      const qs = rest.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
          return applyDir(
            cmpNumber(a.inProgressCount, b.inProgressCount),
            sort.dir
          )
        case 'inReview':
          return applyDir(cmpNumber(a.inReviewCount, b.inReviewCount), sort.dir)
        case 'done':
          return applyDir(cmpNumber(a.doneCount, b.doneCount), sort.dir)
        case 'owner':
          return applyDir(
            cmpString(a.owner?.name ?? '', b.owner?.name ?? ''),
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

  return (
    <div className='flex-1 flex flex-col overflow-hidden'>
      {/* Breadcrumb with primary actions above the separator */}
      <PageBreadcrumb
        title={intl.formatMessage({ id: 'sidebar.projects' })}
        actions={
          <div className='flex items-center gap-2'>
            {/* Search-as-you-type: arrow keys / Enter bubble from the input to
                the <Command>, which drives the highlighted project. */}
            <Command
              shouldFilter={false}
              className='h-auto w-56 overflow-visible rounded-none bg-transparent text-inherit'
            >
              <Popover
                open={open && !!query.trim()}
                onOpenChange={next => {
                  if (!next) setOpen(false)
                }}
              >
                <PopoverAnchor asChild>
                  <div ref={searchRef}>
                    <SearchInput
                      value={query}
                      onChange={v => {
                        setQuery(v)
                        setOpen(true)
                      }}
                      onFocus={() => setOpen(true)}
                      placeholder={intl.formatMessage({
                        id: 'projects.searchPlaceholder',
                      })}
                    />
                  </div>
                </PopoverAnchor>
                <PopoverContent
                  align='start'
                  className='w-[var(--radix-popover-trigger-width)] p-1'
                  onOpenAutoFocus={e => e.preventDefault()}
                  onCloseAutoFocus={e => e.preventDefault()}
                  onMouseDown={e => e.preventDefault()}
                  onInteractOutside={e => {
                    if (searchRef.current?.contains(e.target as Node))
                      e.preventDefault()
                  }}
                >
                  <CommandList>
                    {filtered.length === 0 ? (
                      <p className='px-2 py-1.5 text-caption text-muted-foreground'>
                        {intl.formatMessage({ id: 'projects.searchNoMatch' })}
                      </p>
                    ) : (
                      filtered.map(p => (
                        <CommandItem
                          key={p.id}
                          value={p.id}
                          onSelect={() => {
                            setQuery('')
                            setOpen(false)
                            onSelectProject(p)
                          }}
                          className='justify-between text-caption'
                        >
                          <span className='truncate'>{p.name}</span>
                          {p.isIdea && (
                            <span className={`shrink-0 ${IDEA_BADGE_CLS}`}>
                              {intl.formatMessage({
                                id: 'projects.draftBadge',
                              })}
                            </span>
                          )}
                        </CommandItem>
                      ))
                    )}
                  </CommandList>
                </PopoverContent>
              </Popover>
            </Command>
            <Button onClick={onNewProject} size='sm' className='gap-1.5'>
              <Plus size={14} />
              {intl.formatMessage({ id: 'projects.create' })}
            </Button>
          </div>
        }
      />

      {/* Spacer — matches the h-12 toolbar in MyTasksPage so empty state aligns.
          Doubles as the host slot for the bulk-selection bar (absolute overlay
          so it never pushes the table headers down). */}
      <div className='h-12 shrink-0 relative'>
        {selectedCount > 0 && (
          <div className='absolute inset-0 z-sticky flex items-center justify-between gap-3 bg-muted border-b border-border px-6'>
            <span className='text-caption text-foreground'>
              {intl.formatMessage(
                { id: 'common.selected' },
                { count: selectedCount }
              )}
            </span>
            <div className='flex items-center gap-2'>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => setSelected(new Set())}
              >
                {intl.formatMessage({ id: 'common.cancel' })}
              </Button>
              <Button
                variant='destructive'
                size='sm'
                className='gap-1.5'
                onClick={() => setConfirmOpen(true)}
              >
                <Trash2 size={14} />
                {intl.formatMessage(
                  { id: 'projects.bulkDelete.button' },
                  { count: selectedCount }
                )}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Body */}
      <div className='flex-1 overflow-auto'>
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
                <EmptyTitle>
                  {intl.formatMessage({ id: 'projects.empty.title' })}
                </EmptyTitle>
                <EmptyDescription>
                  {intl.formatMessage({ id: 'projects.empty.description' })}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={onNewProject}>
                  <Plus size={16} />
                  {intl.formatMessage({ id: 'projects.create' })}
                </Button>
              </EmptyContent>
            </Empty>
          }
        >
          <table className='w-full border-collapse'>
            <thead className='sticky top-0 bg-card z-sticky'>
              <tr>
                <th className='py-3 px-4 w-10 text-center'>
                  <Checkbox
                    checked={headerCheckboxState}
                    onCheckedChange={toggleAll}
                    aria-label={intl.formatMessage({
                      id: 'projects.selectAll',
                    })}
                  />
                </th>
                <SortableHeader
                  col='name'
                  label={intl.formatMessage({ id: 'projects.column.name' })}
                  sort={sort}
                  onToggle={toggle}
                  className='text-center py-3 px-6'
                  tooltip={intl.formatMessage({
                    id: 'projects.tooltip.name',
                    defaultMessage:
                      'Project name. Sort to find a specific project.',
                  })}
                />
                <SortableHeader
                  col='tasks'
                  label={intl.formatMessage({ id: 'projects.column.tasks' })}
                  sort={sort}
                  onToggle={toggle}
                  className='text-center py-3 px-6 w-24'
                  tooltip={intl.formatMessage({
                    id: 'projects.tooltip.tasks',
                    defaultMessage: 'Total task count in this project.',
                  })}
                />
                <SortableHeader
                  col='todo'
                  label={intl.formatMessage({ id: 'projects.column.todo' })}
                  sort={sort}
                  onToggle={toggle}
                  className='text-center py-3 px-6 w-24'
                  tooltip={intl.formatMessage({
                    id: 'projects.tooltip.todo',
                    defaultMessage: 'Tasks not yet started.',
                  })}
                />
                <SortableHeader
                  col='inProgress'
                  label={intl.formatMessage({
                    id: 'projects.column.inProgress',
                  })}
                  sort={sort}
                  onToggle={toggle}
                  className='text-center py-3 px-6 w-28'
                  tooltip={intl.formatMessage({
                    id: 'projects.tooltip.inProgress',
                    defaultMessage: 'Tasks currently being worked on.',
                  })}
                />
                <SortableHeader
                  col='inReview'
                  label={intl.formatMessage({ id: 'projects.column.inReview' })}
                  sort={sort}
                  onToggle={toggle}
                  className='text-center py-3 px-6 w-28'
                  tooltip={intl.formatMessage({
                    id: 'projects.tooltip.inReview',
                    defaultMessage: 'Tasks waiting for review.',
                  })}
                />
                <SortableHeader
                  col='done'
                  label={intl.formatMessage({ id: 'projects.column.done' })}
                  sort={sort}
                  onToggle={toggle}
                  className='text-center py-3 px-6 w-24'
                  tooltip={intl.formatMessage({
                    id: 'projects.tooltip.done',
                    defaultMessage: 'Completed tasks.',
                  })}
                />
                <SortableHeader
                  col='owner'
                  label={intl.formatMessage({
                    id: 'project.owner',
                    defaultMessage: 'Owner',
                  })}
                  sort={sort}
                  onToggle={toggle}
                  className='text-center py-3 px-6 w-32'
                  tooltip={intl.formatMessage({
                    id: 'projects.tooltip.owner',
                    defaultMessage:
                      'Project owner — primary contact for this project.',
                  })}
                />
                <SortableHeader
                  col='updatedAt'
                  label={intl.formatMessage({ id: 'common.updated' })}
                  sort={sort}
                  onToggle={toggle}
                  className='text-center py-3 px-6'
                  tooltip={intl.formatMessage({
                    id: 'projects.tooltip.updated',
                    defaultMessage: 'Most recent activity timestamp.',
                  })}
                />
              </tr>
            </thead>
            <tbody className='divide-y divide-border'>
              {sorted.map(project => (
                <tr
                  key={project.id}
                  onClick={() => onSelectProject(project)}
                  className='hover:bg-muted transition-colors cursor-pointer group'
                >
                  <td
                    className='py-4 px-4 border-b border-border text-center'
                    onClick={e => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={selected.has(project.id)}
                      onCheckedChange={() => toggleOne(project.id)}
                      aria-label={intl.formatMessage(
                        { id: 'projects.selectOne' },
                        { name: project.name }
                      )}
                    />
                  </td>
                  <td className='py-4 px-6 border-b border-border'>
                    <div className='flex items-center justify-center gap-3'>
                      <span className='text-body-strong text-foreground group-hover:text-info-text transition-colors'>
                        {project.name}
                      </span>
                      {project.isIdea && (
                        <span className={IDEA_BADGE_CLS}>
                          {intl.formatMessage({ id: 'projects.draftBadge' })}
                        </span>
                      )}
                      {/* LUM-1285: the sidebar hides archived projects; this
                          page is where they stay reachable. */}
                      {project.archivedAt && (
                        <Badge variant='muted' size='sm'>
                          {intl.formatMessage({ id: 'project.archivedBadge' })}
                        </Badge>
                      )}
                      {project.status && project.status !== 'ACTIVE' && (
                        <Badge variant='outline-muted' size='sm'>
                          {intl.formatMessage({
                            id: PROJECT_STATUS_LABEL_ID[project.status],
                          })}
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className='py-4 px-6 border-b border-border text-center'>
                    <Badge variant='muted' size='sm'>
                      {project._count.tasks}
                    </Badge>
                  </td>
                  <StatusCell count={project.todoCount} status='TODO' />
                  <StatusCell
                    count={project.inProgressCount}
                    status='IN_PROGRESS'
                  />
                  <StatusCell
                    count={project.inReviewCount}
                    status='IN_REVIEW'
                  />
                  <StatusCell count={project.doneCount} status='DONE' />
                  <td className='py-4 px-6 border-b border-border text-caption text-foreground text-center'>
                    {project.owner?.name ?? '—'}
                  </td>
                  <td className='py-4 px-6 text-center text-muted-foreground text-caption border-b border-border'>
                    <div className='flex items-center justify-center gap-2'>
                      <span>
                        {new Date(project.updatedAt).toLocaleDateString()}
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            className='size-6 flex items-center justify-center rounded-sm hover:bg-muted text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100'
                            onClick={e => {
                              e.stopPropagation()
                              copyLink(
                                `${window.location.origin}/workspace/${workspaceUrl}/projects/${slugify(project.name)}`
                              )
                            }}
                          >
                            <LinkIcon size={12} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {intl.formatMessage({ id: 'projects.copyLink' })}
                        </TooltipContent>
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
              {intl.formatMessage(
                { id: 'projects.bulkDelete.confirmTitle' },
                { count: selectedCount }
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage(
                { id: 'projects.bulkDelete.confirmDesc' },
                { count: selectedCount }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {intl.formatMessage({ id: 'common.cancel' })}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={runBulkDelete}
              variant='destructive'
            >
              {deleting
                ? intl.formatMessage({ id: 'common.deleting' })
                : intl.formatMessage({ id: 'common.delete' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

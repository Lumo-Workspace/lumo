'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { Search, Plus, Layers } from 'lucide-react'
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
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

type ProjectSortKey = 'name' | 'tasks' | 'inProgress' | 'updatedAt'

interface ProjectsPageProps {
  projects: ApiProject[]
  loading: boolean
  error: string | null
  onRetry: () => void
  onSelectProject: (project: ApiProject) => void
  onNewProject: () => void
}

export function ProjectsPage({
  projects,
  loading,
  error,
  onRetry,
  onSelectProject,
  onNewProject,
}: ProjectsPageProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const { sort, toggle } = useTableSort<ProjectSortKey>('updatedAt', 'desc')

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
        case 'inProgress':
          return applyDir(
            cmpNumber(a.inProgressCount, b.inProgressCount),
            sort.dir
          )
        case 'updatedAt':
          return applyDir(cmpDate(a.updatedAt, b.updatedAt), sort.dir)
        default:
          return 0
      }
    })
  }, [projects, sort])

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
      <div className='px-8 pt-6 mb-3'>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Projects</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* Header */}
      <header className='h-14 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-6 shrink-0'>
        <h2 className='text-sm font-semibold'>Projects</h2>
        <div className='flex items-center gap-4'>
          <div className='relative w-64' ref={searchRef}>
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
                    <button
                      key={p.id}
                      className='w-full text-left px-3 py-2.5 text-xs text-zinc-900 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors flex items-center justify-between gap-2'
                      onMouseDown={() => {
                        setQuery('')
                        setOpen(false)
                        onSelectProject(p)
                      }}
                    >
                      <span className='font-medium truncate'>{p.name}</span>
                      {p.isIdea && (
                        <span className='shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800'>
                          Draft
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <button
            onClick={onNewProject}
            className='bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium px-3 py-1.5 rounded-md hover:opacity-90 transition-opacity flex items-center gap-1.5'
          >
            <Plus size={14} />
            New Project
          </button>
        </div>
      </header>

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
                <EmptyTitle>No projects yet</EmptyTitle>
                <EmptyDescription>
                  Create your first project to start organizing tasks.
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
                  className='text-left py-3 px-6 w-28'
                />
                <SortableHeader
                  col='inProgress'
                  label='In Progress'
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
                  <td className='py-4 px-6 border-b border-zinc-200 dark:border-zinc-800'>
                    <div className='flex items-center gap-3'>
                      <span className='font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors'>
                        {project.name}
                      </span>
                      {project.isIdea && (
                        <span className='text-[10px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 font-medium border border-amber-200 dark:border-amber-800'>
                          Draft
                        </span>
                      )}
                    </div>
                    {project.description && (
                      <p className='text-xs text-zinc-400 mt-0.5 truncate max-w-xs'>
                        {project.description}
                      </p>
                    )}
                  </td>
                  <td className='py-4 px-6 border-b border-zinc-200 dark:border-zinc-800'>
                    <span className='px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[11px] font-medium text-zinc-600 dark:text-zinc-400'>
                      {project._count.tasks} tasks
                    </span>
                  </td>
                  <td className='py-4 px-6 border-b border-zinc-200 dark:border-zinc-800'>
                    <div className='flex items-center gap-2'>
                      <div className='size-2 rounded-full bg-blue-500' />
                      <span className='text-xs text-zinc-700 dark:text-zinc-300'>
                        {project.inProgressCount} in progress
                      </span>
                    </div>
                  </td>
                  <td className='py-4 px-6 text-right text-zinc-500 dark:text-zinc-400 text-xs border-b border-zinc-200 dark:border-zinc-800'>
                    {new Date(project.updatedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AsyncContent>
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { useIntl } from 'react-intl'
import { FileEdit, Trash2, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatTimestamp } from '../utils'
import type { ApiDraft, ApiProject, ApiPriority } from '../types'
import { PRIORITY_CONFIG } from './TaskFieldSelects'
import { API_STATUS_LABEL } from '../utils'

interface DraftsPageProps {
  drafts: ApiDraft[]
  ideaProjects: ApiProject[]
  onRestoreTaskDraft: (draft: ApiDraft) => void
  onRestoreProjectDraft: (draft: ApiDraft) => void
  onOpenIdeaProject: (project: ApiProject) => void
  onDeleteDraft: (id: string) => void
  loading: boolean
}

export function DraftsPage({
  drafts,
  ideaProjects,
  onRestoreTaskDraft,
  onRestoreProjectDraft,
  onOpenIdeaProject,
  onDeleteDraft,
  loading,
}: DraftsPageProps) {
  const intl = useIntl()
  const [activeTab, setActiveTab] = useState<'tasks' | 'projects'>('tasks')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const taskDrafts = drafts.filter(d => d.type === 'TASK')
  const projectDrafts = drafts.filter(d => d.type === 'PROJECT')

  const handleDelete = (id: string) => {
    if (confirmDeleteId === id) {
      onDeleteDraft(id)
      setConfirmDeleteId(null)
    } else {
      setConfirmDeleteId(id)
    }
  }

  // Reset confirm state after 3 seconds
  useEffect(() => {
    if (confirmDeleteId) {
      const timer = setTimeout(() => setConfirmDeleteId(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [confirmDeleteId])

  const tabCls = (active: boolean) =>
    `px-4 py-2 text-sm font-medium rounded-md transition-colors ${
      active
        ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
    }`

  return (
    <div className='flex-1 overflow-y-auto p-6'>
      <div className='max-w-3xl mx-auto'>
        {/* Header */}
        <div className='flex items-center gap-3 mb-6'>
          <FileEdit className='size-6 text-zinc-400' />
          <h1 className='text-2xl font-bold text-zinc-900 dark:text-zinc-100'>
            {intl.formatMessage({ id: 'drafts.title' })}
          </h1>
        </div>

        {/* Tabs */}
        <div className='flex gap-1 mb-6'>
          <button
            className={tabCls(activeTab === 'tasks')}
            onClick={() => setActiveTab('tasks')}
          >
            {intl.formatMessage({ id: 'drafts.tabTasks' })}
            {taskDrafts.length > 0 && (
              <span className='ml-1.5 text-xs text-zinc-400'>
                {taskDrafts.length}
              </span>
            )}
          </button>
          <button
            className={tabCls(activeTab === 'projects')}
            onClick={() => setActiveTab('projects')}
          >
            {intl.formatMessage({ id: 'drafts.tabProjects' })}
            {projectDrafts.length + ideaProjects.length > 0 && (
              <span className='ml-1.5 text-xs text-zinc-400'>
                {projectDrafts.length + ideaProjects.length}
              </span>
            )}
          </button>
        </div>

        {/* Task Drafts */}
        {activeTab === 'tasks' && (
          <div className='space-y-2'>
            {taskDrafts.length === 0 ? (
              <EmptyState intl={intl} />
            ) : (
              taskDrafts.map(draft => (
                <DraftCard
                  key={draft.id}
                  title={
                    (draft.data as Record<string, unknown>).title as
                      | string
                      | undefined
                  }
                  subtitle={getDraftSubtitle(draft)}
                  updatedAt={draft.updatedAt}
                  confirmDelete={confirmDeleteId === draft.id}
                  onClick={() => onRestoreTaskDraft(draft)}
                  onDelete={() => handleDelete(draft.id)}
                  intl={intl}
                />
              ))
            )}
          </div>
        )}

        {/* Project Drafts */}
        {activeTab === 'projects' && (
          <div className='space-y-2'>
            {projectDrafts.length === 0 && ideaProjects.length === 0 ? (
              <EmptyState intl={intl} />
            ) : (
              <>
                {projectDrafts.map(draft => (
                  <DraftCard
                    key={draft.id}
                    title={
                      (draft.data as Record<string, unknown>).name as
                        | string
                        | undefined
                    }
                    subtitle={
                      (draft.data as Record<string, unknown>).description as
                        | string
                        | undefined
                    }
                    updatedAt={draft.updatedAt}
                    confirmDelete={confirmDeleteId === draft.id}
                    onClick={() => onRestoreProjectDraft(draft)}
                    onDelete={() => handleDelete(draft.id)}
                    intl={intl}
                  />
                ))}
                {ideaProjects.map(project => (
                  <div
                    key={project.id}
                    className='group flex items-center gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors'
                    onClick={() => onOpenIdeaProject(project)}
                  >
                    <div className='flex-1 min-w-0'>
                      <p className='text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate'>
                        {project.name}
                      </p>
                      <p className='text-xs text-amber-600 dark:text-amber-400 mt-0.5'>
                        Idea project
                      </p>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function DraftCard({
  title,
  subtitle,
  updatedAt,
  confirmDelete,
  onClick,
  onDelete,
  intl,
}: {
  title: string | undefined
  subtitle: string | undefined
  updatedAt: string
  confirmDelete: boolean
  onClick: () => void
  onDelete: () => void
  intl: ReturnType<typeof useIntl>
}) {
  return (
    <div
      className='group flex items-center gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors'
      onClick={onClick}
    >
      <div className='flex-1 min-w-0'>
        <p className='text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate'>
          {title || intl.formatMessage({ id: 'drafts.untitled' })}
        </p>
        {subtitle && (
          <p className='text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate'>
            {subtitle}
          </p>
        )}
      </div>
      <div className='flex items-center gap-2'>
        <span className='flex items-center gap-1 text-xs text-zinc-400'>
          <Clock className='size-3' />
          {formatTimestamp(updatedAt)}
        </span>
        <Button
          variant='ghost'
          size='sm'
          className={`h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity ${
            confirmDelete
              ? 'text-red-600 dark:text-red-400 opacity-100'
              : 'text-zinc-400 hover:text-red-600 dark:hover:text-red-400'
          }`}
          onClick={e => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 className='size-3.5' />
        </Button>
      </div>
    </div>
  )
}

function EmptyState({ intl }: { intl: ReturnType<typeof useIntl> }) {
  return (
    <div className='flex flex-col items-center justify-center py-16 text-center'>
      <FileEdit className='size-12 text-zinc-200 dark:text-zinc-700 mb-4' />
      <p className='text-sm font-medium text-zinc-500 dark:text-zinc-400'>
        {intl.formatMessage({ id: 'drafts.empty' })}
      </p>
      <p className='text-xs text-zinc-400 dark:text-zinc-500 mt-1 max-w-xs'>
        {intl.formatMessage({ id: 'drafts.emptyDescription' })}
      </p>
    </div>
  )
}

function getDraftSubtitle(draft: ApiDraft): string | undefined {
  const data = draft.data as Record<string, unknown>
  const parts: string[] = []
  if (data.priority && typeof data.priority === 'string') {
    const config = PRIORITY_CONFIG[data.priority as ApiPriority]
    parts.push(config ? config.label : data.priority)
  }
  if (data.status && typeof data.status === 'string') {
    const label = API_STATUS_LABEL[data.status]
    parts.push(label ?? data.status)
  }
  return parts.length > 0 ? parts.join(' \u00b7 ') : undefined
}

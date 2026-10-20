'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { FileEdit, Trash2, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
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
import { useFormatDate } from '../hooks/useFormatDate'
import type { ApiDraft, ApiProject, ApiPriority } from '../types'
import { PRIORITY_CONFIG } from './fields'
import { API_STATUS_LABEL } from '../utils'
import { PageBreadcrumb } from './PageBreadcrumb'

interface DraftsPageProps {
  drafts: ApiDraft[]
  ideaProjects: ApiProject[]
  onRestoreTaskDraft: (draft: ApiDraft) => void
  onRestoreProjectDraft: (draft: ApiDraft) => void
  onOpenIdeaProject: (project: ApiProject) => void
  onDeleteDraft: (id: string) => void
}

export function DraftsPage({
  drafts,
  ideaProjects,
  onRestoreTaskDraft,
  onRestoreProjectDraft,
  onOpenIdeaProject,
  onDeleteDraft,
}: DraftsPageProps) {
  const intl = useIntl()
  const [activeTab, setActiveTab] = useState<'tasks' | 'projects'>('tasks')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const taskDrafts = drafts.filter(d => d.type === 'TASK')
  const projectDrafts = drafts.filter(d => d.type === 'PROJECT')

  const confirmDelete = () => {
    if (pendingDeleteId) {
      onDeleteDraft(pendingDeleteId)
      setPendingDeleteId(null)
    }
  }

  const tabCls = (active: boolean) =>
    `px-4 py-2 text-body-strong rounded-md transition-colors ${
      active
        ? 'bg-muted text-foreground'
        : 'text-muted-foreground hover:text-foreground'
    }`

  return (
    <div className='flex-1 flex flex-col overflow-hidden'>
      <PageBreadcrumb title={intl.formatMessage({ id: 'drafts.title' })} />
      <div className='flex-1 overflow-y-auto p-6'>
        <div className='max-w-3xl'>
          {/* Tabs */}
          <div className='flex gap-1 mb-6'>
            <button
              className={tabCls(activeTab === 'tasks')}
              onClick={() => setActiveTab('tasks')}
            >
              {intl.formatMessage({ id: 'drafts.tabTasks' })}
              {taskDrafts.length > 0 && (
                <span className='ml-1.5 text-caption text-muted-foreground'>
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
                <span className='ml-1.5 text-caption text-muted-foreground'>
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
                    onClick={() => onRestoreTaskDraft(draft)}
                    onDelete={() => setPendingDeleteId(draft.id)}
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
                      onClick={() => onRestoreProjectDraft(draft)}
                      onDelete={() => setPendingDeleteId(draft.id)}
                      intl={intl}
                    />
                  ))}
                  {ideaProjects.map(project => (
                    <div
                      key={project.id}
                      className='group flex items-center gap-3 rounded-lg border border-border p-4 cursor-pointer hover:bg-muted transition-colors'
                      onClick={() => onOpenIdeaProject(project)}
                    >
                      <div className='flex-1 min-w-0'>
                        <p className='text-body-strong text-foreground truncate'>
                          {project.name}
                        </p>
                        <p className='text-caption text-warning-text mt-0.5'>
                          {intl.formatMessage({ id: 'drafts.ideaProject' })}
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

      {/* Delete confirmation */}
      <AlertDialog
        open={!!pendingDeleteId}
        onOpenChange={open => !open && setPendingDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({
                id: 'drafts.deleteConfirmTitle',
                defaultMessage: 'Delete draft?',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({
                id: 'drafts.deleteConfirmDesc',
                defaultMessage:
                  'This draft will be permanently removed. This action cannot be undone.',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {intl.formatMessage({
                id: 'common.cancel',
                defaultMessage: 'Cancel',
              })}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} variant='destructive'>
              {intl.formatMessage({
                id: 'common.delete',
                defaultMessage: 'Delete',
              })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function DraftCard({
  title,
  subtitle,
  updatedAt,
  onClick,
  onDelete,
  intl,
}: {
  title: string | undefined
  subtitle: string | undefined
  updatedAt: string
  onClick: () => void
  onDelete: () => void
  intl: ReturnType<typeof useIntl>
}) {
  const { fmtTimestamp } = useFormatDate()
  return (
    <div
      className='group flex items-center gap-3 rounded-lg border border-border p-4 cursor-pointer hover:bg-muted transition-colors'
      onClick={onClick}
    >
      <div className='flex-1 min-w-0'>
        <p className='text-body-strong text-foreground truncate'>
          {title || intl.formatMessage({ id: 'drafts.untitled' })}
        </p>
        {subtitle && (
          <p className='text-caption text-muted-foreground mt-0.5 truncate'>
            {subtitle}
          </p>
        )}
      </div>
      <div className='flex items-center gap-2'>
        <span className='flex items-center gap-1 text-caption text-muted-foreground'>
          <Clock className='size-3' />
          {fmtTimestamp(updatedAt)}
        </span>
        <Button
          variant='ghost'
          size='sm'
          className='h-7 w-7 p-0 text-muted-foreground hover:text-danger-text hover:bg-danger-subtle'
          onClick={e => {
            e.stopPropagation()
            onDelete()
          }}
          aria-label={intl.formatMessage({
            id: 'drafts.deleteAction',
            defaultMessage: 'Delete draft',
          })}
        >
          <Trash2 className='size-3.5' />
        </Button>
      </div>
    </div>
  )
}

function EmptyState({ intl }: { intl: ReturnType<typeof useIntl> }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <FileEdit />
        </EmptyMedia>
        <EmptyTitle>{intl.formatMessage({ id: 'drafts.empty' })}</EmptyTitle>
        <EmptyDescription>
          {intl.formatMessage({ id: 'drafts.emptyDescription' })}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
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

'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { GitPullRequest } from 'lucide-react'
import { useParams } from 'next/navigation'
import { queryKeys } from '@/lib/query/keys'
import {
  TaskDetail,
  ApiTask,
  MyTask,
  ApiStatus,
  ApiPriority,
  WorkspaceMemberInfo,
  ApiProject,
} from '../types'
import { DescriptionEditor } from './DescriptionEditorLazy'
import { useMentionSources } from '../hooks/useMentionSources'
import { AiDescriptionPrompt } from './AiDescriptionPrompt'
import { TypographyH3 } from '@/components/ui/typography'
import { Spinner } from '@/components/ui/spinner'
// AgentPanel hidden — agent features disabled for now
import { useCurrentUser } from '../hooks/useCurrentUser'
import { PrStateBadge, CiIcon } from './pr-helpers'
import { useTaskComments } from '../hooks/useTaskComments'
import { useTaskMutation } from '../hooks/useTaskMutation'
import { useTaskDescription } from '../hooks/useTaskDescription'
import { useTaskSync } from '../hooks/useTaskSync'
import { TaskFieldsSection } from './TaskFieldsSection'
import { CommentSection } from './CommentSection'

// ─── TaskDetailPanel ──────────────────────────────────────────────────────────

export interface TaskDetailPanelProps {
  initialTask: ApiTask | MyTask
  cachedDescription?: string | null | undefined
  members: WorkspaceMemberInfo[]
  agentActors?:
    | { actorId: string; name: string; avatarColor: string }[]
    | undefined
  projects: ApiProject[]
  onUpdate: (
    taskId: string,
    data: Partial<{
      title: string
      status: ApiStatus
      assigneeActorId: string | null
      description: string | null
      projectId: string
      priority: ApiPriority
      dueDate: string | null
    }>
  ) => Promise<void>
  onDescriptionLoaded?:
    | ((taskId: string, description: string | null) => void)
    | undefined
}

export function TaskDetailPanel({
  initialTask,
  cachedDescription,
  members,
  agentActors,
  projects,
  onUpdate,
  onDescriptionLoaded,
}: TaskDetailPanelProps) {
  // Build a TaskDetail-shaped seed from the list-level initialTask. Memoized
  // so the seed is stable across renders even though initialTask might be a
  // fresh object each parent render.
  const [seed] = useState<TaskDetail>(() => ({
    id: initialTask.id,
    title: initialTask.title,
    status: initialTask.status,
    priority: initialTask.priority,
    projectId: initialTask.projectId,
    project:
      'project' in initialTask && initialTask.project
        ? initialTask.project
        : { id: initialTask.projectId, name: '' },
    assigneeActorId: initialTask.assigneeActorId,
    assignee: initialTask.assignee ?? null,
    description: cachedDescription ?? null,
    dueDate: initialTask.dueDate ?? null,
    updatedAt: initialTask.updatedAt,
    number: initialTask.number,
    teamIdentifier: initialTask.teamIdentifier,
    parent: 'parent' in initialTask ? (initialTask.parent ?? null) : null,
    ...(initialTask.teamId !== undefined ? { teamId: initialTask.teamId } : {}),
    sprintId: initialTask.sprintId ?? null,
    sprint: initialTask.sprint ?? null,
    // sprintsEnabled is not present on ApiTask/MyTask — populated when the
    // task detail fetch in useTaskSync spreads the full TaskDetail response.
  }))

  // Read live task from per-task detail cache. Mutations and realtime updates
  // flow through setQueryData so list views and detail page stay in sync.
  const queryClient = useQueryClient()
  const taskQueryKey = queryKeys.tasks.detail(initialTask.id)
  const taskQuery = useQuery<TaskDetail>({
    queryKey: taskQueryKey,
    initialData: seed,
    enabled: false,
  })
  const task = taskQuery.data ?? seed
  const setTask = useCallback(
    (updater: TaskDetail | ((prev: TaskDetail) => TaskDetail)) => {
      queryClient.setQueryData<TaskDetail>(taskQueryKey, prev => {
        const base = prev ?? seed
        return typeof updater === 'function'
          ? (updater as (prev: TaskDetail) => TaskDetail)(base)
          : updater
      })
    },
    [queryClient, taskQueryKey, seed]
  )

  const projectName = task.project?.name ?? ''

  const { user } = useCurrentUser()
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()

  const mentionableMembers = members.filter(m => m.clerkId !== user?.id)
  const mentionSources = useMentionSources(mentionableMembers)

  // Members with actorId (non-null only) for AssigneeSelect
  const membersWithActorId = useMemo(
    () =>
      members.filter(
        (m): m is WorkspaceMemberInfo & { actorId: string } =>
          m.actorId !== null
      ),
    [members]
  )

  // Derive current member for author comparisons
  const currentMember = useMemo(
    () => members.find(m => m.clerkId === user?.id),
    [members, user?.id]
  )

  // ─── Extracted hooks ────────────────────────────────────────────────────────
  const tc = useTaskComments({
    taskId: task.id,
    currentActorId: currentMember?.actorId ?? null,
  })

  const { handlePatch } = useTaskMutation({
    task,
    setTask,
    projects,
    onExternalUpdate: onUpdate,
  })

  const desc = useTaskDescription({
    taskId: initialTask.id,
    cachedDescription,
    onDescriptionLoaded,
  })

  const { relatedDocs } = useTaskSync({
    initialTaskId: initialTask.id,
    setTask,
    onDescriptionFetched: desc.setDescriptionFromFetch,
    onLoadingDone: desc.finishLoading,
    fetchComments: tc.fetchComments,
  })

  const commitDescription = useCallback(
    (html: string | null) => {
      const next = html?.trim() || null
      if (next === (task.description ?? null)) return
      handlePatch({ description: next })
      desc.setDescriptionFromFetch(next)
    },
    [task.description, handlePatch, desc]
  )

  return (
    <div className='flex-1 overflow-y-auto px-5 py-4'>
      <div className='space-y-1'>
        {/* Title */}
        <TypographyH3
          key={task.id}
          contentEditable
          suppressContentEditableWarning
          onBlur={e => {
            const trimmed = e.currentTarget.textContent?.trim() ?? ''
            if (!trimmed || trimmed === task.title) {
              e.currentTarget.textContent = task.title
              return
            }
            handlePatch({ title: trimmed })
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
            if (e.key === 'Escape') {
              e.currentTarget.textContent = task.title
              e.currentTarget.blur()
            }
          }}
          className='mb-0 cursor-text outline-none focus:outline-none'
        >
          {task.title}
        </TypographyH3>

        {/* Status · Assignee · Project · Priority · Sprint */}
        <TaskFieldsSection
          status={task.status}
          priority={task.priority}
          assigneeActorId={task.assigneeActorId ?? null}
          projectId={task.projectId}
          dueDate={task.dueDate ?? null}
          assignee={task.assignee}
          membersWithActorId={membersWithActorId}
          agentActors={[]}
          projects={projects}
          onPatch={handlePatch}
          teamId={task.teamId ?? ''}
          sprintId={task.sprintId ?? null}
          sprint={task.sprint ?? null}
          sprintsEnabled={task.sprintsEnabled ?? false}
        />

        {task.pullRequests && task.pullRequests.length > 0 && (
          <div className='pt-3 border-t border-border'>
            <p className='text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2'>
              <GitPullRequest size={12} />
              Pull Requests
            </p>
            <ul className='space-y-2'>
              {task.pullRequests.map(pr => (
                <li key={pr.id} className='flex items-start gap-2'>
                  <CiIcon status={pr.ciStatus} />
                  <div className='min-w-0 flex-1'>
                    <a
                      href={pr.url}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='text-xs text-foreground hover:underline font-medium truncate block'
                    >
                      #{pr.number} {pr.title}
                    </a>
                    <div className='flex items-center gap-1.5 mt-0.5'>
                      <PrStateBadge state={pr.state} />
                      <span className='text-[10px] text-muted-foreground font-mono truncate'>
                        {pr.headBranch}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Agent Panel hidden — agent features disabled for now */}

        {/* Description */}
        <div className='pt-4'>
          {desc.descriptionLoading ? (
            <Spinner className='size-4 text-muted-foreground' />
          ) : (
            <>
              {!task.description && (
                <div className='mb-2'>
                  <AiDescriptionPrompt
                    title={task.title}
                    projectId={task.projectId}
                    workspaceUrl={workspaceUrl}
                    existingDescription={null}
                    onAccept={html => {
                      handlePatch({ description: html })
                      desc.setDescriptionFromFetch(html)
                    }}
                  />
                </div>
              )}
              <DescriptionEditor
                value={desc.descriptionValue}
                onCommit={commitDescription}
                mentionSources={mentionSources}
              />
              {task.description && (
                <div className='mt-1 flex justify-end'>
                  <AiDescriptionPrompt
                    title={task.title}
                    projectId={task.projectId}
                    workspaceUrl={workspaceUrl}
                    existingDescription={task.description}
                    onAccept={html => {
                      handlePatch({ description: html })
                      desc.setDescriptionFromFetch(html)
                    }}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* Related Documents */}
        {relatedDocs.length > 0 && (
          <div className='mt-4 pt-4 border-t'>
            <div className='text-xs font-medium text-muted-foreground mb-2'>
              Related Documents
            </div>
            <div className='space-y-1'>
              {relatedDocs.map(doc => (
                <button
                  key={doc.id}
                  type='button'
                  className='flex items-center gap-2 w-full text-left text-xs py-1 px-2 rounded-sm hover:bg-muted transition-colors'
                  onClick={() => {
                    window.location.href = `/workspace/${workspaceUrl}/documents/${doc.slug}`
                  }}
                >
                  <span>{doc.emoji ?? '📄'}</span>
                  <span className='truncate'>{doc.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Comments ─────────────────────────────────────────────────────────── */}
      <CommentSection
        workspaceUrl={workspaceUrl}
        projectName={projectName}
        teamIdentifier={task.teamIdentifier}
        taskNumber={task.number}
        members={members}
        mentionableMembers={mentionableMembers}
        agentActors={agentActors}
        currentActorId={currentMember?.actorId}
        user={user}
        tc={tc}
      />
    </div>
  )
}

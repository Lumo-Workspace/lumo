'use client'

import { useState, useCallback, useMemo } from 'react'
import { GitPullRequest, GitBranch } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { slugify } from '@/lib/utils/slugify'
import {
  TaskDetail,
  ApiTask,
  MyTask,
  ApiStatus,
  ApiPriority,
  WorkspaceMemberInfo,
  ApiProject,
} from '../types'
import { DescriptionEditor } from './DescriptionEditor'
import { AiDescriptionPrompt } from './AiDescriptionPrompt'
import { TypographyH3 } from '@/components/ui/typography'
import { Spinner } from '@/components/ui/spinner'
import { AgentPanel } from '@/components/task/AgentPanel'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { CreateBranchDialog } from './CreateBranchDialog'
import { PrStateBadge, CiIcon } from './pr-helpers'
import { SubtasksSection } from './SubtasksSection'
import { useTaskComments } from '../hooks/useTaskComments'
import { useTaskMutation } from '../hooks/useTaskMutation'
import { useTaskDescription } from '../hooks/useTaskDescription'
import { useTaskSync } from '../hooks/useTaskSync'
import { TaskFieldsSection } from './TaskFieldsSection'
import { CommentSection } from './CommentSection'

// ─── TaskDetailPanel ──────────────────────────────────────────────────────────

export interface TaskDetailPanelProps {
  initialTask: ApiTask | MyTask
  /** Live task from the normalized store — used to sync external updates (drag, etc.) */
  liveTask?: ApiTask
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
      reviewerActorId: string | null
      description: string | null
      projectId: string
      priority: ApiPriority
      dueDate: string | null
    }>
  ) => Promise<void>
  onDescriptionLoaded?:
    | ((taskId: string, description: string | null) => void)
    | undefined
  onTasksChanged?: (() => void) | undefined
  tasks?: ApiTask[]
}

export function TaskDetailPanel({
  initialTask,
  liveTask,
  cachedDescription,
  members,
  agentActors,
  projects,
  onUpdate,
  onDescriptionLoaded,
  onTasksChanged,
  tasks = [],
}: TaskDetailPanelProps) {
  const [task, setTask] = useState<TaskDetail>(() => ({
    id: initialTask.id,
    title: initialTask.title,
    status: initialTask.status,
    priority: initialTask.priority,
    projectId: initialTask.projectId,
    project:
      'project' in initialTask && initialTask.project
        ? initialTask.project
        : { id: initialTask.projectId, name: '' },
    parentTaskId: initialTask.parentTaskId,
    assigneeActorId: initialTask.assigneeActorId,
    reviewerActorId: initialTask.reviewerActorId,
    assignee: initialTask.assignee ?? null,
    reviewer: null,
    description: cachedDescription ?? null,
    dueDate: initialTask.dueDate ?? null,
    updatedAt: initialTask.updatedAt,
    number: initialTask.number,
    teamIdentifier: initialTask.teamIdentifier,
    repositoryId:
      'repositoryId' in initialTask ? (initialTask.repositoryId ?? null) : null,
    parent: 'parent' in initialTask ? (initialTask.parent ?? null) : null,
    ...(initialTask.teamId !== undefined ? { teamId: initialTask.teamId } : {}),
    sprintId: initialTask.sprintId ?? null,
    sprint: initialTask.sprint ?? null,
    // sprintsEnabled is not present on ApiTask/MyTask — populated when the
    // task detail fetch in useTaskSync spreads the full TaskDetail response.
  }))

  const projectName = task.project?.name ?? ''
  const projectDefaultReviewerId = task.project?.ownerId ?? null
  const projectRepositories = task.project?.repositories

  const { user } = useCurrentUser()
  const router = useRouter()
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()

  const navigateToParent = useCallback(() => {
    const parent = task.parent
    if (!parent) return
    const parentIdentifier = `${parent.teamIdentifier}-${parent.number}`
    const projectSlug = slugify(projectName)
    router.push(
      `/workspace/${workspaceUrl}/project/${projectSlug}/tasks/${parentIdentifier}`
    )
  }, [task.parent, projectName, workspaceUrl, router])

  const mentionableMembers = members.filter(m => m.clerkId !== user?.id)

  // Members with actorId (non-null only) for AssigneeSelect / ReviewerSelect
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

  const { relatedDocs, refreshDetail } = useTaskSync({
    initialTaskId: initialTask.id,
    liveTask,
    setTask,
    onDescriptionFetched: desc.setDescriptionFromFetch,
    onLoadingDone: desc.finishLoading,
    onTasksChanged,
    fetchComments: tc.fetchComments,
  })

  const [createBranchOpen, setCreateBranchOpen] = useState(false)

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
        {/* Parent breadcrumb */}
        {task.parent && (
          <button
            onClick={navigateToParent}
            className='flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 mb-1 transition-colors'
          >
            <span>↑</span>
            <span>
              {task.parent.teamIdentifier}-{task.parent.number}{' '}
              {task.parent.title}
            </span>
          </button>
        )}
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

        {/* Status · Assignee · Reviewer · Project · Priority · Sprint */}
        <TaskFieldsSection
          status={task.status}
          priority={task.priority}
          assigneeActorId={task.assigneeActorId ?? null}
          reviewerActorId={task.reviewerActorId ?? null}
          projectId={task.projectId}
          dueDate={task.dueDate ?? null}
          assignee={task.assignee}
          ownerId={projectDefaultReviewerId}
          parent={task.parent}
          membersWithActorId={membersWithActorId}
          agentActors={agentActors ?? []}
          projects={projects}
          onPatch={handlePatch}
          onNavigateToParent={navigateToParent}
          teamId={task.teamId ?? ''}
          sprintId={task.sprintId ?? null}
          sprint={task.sprint ?? null}
          sprintsEnabled={task.sprintsEnabled ?? false}
        />

        <div className='pt-3 border-t border-zinc-100 dark:border-zinc-800'>
          <div className='flex items-center justify-between mb-2'>
            <p className='text-xs font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider flex items-center gap-1.5'>
              <GitPullRequest size={12} />
              Pull Requests
            </p>
            <button
              onClick={() => setCreateBranchOpen(true)}
              className='flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors'
            >
              <GitBranch size={11} />
              Branch
            </button>
          </div>
          {task.pullRequests && task.pullRequests.length > 0 && (
            <ul className='space-y-2'>
              {task.pullRequests.map(pr => (
                <li key={pr.id} className='flex items-start gap-2'>
                  <CiIcon status={pr.ciStatus} />
                  <div className='min-w-0 flex-1'>
                    <a
                      href={pr.url}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='text-xs text-zinc-700 dark:text-zinc-300 hover:underline font-medium truncate block'
                    >
                      #{pr.number} {pr.title}
                    </a>
                    <div className='flex items-center gap-1.5 mt-0.5'>
                      <PrStateBadge state={pr.state} />
                      <span className='text-[10px] text-zinc-400 dark:text-zinc-500 font-mono truncate'>
                        {pr.headBranch}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {task.branches && task.branches.length > 0 && (
            <ul className='space-y-2 mt-2'>
              {task.branches.map(branch => (
                <li key={branch.id} className='flex items-start gap-2'>
                  <GitBranch
                    size={12}
                    className='text-zinc-400 shrink-0 mt-0.5'
                  />
                  <div className='min-w-0'>
                    <a
                      href={`https://github.com/${branch.repo}/tree/${branch.branchName}`}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='text-xs font-mono text-zinc-600 dark:text-zinc-400 hover:underline block truncate'
                    >
                      {branch.branchName}
                    </a>
                    {branch.lastCommitMessage && (
                      <a
                        href={
                          branch.lastCommitSha
                            ? `https://github.com/${branch.repo}/commit/${branch.lastCommitSha}`
                            : undefined
                        }
                        target='_blank'
                        rel='noopener noreferrer'
                        className='text-[10px] text-zinc-400 dark:text-zinc-500 truncate block hover:underline mt-0.5'
                        title={branch.lastCommitMessage}
                      >
                        {branch.lastCommitAuthor && (
                          <span className='font-medium'>
                            {branch.lastCommitAuthor}:{' '}
                          </span>
                        )}
                        {branch.lastCommitMessage}
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {task.assignee?.type === 'AGENT' && (
          <div className='pt-3 border-t border-zinc-100 dark:border-zinc-800'>
            <AgentPanel
              task={task}
              onTaskUpdate={updates =>
                setTask(prev => ({ ...prev, ...updates }) as TaskDetail)
              }
            />
          </div>
        )}

        <CreateBranchDialog
          isOpen={createBranchOpen}
          onClose={() => setCreateBranchOpen(false)}
          taskId={task.id}
          identifier={`${task.teamIdentifier}-${task.number}`}
          title={task.title}
          projectId={task.projectId}
          defaultRepo={
            projectRepositories?.find(r => r.isDefault)?.fullName ??
            projectRepositories?.[0]?.fullName ??
            null
          }
          workspaceUrl={workspaceUrl}
          onBranchCreated={branch =>
            setTask(prev => ({
              ...prev,
              branches: [...(prev.branches ?? []), branch],
            }))
          }
        />

        {/* Description */}
        <div className='pt-4'>
          {desc.descriptionLoading ? (
            <Spinner className='size-4 text-zinc-300 dark:text-zinc-600' />
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
                members={mentionableMembers}
                tasks={tasks}
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

        {/* Subtasks */}
        <SubtasksSection task={task} onSubtasksCreated={refreshDetail} />

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
                  className='flex items-center gap-2 w-full text-left text-xs py-1 px-2 rounded hover:bg-muted transition-colors'
                  onClick={() => {
                    window.location.href = `/workspace/${workspaceUrl}/documents/${doc.id}`
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
        tasks={tasks}
        tc={tc}
      />
    </div>
  )
}

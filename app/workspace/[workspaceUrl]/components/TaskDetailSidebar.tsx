'use client'

import { useIntl } from 'react-intl'
import {
  Check,
  Copy,
  ExternalLink,
  GitPullRequest,
  GitBranch,
} from 'lucide-react'
import type {
  TaskDetail,
  WorkspaceMemberInfo,
  ApiProject,
  ApiTag,
} from '../types'
import {
  StatusSelect,
  AssigneeSelect,
  ReviewerSelect,
  ProjectSelect,
  PrioritySelect,
  FIELD_TRIGGER_CLS,
} from './fields'
import { CreateBranchDialog } from './CreateBranchDialog'
import { PrStateBadge, CiIcon } from './pr-helpers'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TagPicker } from './document/TagPicker'
import React from 'react'

interface TaskDetailSidebarProps {
  task: TaskDetail
  members: WorkspaceMemberInfo[]
  agentActors: { actorId: string; name: string; avatarColor: string }[]
  projects: ApiProject[]
  copiedBranchId: string | null
  createBranchOpen: boolean
  setCreateBranchOpen: (open: boolean) => void
  workspaceUrl: string
  onPatch: (patch: Record<string, unknown>) => void
  onCopyBranch: (id: string, name: string) => void
  /** All workspace tags for TagPicker. */
  allTags?: ApiTag[]
  /** Called when tags change (full objects). */
  onTagsChange?: (tags: ApiTag[]) => void
  /** Called to create a new tag inline. */
  onCreateTag?: (name: string) => Promise<ApiTag | null>
}

export function TaskDetailSidebar({
  task,
  members,
  agentActors,
  projects,
  copiedBranchId,
  createBranchOpen,
  setCreateBranchOpen,
  workspaceUrl,
  onPatch,
  onCopyBranch,
  allTags,
  onTagsChange,
  onCreateTag,
}: TaskDetailSidebarProps) {
  const intl = useIntl()

  return (
    <div className='w-72 shrink-0 border-l border-zinc-100 dark:border-zinc-800 overflow-y-auto px-5 py-6 bg-zinc-50/50 dark:bg-zinc-900/30'>
      {/* Properties */}
      <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-3'>
        Properties
      </p>
      <div className='flex flex-col gap-0.5 mb-8'>
        {(
          [
            {
              label: 'Status',
              node: (
                <StatusSelect
                  value={task.status}
                  onChange={v => onPatch({ status: v })}
                  triggerClassName={FIELD_TRIGGER_CLS}
                />
              ),
            },
            {
              label: 'Assignee',
              node: (
                <AssigneeSelect
                  value={task.assigneeActorId ?? null}
                  onChange={v => onPatch({ assigneeActorId: v })}
                  members={members.filter(
                    (m): m is WorkspaceMemberInfo & { actorId: string } =>
                      m.actorId !== null
                  )}
                  agentActors={agentActors}
                  assignee={task.assignee}
                  triggerClassName={FIELD_TRIGGER_CLS}
                />
              ),
            },
            {
              label: 'Reviewer',
              node: (
                <ReviewerSelect
                  value={task.reviewerActorId ?? null}
                  onChange={v => onPatch({ reviewerActorId: v })}
                  members={members.filter(
                    (m): m is WorkspaceMemberInfo & { actorId: string } =>
                      m.actorId !== null
                  )}
                  inheritedId={task.project?.defaultReviewerId ?? null}
                  triggerClassName={FIELD_TRIGGER_CLS}
                />
              ),
            },
            {
              label: 'Project',
              node: (
                <ProjectSelect
                  value={task.projectId}
                  onChange={v => onPatch({ projectId: v })}
                  projects={projects}
                  triggerClassName={FIELD_TRIGGER_CLS}
                />
              ),
            },
            {
              label: 'Priority',
              node: (
                <PrioritySelect
                  value={task.priority}
                  onChange={v => onPatch({ priority: v })}
                  triggerClassName={FIELD_TRIGGER_CLS}
                />
              ),
            },
            ...((task.project.repositories?.length ?? 0) > 0
              ? [
                  {
                    label: 'Repository',
                    node: (
                      <Select
                        value={task.repositoryId ?? '__none__'}
                        onValueChange={v =>
                          onPatch({
                            repositoryId: v === '__none__' ? null : v,
                          })
                        }
                      >
                        <SelectTrigger className={FIELD_TRIGGER_CLS}>
                          <GitBranch size={12} className='mr-1 shrink-0' />
                          <SelectValue placeholder='Repository' />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='__none__'>
                            No repository
                          </SelectItem>
                          {task.project.repositories!.map(repo => (
                            <SelectItem key={repo.id} value={repo.id}>
                              {repo.name}
                              {repo.isDefault ? ' (default)' : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ),
                  },
                ]
              : []),
          ] as { label: string; node: React.ReactNode }[]
        ).map(({ label, node }) => (
          <div key={label} className='flex items-center gap-2 -ml-2'>
            <span className='w-16 shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500 pl-2'>
              {label}
            </span>
            <div className='flex-1 min-w-0'>{node}</div>
          </div>
        ))}
      </div>

      {/* ── Tags ──────────────────────────────────────────────────── */}
      {allTags && onTagsChange && (
        <div className='pb-3 mb-3 border-b border-zinc-100 dark:border-zinc-800'>
          <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-2'>
            Tags
          </p>
          <TagPicker
            selectedTags={task.tags ?? []}
            allTags={allTags}
            onChange={onTagsChange}
            onCreateTag={onCreateTag}
          />
        </div>
      )}

      {/* ── Branch ─────────────────────────────────────────────────── */}
      <div className='pt-3 border-t border-zinc-100 dark:border-zinc-800'>
        <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5'>
          <GitBranch size={12} />
          Branch
        </p>
        {task.branches && task.branches.length > 0 ? (
          <ul className='space-y-1.5'>
            {task.branches.map(branch => (
              <li key={branch.id} className='flex items-center gap-1.5 group'>
                <span className='text-xs font-mono text-zinc-700 dark:text-zinc-300 truncate flex-1 min-w-0'>
                  {branch.branchName}
                </span>
                <button
                  onClick={() => onCopyBranch(branch.id, branch.branchName)}
                  className='shrink-0 text-zinc-300 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300 transition-colors'
                  title={intl.formatMessage({ id: 'task.copyBranchName' })}
                >
                  {copiedBranchId === branch.id ? (
                    <Check size={12} className='text-emerald-500' />
                  ) : (
                    <Copy size={12} />
                  )}
                </button>
                <a
                  href={`https://github.com/${branch.repo}/tree/${branch.branchName}`}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='shrink-0 text-zinc-300 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300 transition-colors'
                  title='Open on GitHub'
                >
                  <ExternalLink size={12} />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <button
            onClick={() => setCreateBranchOpen(true)}
            className='w-full flex items-center justify-center gap-1.5 rounded-md border border-dashed border-zinc-200 dark:border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600 hover:text-zinc-500 transition-colors'
          >
            <GitBranch size={12} />
            Create branch
          </button>
        )}
      </div>

      {/* ── Pull Requests ───────────────────────────────────────────── */}
      {task.pullRequests && task.pullRequests.length > 0 && (
        <div className='pt-3 border-t border-zinc-100 dark:border-zinc-800'>
          <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5'>
            <GitPullRequest size={12} />
            Pull Requests
          </p>
          <ul className='space-y-2.5'>
            {task.pullRequests.map(pr => {
              const relatedRun = task.agentRuns?.find(
                r => r.prNumber === pr.number
              )
              const runLabel = relatedRun
                ? `Session #${relatedRun.runNumber}`
                : null
              const runStatusLabel =
                relatedRun?.status === 'FAILED'
                  ? ' · Failed'
                  : relatedRun?.status === 'CANCELED'
                    ? ' · Canceled'
                    : relatedRun?.errorCode === 'TIMEOUT'
                      ? ' · Timed out'
                      : null

              return (
                <li key={pr.id} className='flex items-start gap-2'>
                  <CiIcon status={pr.ciStatus} />
                  <div className='min-w-0 flex-1'>
                    <a
                      href={pr.url}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='text-xs text-zinc-700 dark:text-zinc-300 hover:underline font-medium leading-snug block'
                    >
                      #{pr.number} {pr.title}
                    </a>
                    <div className='flex items-center gap-1.5 mt-1'>
                      <PrStateBadge state={pr.state} />
                      {runLabel && (
                        <span className='text-[10px] text-zinc-400'>
                          {runLabel}
                          {runStatusLabel && (
                            <span className='text-zinc-400'>
                              {runStatusLabel}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
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
          task.project.repositories?.find(r => r.isDefault)?.fullName ??
          task.project.repositories?.[0]?.fullName ??
          null
        }
        workspaceUrl={workspaceUrl}
      />
    </div>
  )
}

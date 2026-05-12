'use client'

import { useIntl } from 'react-intl'
import {
  Check,
  Copy,
  ExternalLink,
  GitPullRequest,
  GitBranch,
  RefreshCw,
  X,
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
import { SyncLumoButton } from './SyncLumoButton'
import { CreateBranchDialog } from './CreateBranchDialog'
import { UnlinkBranchDialog } from './UnlinkBranchDialog'
import { PrStateBadge, CiIcon } from './pr-helpers'
import { LinkPrPopover } from './LinkPrPopover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TagPicker } from './document/TagPicker'
import { TaskSprintField } from '../sprints/components/TaskSprintField'
import React, { useState } from 'react'

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
  workspaceId: string
  onUnlinkPr: (prId: string) => void
  onLinkPr: () => void
  /** All workspace tags for TagPicker. */
  allTags?: ApiTag[]
  /** Called when tags change (full objects). */
  onTagsChange?: (tags: ApiTag[]) => void
  /** Called to create a new tag inline. */
  onCreateTag?: (name: string) => Promise<ApiTag | null>
  /** Called when a branch is created via the dialog. */
  onBranchCreated?: (branch: import('../types').ApiTaskBranch) => void
  /** Called when a branch is unlinked. */
  onUnlinkBranch?: (branchId: string) => void
}

export function TaskDetailSidebar({
  task,
  members,
  agentActors: _agentActors,
  projects,
  copiedBranchId,
  createBranchOpen,
  setCreateBranchOpen,
  workspaceUrl,
  workspaceId,
  onPatch,
  onCopyBranch,
  onUnlinkPr,
  onLinkPr,
  allTags,
  onTagsChange,
  onCreateTag,
  onBranchCreated,
  onUnlinkBranch,
}: TaskDetailSidebarProps) {
  const intl = useIntl()
  const projectRepositories = task.project?.repositories

  const [unlinkBranch, setUnlinkBranch] = useState<{
    id: string
    name: string
  } | null>(null)

  return (
    <div className='w-72 shrink-0 border-l border-zinc-100 dark:border-zinc-800 overflow-y-auto px-5 py-6 bg-zinc-50/50 dark:bg-zinc-900/30'>
      {/* Properties */}
      <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-3'>
        {intl.formatMessage({ id: 'task.properties' })}
      </p>
      <div className='flex flex-col gap-0.5 mb-8'>
        {(
          [
            {
              label: intl.formatMessage({ id: 'task.status' }),
              node: (
                <StatusSelect
                  value={task.status}
                  onChange={v => onPatch({ status: v })}
                  triggerClassName={FIELD_TRIGGER_CLS}
                />
              ),
            },
            {
              label: intl.formatMessage({ id: 'task.assignee' }),
              node: (
                <AssigneeSelect
                  value={task.assigneeActorId ?? null}
                  onChange={v => onPatch({ assigneeActorId: v })}
                  members={members.filter(
                    (m): m is WorkspaceMemberInfo & { actorId: string } =>
                      m.actorId !== null
                  )}
                  agentActors={[]}
                  assignee={task.assignee}
                  triggerClassName={FIELD_TRIGGER_CLS}
                />
              ),
            },
            {
              label: intl.formatMessage({ id: 'task.reviewer' }),
              node: (
                <ReviewerSelect
                  value={task.reviewerActorId ?? null}
                  onChange={v => onPatch({ reviewerActorId: v })}
                  members={members.filter(
                    (m): m is WorkspaceMemberInfo & { actorId: string } =>
                      m.actorId !== null
                  )}
                  inheritedId={task.project?.ownerId ?? null}
                  triggerClassName={FIELD_TRIGGER_CLS}
                />
              ),
            },
            {
              label: intl.formatMessage({ id: 'common.project' }),
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
              label: intl.formatMessage({ id: 'task.priority' }),
              node: (
                <PrioritySelect
                  value={task.priority}
                  onChange={v => onPatch({ priority: v })}
                  triggerClassName={FIELD_TRIGGER_CLS}
                />
              ),
            },
            ...((projectRepositories?.length ?? 0) > 0
              ? [
                  {
                    label: intl.formatMessage({ id: 'task.repository' }),
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
                          <SelectValue
                            placeholder={intl.formatMessage({
                              id: 'task.repository',
                            })}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='__none__'>
                            {intl.formatMessage({ id: 'task.noRepository' })}
                          </SelectItem>
                          {projectRepositories!.map(repo => (
                            <SelectItem key={repo.id} value={repo.id}>
                              {repo.isDefault
                                ? intl.formatMessage(
                                    { id: 'task.repoDefault' },
                                    { name: repo.name }
                                  )
                                : repo.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ),
                  },
                ]
              : []),
            ...(task.sprintsEnabled && task.teamId
              ? [
                  {
                    label: intl.formatMessage({
                      id: 'sprints.taskField.label',
                    }),
                    node: (
                      <TaskSprintField
                        task={{
                          id: task.id,
                          teamId: task.teamId,
                          sprintId: task.sprintId ?? null,
                          sprint: task.sprint ?? null,
                        }}
                        onChange={v => onPatch({ sprintId: v })}
                        triggerClassName={FIELD_TRIGGER_CLS}
                      />
                    ),
                  },
                ]
              : []),
            ...(allTags && onTagsChange
              ? [
                  {
                    label: intl.formatMessage({ id: 'task.tags' }),
                    node: (
                      <TagPicker
                        selectedTags={task.tags ?? []}
                        allTags={allTags}
                        onChange={onTagsChange}
                        onCreateTag={onCreateTag}
                      />
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

      {/* ── Branch ─────────────────────────────────────────────────── */}
      <div className='pt-3'>
        <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5'>
          <GitBranch size={12} />
          {intl.formatMessage({ id: 'task.branch' })}
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
                  title={intl.formatMessage({ id: 'task.openOnGitHub' })}
                >
                  <ExternalLink size={12} />
                </a>
                <button
                  onClick={() =>
                    setUnlinkBranch({
                      id: branch.id,
                      name: branch.branchName,
                    })
                  }
                  className='shrink-0 opacity-0 group-hover:opacity-100 text-zinc-300 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300 transition-all'
                  title={intl.formatMessage({ id: 'task.unlinkBranch' })}
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <button
            onClick={() => setCreateBranchOpen(true)}
            className='w-full flex items-center justify-center gap-1.5 rounded-md border border-dashed border-zinc-200 dark:border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600 hover:text-zinc-500 transition-colors'
          >
            <GitBranch size={12} />
            {intl.formatMessage({ id: 'task.createBranch' })}
          </button>
        )}
      </div>

      {/* ── Pull Requests ───────────────────────────────────────────── */}
      <div className='pt-3'>
        <div className='flex items-center justify-between mb-2'>
          <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider flex items-center gap-1.5'>
            <GitPullRequest size={12} />
            {intl.formatMessage({ id: 'task.pullRequests' })}
          </p>
          <LinkPrPopover
            taskId={task.id}
            workspaceId={workspaceId}
            onLinked={onLinkPr}
          />
        </div>
        {task.pullRequests && task.pullRequests.length > 0 ? (
          <ul className='space-y-2.5'>
            {task.pullRequests.map(pr => {
              return (
                <li key={pr.id} className='flex items-start gap-2 group'>
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
                    </div>
                  </div>
                  <button
                    onClick={() => onUnlinkPr(pr.id)}
                    className='shrink-0 opacity-0 group-hover:opacity-100 text-zinc-300 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300 transition-all'
                    title={intl.formatMessage({ id: 'task.unlinkPr' })}
                  >
                    <X size={12} />
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className='text-xs text-zinc-400 dark:text-zinc-500'>
            {intl.formatMessage({ id: 'task.noPullRequests' })}
          </p>
        )}
      </div>

      {/* ── Sync LUMO.md ─────────────────────────────────────────── */}
      <div className='pt-3'>
        <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider flex items-center gap-1.5 mb-2'>
          <RefreshCw size={12} />
          LUMO.md
        </p>
        <SyncLumoButton taskId={task.id} />
      </div>

      {unlinkBranch && (
        <UnlinkBranchDialog
          isOpen={!!unlinkBranch}
          onClose={() => setUnlinkBranch(null)}
          taskId={task.id}
          branchId={unlinkBranch.id}
          branchName={unlinkBranch.name}
          onUnlinked={branchId => {
            onUnlinkBranch?.(branchId)
            setUnlinkBranch(null)
          }}
        />
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
        {...(onBranchCreated ? { onBranchCreated } : {})}
      />
    </div>
  )
}

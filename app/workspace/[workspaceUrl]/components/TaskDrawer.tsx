'use client'

import { useState, useCallback } from 'react'
import { Drawer as DrawerPrimitive } from 'vaul'
import { X, SquareArrowOutUpRight, Link as LinkIcon, Check } from 'lucide-react'
import { useRouter, useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { copyLink } from '../utils/copyLink'
import { slugifyProjectName } from '../utils'
import {
  ApiTask,
  MyTask,
  ApiStatus,
  ApiPriority,
  WorkspaceMemberInfo,
  ApiProject,
} from '../types'
import { TaskDetailPanel } from './TaskDetailPanel'

interface TaskDrawerProps {
  initialTask: ApiTask | MyTask
  liveTask?: ApiTask
  cachedDescription?: string | null | undefined
  onClose: () => void
  members: WorkspaceMemberInfo[]
  agentActors?: { actorId: string; name: string; avatarColor: string }[]
  projects: ApiProject[]
  tasks?: ApiTask[]
  source: 'my-tasks' | `project-${string}`
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
    }>
  ) => Promise<void>
  onDescriptionLoaded?: (taskId: string, description: string | null) => void
}

export function TaskDrawer({
  initialTask,
  liveTask,
  cachedDescription,
  onClose,
  members,
  agentActors,
  projects,
  tasks,
  source,
  onUpdate,
  onDescriptionLoaded,
}: TaskDrawerProps) {
  const router = useRouter()
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()

  const projectName =
    initialTask.project?.name ??
    projects.find(p => p.id === initialTask.projectId)?.name ??
    ''

  const [copied, setCopied] = useState(false)
  const handleCopyLink = useCallback(async () => {
    await copyLink(
      `${window.location.origin}/workspace/${workspaceUrl}/project/${slugifyProjectName(projectName)}/tasks/${initialTask.teamIdentifier}-${initialTask.number}`
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [
    workspaceUrl,
    initialTask.teamIdentifier,
    initialTask.number,
    projectName,
  ])

  return (
    <DrawerPrimitive.Root
      open
      onOpenChange={open => {
        if (!open) onClose()
      }}
      direction='right'
      dismissible={false}
    >
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay
          className='fixed inset-0 z-40 bg-black/10 dark:bg-black/30'
          onClick={onClose}
        />
        <DrawerPrimitive.Content
          className='fixed right-0 top-0 bottom-0 z-50 bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800 flex flex-col shadow-2xl outline-none w-full md:w-[520px]'
          onKeyDown={e => {
            if (e.key === 'Escape') onClose()
          }}
        >
          {/* Header */}
          <DrawerPrimitive.Title className='sr-only'>
            Task detail
          </DrawerPrimitive.Title>
          <div className='flex items-center justify-between px-5 pt-4 shrink-0'>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => {
                sessionStorage.setItem('lumo:taskSource', source)
                onClose()
                router.push(
                  `/workspace/${workspaceUrl}/project/${slugifyProjectName(projectName)}/tasks/${initialTask.teamIdentifier}-${initialTask.number}`
                )
              }}
              className='h-7 w-7 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              title='Open full page'
            >
              <SquareArrowOutUpRight size={14} />
            </Button>
            <div className='flex items-center gap-1'>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='icon'
                    onClick={handleCopyLink}
                    className='h-7 w-7 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                  >
                    {copied ? <Check size={14} /> : <LinkIcon size={14} />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy link</TooltipContent>
              </Tooltip>
              <Button
                variant='ghost'
                size='icon'
                onClick={onClose}
                className='h-7 w-7 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              >
                <X size={14} />
              </Button>
            </div>
          </div>

          {/* Body — shared with Inbox detail panel */}
          <TaskDetailPanel
            initialTask={initialTask}
            {...(liveTask ? { liveTask } : {})}
            cachedDescription={cachedDescription}
            members={members}
            agentActors={agentActors}
            projects={projects}
            {...(tasks ? { tasks } : {})}
            onUpdate={onUpdate}
            onDescriptionLoaded={onDescriptionLoaded}
          />
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  )
}

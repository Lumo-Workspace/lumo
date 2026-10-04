'use client'

import { useCallback } from 'react'
import { useIntl } from 'react-intl'
import { Drawer as DrawerPrimitive } from 'vaul'
import { X, SquareArrowOutUpRight, Link as LinkIcon, Check } from 'lucide-react'
import { useRouter, useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { copyLink } from '@/lib/utils/copyLink'
import { slugify } from '@/lib/utils/slugify'
import {
  ApiTask,
  MyTask,
  ApiStatus,
  ApiPriority,
  WorkspaceMemberInfo,
  ApiProject,
} from '../types'
import { TaskDetailPanel } from './TaskDetailPanel'
import { useCopyState } from '../hooks/useCopyState'

interface TaskDrawerProps {
  initialTask: ApiTask | MyTask
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
      description: string | null
      projectId: string
      priority: ApiPriority
    }>
  ) => Promise<void>
  onDescriptionLoaded?: (taskId: string, description: string | null) => void
}

export function TaskDrawer({
  initialTask,
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
  const intl = useIntl()
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()

  const projectName =
    initialTask.project?.name ??
    projects.find(p => p.id === initialTask.projectId)?.name ??
    ''

  const taskIdentifier = `${initialTask.teamIdentifier}-${initialTask.number}`
  const taskUrl = useCallback(
    (forSource: string) =>
      forSource === 'my-tasks'
        ? `/workspace/${workspaceUrl}/my-tasks/${taskIdentifier}`
        : `/workspace/${workspaceUrl}/projects/${slugify(projectName)}/tasks/${taskIdentifier}`,
    [workspaceUrl, taskIdentifier, projectName]
  )

  const [copied, triggerCopy] = useCopyState()
  const handleCopyLink = useCallback(async () => {
    await copyLink(`${window.location.origin}${taskUrl(source)}`)
    triggerCopy()
  }, [taskUrl, source, triggerCopy])

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
          className='fixed inset-0 z-overlay bg-black/10 dark:bg-black/30'
          onClick={onClose}
        />
        <DrawerPrimitive.Content
          className='fixed right-0 top-0 bottom-0 z-modal bg-card border-l border-border flex flex-col shadow-elevation-3 outline-none w-full md:w-[520px]'
          onKeyDown={e => {
            if (e.key === 'Escape') onClose()
          }}
        >
          {/* Header */}
          <DrawerPrimitive.Title className='sr-only'>
            {intl.formatMessage({ id: 'taskDrawer.title' })}
          </DrawerPrimitive.Title>
          <div className='flex items-center justify-between px-5 pt-4 shrink-0'>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => {
                sessionStorage.setItem('lumo:taskSource', source)
                onClose()
                router.push(taskUrl(source))
              }}
              className='h-7 w-7 text-muted-foreground hover:text-foreground'
              title={intl.formatMessage({ id: 'taskDrawer.openFull' })}
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
                    className='h-7 w-7 text-muted-foreground hover:text-foreground'
                  >
                    {copied ? <Check size={14} /> : <LinkIcon size={14} />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {intl.formatMessage({ id: 'common.copyLink' })}
                </TooltipContent>
              </Tooltip>
              <Button
                variant='ghost'
                size='icon'
                onClick={onClose}
                className='h-7 w-7 text-muted-foreground hover:text-foreground'
              >
                <X size={14} />
              </Button>
            </div>
          </div>

          {/* Body — shared with Inbox detail panel */}
          <TaskDetailPanel
            initialTask={initialTask}
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

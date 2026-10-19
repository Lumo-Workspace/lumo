'use client'

import { useCallback } from 'react'
import { useIntl } from 'react-intl'
import { X, SquareArrowOutUpRight, Link as LinkIcon, Check } from 'lucide-react'
import { useRouter, useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
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
    <Drawer
      open
      onOpenChange={open => {
        if (!open) onClose()
      }}
      direction='right'
      dismissible={false}
    >
      {/* `dismissible={false}` stops vaul's drag-to-close (text selection in
          the panel would trigger it), which also mutes its own overlay-click
          and Escape handling — so both close the drawer explicitly here. */}
      <DrawerContent
        aria-describedby={undefined}
        className='bg-card border-border outline-none data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:sm:max-w-none data-[vaul-drawer-direction=right]:md:w-[520px]'
        onPointerDownOutside={e => {
          if (
            e.target instanceof HTMLElement &&
            e.target.dataset.slot === 'drawer-overlay'
          )
            onClose()
        }}
        onKeyDown={e => {
          if (e.key === 'Escape') onClose()
        }}
      >
        {/* Header */}
        <DrawerTitle className='sr-only'>
          {intl.formatMessage({ id: 'taskDrawer.title' })}
        </DrawerTitle>
        <div className='flex items-center justify-between px-5 pt-4 shrink-0'>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                onClick={() => {
                  sessionStorage.setItem('lumo:taskSource', source)
                  onClose()
                  router.push(taskUrl(source))
                }}
                className='h-7 w-7 text-muted-foreground hover:text-foreground'
                aria-label={intl.formatMessage({ id: 'taskDrawer.openFull' })}
              >
                <SquareArrowOutUpRight size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {intl.formatMessage({ id: 'taskDrawer.openFull' })}
            </TooltipContent>
          </Tooltip>
          <div className='flex items-center gap-1'>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={handleCopyLink}
                  aria-label={intl.formatMessage({ id: 'common.copyLink' })}
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
              aria-label={intl.formatMessage({ id: 'common.close' })}
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
      </DrawerContent>
    </Drawer>
  )
}

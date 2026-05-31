'use client'

import { useRouter } from 'next/navigation'
import { useIntl } from 'react-intl'
import { Trash2, Link as LinkIcon, Check, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { slugify } from '@/lib/utils/slugify'

interface TaskDetailHeaderProps {
  workspaceUrl: string
  from: string | null
  sourceLabel: string
  taskTitle: string
  taskIdentifier: string
  projectName: string
  deleteOpen: boolean
  setDeleteOpen: (open: boolean) => void
  onDeleteTask: () => void
  taskLinkCopied: boolean
  onCopyTaskLink: () => void
}

export function TaskDetailHeader({
  workspaceUrl,
  from,
  sourceLabel,
  taskTitle,
  taskIdentifier,
  projectName,
  deleteOpen,
  setDeleteOpen,
  onDeleteTask,
  taskLinkCopied,
  onCopyTaskLink,
}: TaskDetailHeaderProps) {
  const intl = useIntl()
  const router = useRouter()

  return (
    <>
      <div className='flex items-center justify-between px-5 h-10 border-b border-zinc-100 dark:border-zinc-800 shrink-0 text-sm'>
        <div className='flex items-center gap-1.5'>
          <button
            onClick={() => {
              if (from === 'my-tasks') {
                router.push(`/workspace/${workspaceUrl}/my-tasks`)
              } else {
                router.push(
                  `/workspace/${workspaceUrl}/projects/${slugify(projectName)}`
                )
              }
            }}
            className='flex items-center gap-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors'
          >
            <span>{sourceLabel}</span>
          </button>
          <span className='text-zinc-300 dark:text-zinc-600'>&rsaquo;</span>
          <span className='text-zinc-500 font-medium'>{taskIdentifier}</span>
          <span className='text-zinc-300 dark:text-zinc-600'>&middot;</span>
          <span className='text-zinc-700 dark:text-zinc-300 truncate max-w-xs'>
            {taskTitle}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                className='h-6 w-6 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              >
                <MoreHorizontal size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start'>
              <DropdownMenuItem
                className='text-destructive focus:text-destructive'
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className='mr-2 size-4' />
                {intl.formatMessage({ id: 'task.deleteTask' })}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={onCopyTaskLink}
              className='h-7 w-7 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
            >
              {taskLinkCopied ? <Check size={14} /> : <LinkIcon size={14} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {intl.formatMessage({ id: 'task.copyLink' })}
          </TooltipContent>
        </Tooltip>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent size='sm'>
          <AlertDialogHeader>
            <AlertDialogMedia className='bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive'>
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {intl.formatMessage({ id: 'task.deleteTitle' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage(
                { id: 'task.deleteDesc' },
                { title: taskTitle }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant='outline'>
              {intl.formatMessage({ id: 'common.cancel' })}
            </AlertDialogCancel>
            <AlertDialogAction variant='destructive' onClick={onDeleteTask}>
              {intl.formatMessage({ id: 'common.delete' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

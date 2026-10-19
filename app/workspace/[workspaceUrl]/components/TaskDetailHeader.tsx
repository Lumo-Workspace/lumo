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
import { taskSourcePath } from '../utils'

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
      <div className='flex items-center justify-between px-5 h-10 border-b border-border shrink-0 text-body'>
        <div className='flex items-center gap-1.5'>
          <button
            onClick={() => {
              router.push(taskSourcePath(workspaceUrl, from, projectName))
            }}
            className='flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors'
          >
            <span>{sourceLabel}</span>
          </button>
          <span className='text-muted-foreground'>&rsaquo;</span>
          <span className='text-body-strong text-muted-foreground'>
            {taskIdentifier}
          </span>
          <span className='text-muted-foreground'>&middot;</span>
          <span className='text-foreground truncate max-w-xs'>{taskTitle}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                aria-label={intl.formatMessage({ id: 'task.moreOptions' })}
                className='h-6 w-6 text-muted-foreground hover:text-foreground'
              >
                <MoreHorizontal size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start'>
              <DropdownMenuItem
                className='text-danger-text focus:text-danger-text'
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
              aria-label={intl.formatMessage({ id: 'task.copyLink' })}
              className='h-7 w-7 text-muted-foreground hover:text-foreground'
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

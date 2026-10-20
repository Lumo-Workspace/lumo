'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useIntl } from 'react-intl'
import {
  Trash2,
  Link as LinkIcon,
  Check,
  MoreHorizontal,
  PanelRight,
} from 'lucide-react'
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
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
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
import { cn } from '@/lib/utils'
import { PageBreadcrumb } from './PageBreadcrumb'
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
  /** Opens the property panel on narrow screens (it is inline from `lg`). */
  onOpenProperties?: (() => void) | undefined
}

/**
 * Task detail page header (LUM-1274): the shared PageBreadcrumb bar —
 * source › task id on the left; secondary actions as ghost icon buttons with
 * tooltips on the right. The destructive action stays inside the More menu.
 */
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
  onOpenProperties,
}: TaskDetailHeaderProps) {
  const intl = useIntl()
  const router = useRouter()
  const moreLabel = intl.formatMessage({ id: 'task.moreOptions' })
  const copyLabel = intl.formatMessage({ id: 'task.copyLink' })
  const propertiesLabel = intl.formatMessage({ id: 'task.showProperties' })

  return (
    <>
      <PageBreadcrumb
        actions={
          <div className='flex items-center gap-1'>
            {onOpenProperties ? (
              <HeaderIconAction
                label={propertiesLabel}
                onClick={onOpenProperties}
                className='lg:hidden'
              >
                <PanelRight />
              </HeaderIconAction>
            ) : null}
            <HeaderIconAction label={copyLabel} onClick={onCopyTaskLink}>
              {taskLinkCopied ? <Check /> : <LinkIcon />}
            </HeaderIconAction>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      aria-label={moreLabel}
                      className='text-muted-foreground'
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{moreLabel}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align='end'>
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
        }
      >
        <Breadcrumb className='min-w-0'>
          <BreadcrumbList className='flex-nowrap'>
            <BreadcrumbItem className='min-w-0'>
              <BreadcrumbLink asChild>
                <button
                  type='button'
                  className='truncate'
                  onClick={() => {
                    router.push(taskSourcePath(workspaceUrl, from, projectName))
                  }}
                >
                  {sourceLabel}
                </button>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem className='shrink-0'>
              <BreadcrumbPage>{taskIdentifier}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageBreadcrumb>

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

/** A ghost icon button with a matching tooltip and accessible name. */
function HeaderIconAction({
  label,
  onClick,
  className,
  children,
}: {
  label: string
  onClick: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant='ghost'
          size='icon-sm'
          onClick={onClick}
          aria-label={label}
          className={cn('text-muted-foreground', className)}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

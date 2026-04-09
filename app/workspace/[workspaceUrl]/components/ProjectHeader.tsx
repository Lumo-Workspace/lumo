'use client'

import {
  MoreHorizontal,
  Trash2,
  MessageSquare,
  Check,
  Link as LinkIcon,
} from 'lucide-react'
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { PageBreadcrumb } from './PageBreadcrumb'

interface ProjectHeaderProps {
  projectName: string
  projectId: string
  deleteOpen: boolean
  onDeleteOpenChange: (open: boolean) => void
  onBack: () => void
  onDeleteProject: (projectId: string) => Promise<void>
  onSlack?: (() => void) | undefined
  onCopyLink?: (() => void) | undefined
  copied?: boolean | undefined
}

export function ProjectHeader({
  projectName,
  projectId,
  deleteOpen,
  onDeleteOpenChange,
  onBack,
  onDeleteProject,
  onSlack,
  onCopyLink,
  copied,
}: ProjectHeaderProps) {
  return (
    <>
      <PageBreadcrumb>
        <div className='flex items-center gap-1.5'>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <button onClick={onBack}>Projects</button>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{projectName}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          {onSlack && (
            <Button
              variant='ghost'
              size='icon'
              onClick={onSlack}
              className='h-6 w-6 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              title='Slack notifications'
            >
              <MessageSquare size={14} />
            </Button>
          )}
          {onCopyLink && (
            <Button
              variant='ghost'
              size='icon'
              onClick={onCopyLink}
              className='h-6 w-6 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              title='Copy link'
            >
              {copied ? <Check size={14} /> : <LinkIcon size={14} />}
            </Button>
          )}
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
                onClick={() => onDeleteOpenChange(true)}
              >
                <Trash2 className='mr-2 size-4' />
                Delete project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </PageBreadcrumb>

      <AlertDialog open={deleteOpen} onOpenChange={onDeleteOpenChange}>
        <AlertDialogContent size='sm'>
          <AlertDialogHeader>
            <AlertDialogMedia className='bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive'>
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{projectName}&rdquo; and all its tasks will be permanently
              deleted. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant='outline'>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => onDeleteProject(projectId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
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
import { PageBreadcrumb } from '../../PageBreadcrumb'

interface ProjectHeaderProps {
  projectId: string
  projectName: string
  onBack: () => void
  onDeleteProject: (projectId: string) => Promise<void>
  onSlack?: (() => void) | undefined
  onCopyLink?: (() => void) | undefined
  copied?: boolean | undefined
}

export function ProjectHeader({
  projectId,
  projectName,
  onBack,
  onDeleteProject,
  onSlack,
  onCopyLink,
  copied,
}: ProjectHeaderProps) {
  const intl = useIntl()
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <>
      <PageBreadcrumb>
        <div className='flex items-center gap-1.5'>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <button onClick={onBack}>
                    {intl.formatMessage({ id: 'sidebar.projects' })}
                  </button>
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
              className='h-6 w-6 text-muted-foreground hover:text-foreground'
              title={intl.formatMessage({
                id: 'project.slackNotifications',
                defaultMessage: 'Slack notifications',
              })}
            >
              <MessageSquare size={14} />
            </Button>
          )}
          {onCopyLink && (
            <Button
              variant='ghost'
              size='icon'
              onClick={onCopyLink}
              className='h-6 w-6 text-muted-foreground hover:text-foreground'
              title={intl.formatMessage({
                id: 'project.copyLink',
                defaultMessage: 'Copy link',
              })}
            >
              {copied ? <Check size={14} /> : <LinkIcon size={14} />}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
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
                {intl.formatMessage({ id: 'project.deleteProject' })}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </PageBreadcrumb>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent size='sm'>
          <AlertDialogHeader>
            <AlertDialogMedia className='bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive'>
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {intl.formatMessage({ id: 'project.deleteTitle' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage(
                { id: 'project.deleteDesc' },
                { name: projectName }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant='outline'>
              {intl.formatMessage({ id: 'common.cancel' })}
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => onDeleteProject(projectId)}
            >
              {intl.formatMessage({ id: 'common.delete' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

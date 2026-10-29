'use client'

import {
  Home,
  File,
  Inbox,
  LogOut,
  ChevronsUpDown,
  Users,
  Settings,
  FileEdit,
  Search,
  CalendarClock,
} from 'lucide-react'
import Link from 'next/link'
import { useSignOut } from '@/lib/auth/client'
import { useIntl } from 'react-intl'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { useParams } from 'next/navigation'
import { Page } from '../types'
import { useWorkspace } from '../hooks/useWorkspace'
import { useWorkspaceTeams } from '../hooks/useWorkspaceTeams'
import { useProjects } from '../hooks/useProjects'
import { ProjectsSidebarGroup } from './sidebar/ProjectsSidebarGroup'
import { FeedbackSidebarItem } from './sidebar/FeedbackSidebarItem'
import { clearCache } from '../cache'
import { Badge } from '@/components/ui/badge'
import { MemberAvatar } from '@/components/MemberAvatar'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface AppSidebarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
  unreadCount: number
  draftCount: number
  /**
   * Open the global Ask Lumo (command palette / AI) modal. Optional because
   * deep-link standalone pages (TaskDetailPage) don't currently host the
   * modal state — when omitted the search button
   * is hidden.
   */
  onOpenAskLumo?: () => void
  /**
   * Open the NewProjectModal. Only `WorkspaceApp`-rendered pages host the
   * modal, so when absent (standalone deep-link pages) the Projects sidebar
   * group falls back to navigating to `/projects?new=1`.
   */
  onNewProject?: () => void
}

export function AppSidebar({
  currentPage,
  onNavigate,
  unreadCount,
  draftCount,
  onOpenAskLumo,
  onNewProject,
}: AppSidebarProps) {
  const { user } = useCurrentUser()
  const signOut = useSignOut()
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const { isMobile } = useSidebar()
  const intl = useIntl()
  const { teams } = useWorkspaceTeams()
  const sprintsEnabled = teams.some(t => t.sprintsEnabled)
  const { projects, setProjects } = useProjects()

  // Shared, RQ-cached workspace metadata (one fetch across pages; localStorage
  // warm-start keeps the header from flickering on reload). See useWorkspace.
  const { workspace } = useWorkspace()
  const workspaceName = workspace?.name ?? ''
  const workspaceLogoUrl = workspace?.logoUrl ?? null

  const displayName = user?.displayName ?? ''

  return (
    <Sidebar collapsible='none'>
      {/* Workspace / user header — workspace dropdown takes the row, with the
          Ask Lumo (global command) button sitting flush against its right edge. */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem className='flex items-center gap-1'>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size='lg'
                  className='flex-1 min-w-0 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
                  tooltip={workspaceName || 'Workspace'}
                >
                  {workspaceLogoUrl ? (
                    <img
                      src={workspaceLogoUrl}
                      alt={workspaceName}
                      className='size-8 rounded-sm object-contain shrink-0'
                    />
                  ) : (
                    <MemberAvatar
                      decorative
                      name={displayName}
                      imageUrl={user?.imageUrl}
                      size='lg'
                    />
                  )}
                  <div className='flex-1 min-w-0 text-left leading-tight'>
                    <p className='text-body-strong truncate'>
                      {workspaceName || 'Workspace'}
                    </p>
                    <p className='text-caption text-sidebar-foreground/60 truncate'>
                      {displayName}
                    </p>
                  </div>
                  <ChevronsUpDown
                    className='ml-auto shrink-0 opacity-50'
                    size={16}
                  />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className='w-(--radix-dropdown-menu-trigger-width) min-w-56'
                side={isMobile ? 'bottom' : 'right'}
                align='end'
                sideOffset={4}
              >
                <DropdownMenuItem asChild className='cursor-pointer'>
                  <Link href={`/workspace/${workspaceUrl}/settings/members`}>
                    <Users size={13} />
                    {intl.formatMessage({ id: 'sidebar.manageMembers' })}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className='cursor-pointer'>
                  <Link href={`/workspace/${workspaceUrl}/settings/workspace`}>
                    <Settings size={13} />
                    {intl.formatMessage({ id: 'sidebar.settings' })}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className='text-danger-text focus:text-danger-text focus:bg-danger-subtle cursor-pointer'
                  onClick={() => {
                    clearCache()
                    signOut({ redirectUrl: '/signin' })
                  }}
                >
                  <LogOut size={13} />
                  {intl.formatMessage({ id: 'sidebar.signOut' })}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Ask Lumo — global command palette / AI entry. Cmd+K also works.
                Hidden on standalone deep-link pages that don't host the modal. */}
            {onOpenAskLumo && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type='button'
                    onClick={onOpenAskLumo}
                    aria-label={intl.formatMessage({
                      id: 'quickDispatch.title',
                    })}
                    className='flex shrink-0 items-center justify-center size-8 rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors'
                  >
                    <Search size={16} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {intl.formatMessage({ id: 'quickDispatch.title' })} (⌘K)
                </TooltipContent>
              </Tooltip>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* Navigation */}
      <SidebarContent>
        {/* Top-level items */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={currentPage === 'my-tasks'}
                  tooltip={intl.formatMessage({ id: 'sidebar.myTasks' })}
                >
                  <Link
                    href={`/workspace/${workspaceUrl}/my-tasks`}
                    onClick={e => {
                      e.preventDefault()
                      onNavigate('my-tasks')
                    }}
                  >
                    <Home />
                    <span>{intl.formatMessage({ id: 'sidebar.myTasks' })}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={currentPage === 'inbox'}
                  tooltip={intl.formatMessage({ id: 'sidebar.inbox' })}
                >
                  <Link
                    href={`/workspace/${workspaceUrl}/inbox`}
                    onClick={e => {
                      e.preventDefault()
                      onNavigate('inbox')
                    }}
                  >
                    <Inbox />
                    <span className='flex-1'>
                      {intl.formatMessage({ id: 'sidebar.inbox' })}
                    </span>
                    {unreadCount > 0 && (
                      <Badge className='ml-auto h-4 min-w-4 px-1 text-caption font-semibold bg-info hover:bg-info text-info-foreground rounded-full justify-center'>
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </Badge>
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={currentPage === 'drafts'}
                  tooltip={intl.formatMessage({ id: 'sidebar.drafts' })}
                >
                  <Link
                    href={`/workspace/${workspaceUrl}/drafts`}
                    onClick={e => {
                      e.preventDefault()
                      onNavigate('drafts')
                    }}
                  >
                    <FileEdit />
                    <span className='flex-1'>
                      {intl.formatMessage({ id: 'sidebar.drafts' })}
                    </span>
                    {draftCount > 0 && (
                      <Badge className='ml-auto h-4 min-w-4 px-1 text-caption font-semibold bg-muted-foreground hover:bg-muted-foreground text-white rounded-full justify-center'>
                        {draftCount > 99 ? '99+' : draftCount}
                      </Badge>
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Workspace section */}
        <SidebarGroup>
          <SidebarGroupLabel>
            {intl.formatMessage({ id: 'sidebar.workspace' })}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <ProjectsSidebarGroup
                currentPage={currentPage}
                projects={projects}
                setProjects={setProjects}
                workspaceUrl={workspaceUrl}
                onNavigate={onNavigate}
                onNewProject={onNewProject}
              />
              {sprintsEnabled && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={currentPage === 'sprints'}
                    tooltip={intl.formatMessage({ id: 'sidebar.sprints' })}
                  >
                    <Link
                      href={`/workspace/${workspaceUrl}/sprints`}
                      onClick={e => {
                        e.preventDefault()
                        onNavigate('sprints')
                      }}
                    >
                      <CalendarClock />
                      <span>
                        {intl.formatMessage({ id: 'sidebar.sprints' })}
                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={
                    currentPage === 'documents' ||
                    currentPage === 'document-editor'
                  }
                  tooltip={intl.formatMessage({ id: 'sidebar.documents' })}
                >
                  <Link
                    href={`/workspace/${workspaceUrl}/documents`}
                    onClick={e => {
                      e.preventDefault()
                      onNavigate('documents')
                    }}
                  >
                    <File />
                    <span>
                      {intl.formatMessage({ id: 'sidebar.documents' })}
                    </span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Pinned to the bottom corner: SidebarContent takes the free height. */}
      <SidebarFooter>
        <FeedbackSidebarItem />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}

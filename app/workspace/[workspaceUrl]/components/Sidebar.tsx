'use client'

import { useEffect, useState } from 'react'
import {
  Home,
  Layers,
  Sun,
  Moon,
  LogOut,
  ChevronsUpDown,
  Users,
  Settings,
} from 'lucide-react'
import Link from 'next/link'
import { useUser, useClerk } from '@clerk/nextjs'
import { useParams } from 'next/navigation'
import { Page } from '../types'
import { API } from '../constants'
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
} from '@/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface AppSidebarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
  isDarkMode: boolean
  onToggleDarkMode: () => void
}

export function AppSidebar({
  currentPage,
  onNavigate,
  isDarkMode,
  onToggleDarkMode,
}: AppSidebarProps) {
  const { user } = useUser()
  const { signOut } = useClerk()
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const [workspaceName, setWorkspaceName] = useState<string>('')

  useEffect(() => {
    fetch(API.workspaces.me)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data?.workspace?.name) setWorkspaceName(data.workspace.name)
      })
      .catch(() => {})
  }, [])

  const initials =
    user?.firstName?.[0] ??
    user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() ??
    '?'
  const displayName = user?.firstName
    ? `${user.firstName} ${user.lastName ?? ''}`.trim()
    : (user?.emailAddresses?.[0]?.emailAddress ?? '')

  return (
    <Sidebar collapsible='none' className='hidden md:flex'>
      {/* Workspace / user header */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size='lg'
                  className='data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
                  tooltip={workspaceName || 'Workspace'}
                >
                  {user?.imageUrl ? (
                    <img
                      src={user.imageUrl}
                      className='size-8 rounded-full object-cover shrink-0'
                      alt='avatar'
                      referrerPolicy='no-referrer'
                    />
                  ) : (
                    <div className='size-8 rounded-full bg-sidebar-accent flex items-center justify-center text-[11px] font-bold shrink-0'>
                      {initials}
                    </div>
                  )}
                  <div className='flex-1 min-w-0 text-left leading-tight'>
                    <p className='text-sm font-semibold truncate'>
                      {workspaceName || 'Workspace'}
                    </p>
                    <p className='text-xs text-sidebar-foreground/60 truncate'>
                      {displayName}
                    </p>
                  </div>
                  <ChevronsUpDown
                    className='ml-auto shrink-0 opacity-50'
                    size={16}
                  />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className='w-56' side='bottom' align='end'>
                <DropdownMenuItem asChild className='cursor-pointer'>
                  <Link href={`/workspace/${workspaceUrl}/settings/members`}>
                    <Users size={13} />
                    Manage members
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className='cursor-pointer'>
                  <Link href={`/workspace/${workspaceUrl}/settings/workspace`}>
                    <Settings size={13} />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className='text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400 focus:bg-red-50 dark:focus:bg-red-950/30 cursor-pointer'
                  onClick={() => signOut({ redirectUrl: '/signin' })}
                >
                  <LogOut size={13} />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
                  isActive={currentPage === 'my-tasks'}
                  onClick={() => onNavigate('my-tasks')}
                  tooltip='My Tasks'
                >
                  <Home />
                  <span>My Tasks</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Workspace section */}
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={
                    currentPage === 'projects' ||
                    currentPage === 'project-detail'
                  }
                  onClick={() => onNavigate('projects')}
                  tooltip='Projects'
                >
                  <Layers />
                  <span>Projects</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer: dark mode / settings toggle */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={onToggleDarkMode}
              tooltip={isDarkMode ? 'Dark Mode' : 'Light Mode'}
            >
              {isDarkMode ? <Moon /> : <Sun />}
              <span>{isDarkMode ? 'Dark Mode' : 'Light Mode'}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

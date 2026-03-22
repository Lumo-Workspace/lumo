'use client'

import { useEffect, useState } from 'react'
import { Home, Layers, Sun, Moon, LogOut, ChevronsUpDown } from 'lucide-react'
import { useUser, useClerk } from '@clerk/nextjs'
import { Page } from '../types'
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
  const [workspaceName, setWorkspaceName] = useState<string>('')

  useEffect(() => {
    fetch('/api/workspaces/me')
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
    <Sidebar collapsible='none'>
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
              <DropdownMenuContent className='w-48' align='end'>
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

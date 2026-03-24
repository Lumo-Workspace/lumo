'use client'

import { useState, useEffect } from 'react'
import {
  Home,
  Layers,
  Inbox,
  Sun,
  Moon,
  LogOut,
  Menu,
  Users,
  Settings,
} from 'lucide-react'
import Link from 'next/link'
import { useUser, useClerk } from '@clerk/nextjs'
import { useParams } from 'next/navigation'
import { Drawer } from 'vaul'
import { Page } from '../types'
import { API } from '../constants'
import { clearCache } from '../cache'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface MobileSidebarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
  isDarkMode: boolean
  onToggleDarkMode: () => void
  unreadCount: number
}

export function MobileSidebar({
  currentPage,
  onNavigate,
  isDarkMode,
  onToggleDarkMode,
  unreadCount,
}: MobileSidebarProps) {
  const { user } = useUser()
  const { signOut } = useClerk()
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const [open, setOpen] = useState(false)
  const [workspaceName, setWorkspaceName] = useState('')

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

  function navigate(page: Page) {
    onNavigate(page)
    setOpen(false)
  }

  return (
    <>
      <Button
        variant='ghost'
        size='icon'
        className='h-8 w-8'
        onClick={() => setOpen(true)}
      >
        <Menu size={18} />
      </Button>

      <Drawer.Root open={open} onOpenChange={setOpen} direction='left'>
        <Drawer.Portal>
          <Drawer.Overlay className='fixed inset-0 z-40 bg-black/40' />
          <Drawer.Content className='fixed left-0 top-0 bottom-0 z-50 w-64 flex flex-col bg-sidebar text-sidebar-foreground outline-none'>
            <Drawer.Title className='sr-only'>Navigation</Drawer.Title>

            {/* Workspace / user header */}
            <div className='p-3 border-b border-sidebar-border'>
              <div className='flex items-center gap-3 px-2 py-2'>
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
                <div className='flex-1 min-w-0 leading-tight'>
                  <p className='text-sm font-semibold truncate'>
                    {workspaceName || 'Workspace'}
                  </p>
                  <p className='text-xs text-sidebar-foreground/60 truncate'>
                    {displayName}
                  </p>
                </div>
              </div>
            </div>

            {/* Navigation */}
            <nav className='flex-1 p-3 space-y-1'>
              <button
                onClick={() => navigate('my-tasks')}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  currentPage === 'my-tasks'
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'hover:bg-sidebar-accent/50'
                }`}
              >
                <Home size={16} />
                My Tasks
              </button>
              <button
                onClick={() => navigate('projects')}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  currentPage === 'projects' || currentPage === 'project-detail'
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'hover:bg-sidebar-accent/50'
                }`}
              >
                <Layers size={16} />
                Projects
              </button>
              <button
                onClick={() => navigate('inbox')}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  currentPage === 'inbox'
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'hover:bg-sidebar-accent/50'
                }`}
              >
                <Inbox size={16} />
                <span className='flex-1 text-left'>Inbox</span>
                {unreadCount > 0 && (
                  <Badge className='ml-auto h-4 min-w-4 px-1 text-[10px] font-bold bg-blue-500 hover:bg-blue-500 text-white rounded-full justify-center'>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Badge>
                )}
              </button>
            </nav>

            {/* Footer */}
            <div className='p-3 border-t border-sidebar-border space-y-1'>
              <button
                onClick={() => {
                  onToggleDarkMode()
                  setOpen(false)
                }}
                className='w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium hover:bg-sidebar-accent/50 transition-colors'
              >
                {isDarkMode ? <Moon size={16} /> : <Sun size={16} />}
                {isDarkMode ? 'Dark Mode' : 'Light Mode'}
              </button>
              <Link
                href={`/workspace/${workspaceUrl}/settings/members`}
                onClick={() => setOpen(false)}
                className='w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium hover:bg-sidebar-accent/50 transition-colors'
              >
                <Users size={16} />
                Manage members
              </Link>
              <Link
                href={`/workspace/${workspaceUrl}/settings/workspace`}
                onClick={() => setOpen(false)}
                className='w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium hover:bg-sidebar-accent/50 transition-colors'
              >
                <Settings size={16} />
                Settings
              </Link>
              <div className='my-1 border-t border-sidebar-border' />
              <button
                onClick={() => {
                  clearCache()
                  signOut({ redirectUrl: '/signin' })
                }}
                className='w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors'
              >
                <LogOut size={16} />
                Sign out
              </button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  )
}

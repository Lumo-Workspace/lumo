'use client'

import { useEffect, useState } from 'react'
import {
  Home,
  Layers,
  Settings,
  Sparkles,
  LogOut,
  ChevronsUpDown,
} from 'lucide-react'
import { useUser, useClerk } from '@clerk/nextjs'
import { cn } from '@/lib/utils'
import { Page } from '../types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface SidebarItemProps {
  icon: React.ElementType
  label: string
  active?: boolean
  onClick?: () => void
  shortcut?: string
}

function SidebarItem({
  icon: Icon,
  label,
  active,
  onClick,
  shortcut,
}: SidebarItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-between px-3 py-2 rounded-md transition-all duration-200',
        active
          ? 'bg-zinc-100 text-zinc-900 font-semibold dark:bg-zinc-800 dark:text-zinc-50'
          : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-900'
      )}
    >
      <div className='flex items-center gap-3'>
        <Icon size={20} />
        <span className='text-sm font-medium'>{label}</span>
      </div>
      {shortcut && (
        <span className='text-[10px] text-zinc-400 font-mono'>{shortcut}</span>
      )}
    </button>
  )
}

interface SidebarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
  isDarkMode: boolean
  onToggleDarkMode: () => void
}

export function Sidebar({
  currentPage,
  onNavigate,
  isDarkMode,
  onToggleDarkMode,
}: SidebarProps) {
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
    <aside className='w-64 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 flex flex-col shrink-0'>
      {/* Workspace header */}
      <div className='p-3 mb-1'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className='w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors group outline-none'>
              {user?.imageUrl ? (
                <img
                  src={user.imageUrl}
                  className='size-5 rounded-full object-cover border border-zinc-200 dark:border-zinc-700 shrink-0'
                  alt='avatar'
                  referrerPolicy='no-referrer'
                />
              ) : (
                <div className='size-5 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-[8px] font-bold text-zinc-700 dark:text-zinc-200 shrink-0'>
                  {initials}
                </div>
              )}
              <div className='flex-1 text-left min-w-0'>
                <p className='text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate leading-tight'>
                  {workspaceName || 'Workspace'}
                </p>
                <p className='text-[10px] text-zinc-400 truncate leading-tight'>
                  {displayName}
                </p>
              </div>
              <ChevronsUpDown
                size={13}
                className='shrink-0 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors'
              />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent className='w-40' align='start'>
            <DropdownMenuItem
              className='text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400 focus:bg-red-50 dark:focus:bg-red-950/30 cursor-pointer'
              onClick={() => signOut({ redirectUrl: '/signin' })}
            >
              <LogOut size={13} />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Navigation */}
      <nav className='flex-1 px-3 space-y-1'>
        <div className='mb-4'>
          <SidebarItem
            icon={Home}
            label='My Tasks'
            active={currentPage === 'my-tasks'}
            onClick={() => onNavigate('my-tasks')}
          />
        </div>
        <div className='space-y-1'>
          <p className='px-3 text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2'>
            Workspace
          </p>
          <SidebarItem
            icon={Layers}
            label='Projects'
            active={
              currentPage === 'projects' || currentPage === 'project-detail'
            }
            onClick={() => onNavigate('projects')}
          />
        </div>
      </nav>

      {/* Footer */}
      <div className='p-3 mt-auto border-t border-zinc-200 dark:border-zinc-800'>
        <SidebarItem
          icon={isDarkMode ? Sparkles : Settings}
          label={isDarkMode ? 'Dark Mode' : 'Settings'}
          onClick={onToggleDarkMode}
        />
      </div>
    </aside>
  )
}

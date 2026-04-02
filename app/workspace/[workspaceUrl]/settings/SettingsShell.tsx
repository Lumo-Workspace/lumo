'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'motion/react'
import {
  ArrowLeft,
  Building2,
  Users,
  Puzzle,
  KeyRound,
  User,
  Settings2,
} from 'lucide-react'

interface SettingsShellProps {
  workspaceUrl: string
  /** Resolved server-side by layout.tsx — no client fetch needed. */
  isOwner: boolean
  children: React.ReactNode
}

export function SettingsShell({
  workspaceUrl,
  isOwner,
  children,
}: SettingsShellProps) {
  const pathname = usePathname()

  const adminItems = [
    {
      label: 'Workspace',
      href: `/workspace/${workspaceUrl}/settings/workspace`,
      icon: Building2,
    },
    {
      label: 'Members',
      href: `/workspace/${workspaceUrl}/settings/members`,
      icon: Users,
    },
    {
      label: 'Integrations',
      href: `/workspace/${workspaceUrl}/settings/integrations`,
      icon: Puzzle,
    },
  ]

  const memberItems = [
    {
      label: 'Members',
      href: `/workspace/${workspaceUrl}/settings/members`,
      icon: Users,
    },
    {
      label: 'Integrations',
      href: `/workspace/${workspaceUrl}/settings/integrations`,
      icon: Puzzle,
    },
  ]

  const personalItems = [
    {
      label: 'Profile',
      href: `/workspace/${workspaceUrl}/settings/profile`,
      icon: User,
    },
    {
      label: 'Preferences',
      href: `/workspace/${workspaceUrl}/settings/preferences`,
      icon: Settings2,
    },
    {
      label: 'API Keys',
      href: `/workspace/${workspaceUrl}/settings/api-keys`,
      icon: KeyRound,
    },
  ]

  const navItems = [
    {
      section: 'Administration',
      items: isOwner ? adminItems : memberItems,
    },
    {
      section: 'Personal',
      items: personalItems,
    },
  ]

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className='flex h-screen bg-white dark:bg-zinc-950 font-sans'
    >
      {/* Left sidebar */}
      <aside className='w-52 shrink-0 flex flex-col border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900'>
        {/* Back to app */}
        <div className='p-4'>
          <Link
            href={`/workspace/${workspaceUrl}`}
            className='flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors'
          >
            <ArrowLeft size={14} />
            Back to app
          </Link>
        </div>

        <div className='mx-4 border-t border-zinc-200 dark:border-zinc-800' />

        {/* Nav sections */}
        <nav className='flex-1 p-3 space-y-5 mt-2'>
          {navItems.map(({ section, items }) => (
            <div key={section}>
              <p className='px-2 mb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500'>
                {section}
              </p>
              <ul className='space-y-0.5'>
                {items.map(({ label, href, icon: Icon }) => {
                  const isActive = pathname === href
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors ${
                          isActive
                            ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-medium'
                            : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100'
                        }`}
                      >
                        <Icon size={14} />
                        {label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className='flex-1 overflow-hidden'>{children}</main>
    </motion.div>
  )
}

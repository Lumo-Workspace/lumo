'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useIntl } from 'react-intl'
import { motion } from 'motion/react'
import {
  ArrowLeft,
  Building2,
  Users,
  Puzzle,
  KeyRound,
  User,
  Settings2,
  Bell,
  Tag,
  CalendarClock,
  Terminal,
  Trash2,
  ScrollText,
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
  const intl = useIntl()

  const adminItems = [
    {
      label: intl.formatMessage({ id: 'settings.workspace' }),
      href: `/workspace/${workspaceUrl}/settings/workspace`,
      icon: Building2,
    },
    {
      label: intl.formatMessage({ id: 'settings.members' }),
      href: `/workspace/${workspaceUrl}/settings/members`,
      icon: Users,
    },
    {
      label: intl.formatMessage({ id: 'settings.integrations' }),
      href: `/workspace/${workspaceUrl}/settings/integrations`,
      icon: Puzzle,
    },
    {
      label: intl.formatMessage({ id: 'settings.tags' }),
      href: `/workspace/${workspaceUrl}/settings/tags`,
      icon: Tag,
    },
    {
      label: intl.formatMessage({ id: 'settings.nav.sprints' }),
      href: `/workspace/${workspaceUrl}/settings/sprints`,
      icon: CalendarClock,
    },
    {
      // LUM-918: every member has a trash (tasks + their own documents).
      label: intl.formatMessage({ id: 'settings.trash' }),
      href: `/workspace/${workspaceUrl}/settings/trash`,
      icon: Trash2,
    },
    {
      // LUM-907: OWNER only — members never see this item.
      label: intl.formatMessage({ id: 'settings.auditLog' }),
      href: `/workspace/${workspaceUrl}/settings/audit-log`,
      icon: ScrollText,
    },
  ]

  const memberItems = [
    {
      label: intl.formatMessage({ id: 'settings.members' }),
      href: `/workspace/${workspaceUrl}/settings/members`,
      icon: Users,
    },
    {
      label: intl.formatMessage({ id: 'settings.integrations' }),
      href: `/workspace/${workspaceUrl}/settings/integrations`,
      icon: Puzzle,
    },
    {
      label: intl.formatMessage({ id: 'settings.tags' }),
      href: `/workspace/${workspaceUrl}/settings/tags`,
      icon: Tag,
    },
    {
      // LUM-918: every member has a trash (tasks + their own documents).
      label: intl.formatMessage({ id: 'settings.trash' }),
      href: `/workspace/${workspaceUrl}/settings/trash`,
      icon: Trash2,
    },
  ]

  const personalItems = [
    {
      label: intl.formatMessage({ id: 'settings.profile' }),
      href: `/workspace/${workspaceUrl}/settings/profile`,
      icon: User,
    },
    {
      label: intl.formatMessage({ id: 'settings.preferences' }),
      href: `/workspace/${workspaceUrl}/settings/preferences`,
      icon: Settings2,
    },
    {
      label: intl.formatMessage({ id: 'settings.notifications' }),
      href: `/workspace/${workspaceUrl}/settings/notifications`,
      icon: Bell,
    },
    {
      label: intl.formatMessage({ id: 'settings.cli' }),
      href: `/workspace/${workspaceUrl}/settings/cli`,
      icon: Terminal,
    },
    {
      label: intl.formatMessage({ id: 'settings.apiKeys' }),
      href: `/workspace/${workspaceUrl}/settings/api-keys`,
      icon: KeyRound,
    },
  ]

  const navItems = [
    {
      section: intl.formatMessage({ id: 'settings.administration' }),
      items: isOwner ? adminItems : memberItems,
    },
    {
      section: intl.formatMessage({ id: 'settings.personal' }),
      items: personalItems,
    },
  ]

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className='flex h-screen bg-card font-sans'
    >
      {/* Left sidebar */}
      <aside className='w-52 shrink-0 flex flex-col border-r border-border bg-muted'>
        {/* Back to app */}
        <div className='p-4'>
          <Link
            href={`/workspace/${workspaceUrl}`}
            className='flex items-center gap-2 text-body text-muted-foreground hover:text-foreground transition-colors'
          >
            <ArrowLeft size={14} />
            {intl.formatMessage({ id: 'settings.backToApp' })}
          </Link>
        </div>

        <div className='mx-4 border-t border-border' />

        {/* Nav sections */}
        <nav className='flex-1 p-3 space-y-5 mt-2'>
          {navItems.map(({ section, items }) => (
            <div key={section}>
              <p className='px-2 mb-1 text-caption font-semibold uppercase text-muted-foreground'>
                {section}
              </p>
              <ul className='space-y-0.5'>
                {items.map(({ label, href, icon: Icon }) => {
                  const isActive = pathname === href
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md transition-colors ${
                          isActive
                            ? 'bg-muted text-body-strong text-foreground'
                            : 'text-body text-muted-foreground hover:bg-muted hover:text-foreground'
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

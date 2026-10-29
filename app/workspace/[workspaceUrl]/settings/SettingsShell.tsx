'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useIntl } from 'react-intl'
import { motion } from 'motion/react'
import {
  ArrowLeft,
  Bell,
  Building2,
  CalendarClock,
  CircleCheck,
  Database,
  Download,
  FolderGit2,
  GitPullRequest,
  Link2,
  ListChecks,
  Puzzle,
  ScrollText,
  Sparkles,
  Tag,
  Terminal,
  Trash2,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { hasPluginSlot } from '@/lib/plugins/client'
import { settingsNav, type SettingsNavIcon } from './settings-nav'

const ICONS: Record<SettingsNavIcon, LucideIcon> = {
  user: User,
  bell: Bell,
  link: Link2,
  terminal: Terminal,
  building: Building2,
  users: Users,
  puzzle: Puzzle,
  tag: Tag,
  calendar: CalendarClock,
  check: CircleCheck,
  gitPullRequest: GitPullRequest,
  folderGit: FolderGit2,
  listChecks: ListChecks,
  database: Database,
  sparkles: Sparkles,
  download: Download,
  scrollText: ScrollText,
  trash: Trash2,
}

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

  // LUM-1339: five groups, one page per area (settings-nav.ts).
  const groups = settingsNav({
    isOwner,
    codeReviewAvailable: hasPluginSlot('settings.codeReview.behavior'),
  })

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className='flex h-screen bg-card font-sans'
    >
      {/* Left sidebar */}
      <aside className='w-52 shrink-0 flex flex-col border-r border-border bg-muted overflow-y-auto'>
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
          {groups.map(group => (
            <div key={group.id}>
              <p className='px-2 mb-1 text-caption font-semibold uppercase text-muted-foreground'>
                {intl.formatMessage({ id: group.labelId })}
              </p>
              <ul className='space-y-0.5'>
                {group.items.map(({ path, labelId, icon }) => {
                  const href = `/workspace/${workspaceUrl}/settings/${path}`
                  const isActive = pathname === href
                  const Icon = ICONS[icon]
                  return (
                    <li key={path}>
                      <Link
                        href={href}
                        aria-current={isActive ? 'page' : undefined}
                        className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md transition-colors ${
                          isActive
                            ? 'bg-muted text-body-strong text-foreground'
                            : 'text-body text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                      >
                        <Icon size={14} />
                        {intl.formatMessage({ id: labelId })}
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

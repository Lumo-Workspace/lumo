'use client'

import Link from 'next/link'
import { Target } from 'lucide-react'
import { useIntl } from 'react-intl'
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import type { Page } from '../../types'

interface InitiativesSidebarItemProps {
  workspaceUrl: string
  currentPage: Page
  onNavigate: (page: Page) => void
}

/**
 * Sidebar entry for the team's materialised Initiatives (LUM-673). Links to
 * `/workspace/<slug>/initiatives`; a plain `<Link>` keeps deep-link/refresh
 * working, and `onNavigate` does the in-app soft navigation. Extracted as its
 * own component (like ProjectsSidebarGroup) so it can be unit-tested without
 * the full sidebar tree.
 */
export function InitiativesSidebarItem({
  workspaceUrl,
  currentPage,
  onNavigate,
}: InitiativesSidebarItemProps) {
  const intl = useIntl()
  const label = intl.formatMessage({ id: 'sidebar.initiatives' })
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={
          currentPage === 'initiatives' || currentPage === 'initiative-detail'
        }
        tooltip={label}
      >
        <Link
          href={`/workspace/${workspaceUrl}/initiatives`}
          onClick={e => {
            e.preventDefault()
            onNavigate('initiatives')
          }}
        >
          <Target />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

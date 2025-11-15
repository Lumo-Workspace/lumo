'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

type NavItem = { href: string; label: string }

interface WorkspaceSidebarNavProps {
  items: NavItem[]
  workspaceUrl: string
}

export function WorkspaceSidebarNav({
  items,
  workspaceUrl,
}: WorkspaceSidebarNavProps) {
  const pathname = usePathname()

  return (
    <SidebarMenu>
      {items.map(item => {
        const isActive = pathname?.includes(item.href.replace('#', ''))
        return (
          <SidebarMenuItem key={item.label}>
            <SidebarMenuButton asChild isActive={isActive}>
              <Link href={`/workspace/${workspaceUrl}`}>
                <span>{item.label}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}

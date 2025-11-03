'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar'

type NavItem = { href: string; label: string }

const draftItems: NavItem[] = [{ href: '#/draft', label: 'Draft' }]

const workspaceItems: NavItem[] = [{ href: '#/documents', label: 'Documents' }]

function WorkspaceSidebarContent({ workspaceUrl }: { workspaceUrl: string }) {
  const pathname = usePathname()

  return (
    <ShadcnSidebar>
      <SidebarHeader>
        <div className='flex items-center px-2 text-sm font-semibold'>
          Workspace
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Draft</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {draftItems.map(item => {
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
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {workspaceItems.map(item => {
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
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </ShadcnSidebar>
  )
}

export function Sidebar({ workspaceUrl }: { workspaceUrl: string }) {
  return (
    <SidebarProvider>
      <WorkspaceSidebarContent workspaceUrl={workspaceUrl} />
    </SidebarProvider>
  )
}

export default Sidebar

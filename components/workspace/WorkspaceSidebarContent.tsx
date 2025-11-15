'use client'

import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
} from '@/components/ui/sidebar'
import { WorkspaceSidebarNav } from './WorkspaceSidebarNav'

type NavItem = { href: string; label: string }

const draftItems: NavItem[] = [{ href: '#/draft', label: 'Draft' }]
const workspaceItems: NavItem[] = [{ href: '#/documents', label: 'Documents' }]

interface WorkspaceSidebarContentProps {
  workspaceUrl: string
}

export function WorkspaceSidebarContent({
  workspaceUrl,
}: WorkspaceSidebarContentProps) {
  return (
    <ShadcnSidebar collapsible='icon'>
      <SidebarHeader>
        <div className='flex items-center px-2 text-sm font-semibold'>
          Workspace
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Draft</SidebarGroupLabel>
          <SidebarGroupContent>
            <WorkspaceSidebarNav
              items={draftItems}
              workspaceUrl={workspaceUrl}
            />
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <WorkspaceSidebarNav
              items={workspaceItems}
              workspaceUrl={workspaceUrl}
            />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </ShadcnSidebar>
  )
}

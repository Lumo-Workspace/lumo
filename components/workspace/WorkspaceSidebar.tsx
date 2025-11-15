'use client'

import { SidebarProvider } from '@/components/ui/sidebar'
import { WorkspaceSidebarContent } from './WorkspaceSidebarContent'

interface WorkspaceSidebarProps {
  workspaceUrl: string
}

export function WorkspaceSidebar({ workspaceUrl }: WorkspaceSidebarProps) {
  return (
    <SidebarProvider>
      <WorkspaceSidebarContent workspaceUrl={workspaceUrl} />
    </SidebarProvider>
  )
}

export default WorkspaceSidebar

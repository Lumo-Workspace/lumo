/** @jest-environment jsdom */

// react-intl → id-as-message so we can assert the visible label by its id.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

// next primitives
jest.mock('next/navigation', () => ({
  useParams: () => ({ workspaceUrl: 'lumo' }),
}))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
jest.mock('@clerk/nextjs', () => ({
  useClerk: () => ({ signOut: jest.fn() }),
}))

// workspace hooks the sidebar reads
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    user: { initials: 'AB', displayName: 'Ada', imageUrl: null },
  }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useWorkspace', () => ({
  useWorkspace: () => ({ workspace: { name: 'Lumo', logoUrl: null } }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useWorkspaceTeams', () => ({
  useWorkspaceTeams: () => ({ teams: [] }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useProjects', () => ({
  useProjects: () => ({ projects: [], setProjects: jest.fn() }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/cache', () => ({
  clearCache: jest.fn(),
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/sidebar/ProjectsSidebarGroup',
  () => ({ ProjectsSidebarGroup: () => null })
)

// UI primitives → lightweight passthroughs (no Radix context / Slot needed).
jest.mock('@/components/ui/sidebar', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>
  return {
    Sidebar: Pass,
    SidebarContent: Pass,
    SidebarGroup: Pass,
    SidebarGroupContent: Pass,
    SidebarGroupLabel: Pass,
    SidebarHeader: Pass,
    SidebarMenu: Pass,
    SidebarMenuButton: Pass,
    SidebarMenuItem: Pass,
    SidebarRail: () => null,
    useSidebar: () => ({ isMobile: false }),
  }
})
jest.mock('@/components/ui/dropdown-menu', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>
  return {
    DropdownMenu: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuItem: Pass,
    DropdownMenuSeparator: () => null,
    DropdownMenuTrigger: Pass,
  }
})
jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
}))

import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import { AppSidebar } from '@/app/workspace/[workspaceUrl]/components/Sidebar'

function renderSidebar(overrides?: {
  currentPage?: string
  onNavigate?: jest.Mock
}) {
  const onNavigate = overrides?.onNavigate ?? jest.fn()
  render(
    <AppSidebar
      currentPage={(overrides?.currentPage ?? 'my-tasks') as never}
      onNavigate={onNavigate}
      unreadCount={0}
      draftCount={0}
    />
  )
  return { onNavigate }
}

describe('workspace sidebar — Ideas entry', () => {
  it('renders an Ideas link pointing at /workspace/<slug>/ideas', () => {
    renderSidebar()
    const link = screen.getByText('sidebar.ideas').closest('a')
    expect(link).not.toBeNull()
    expect(link).toHaveAttribute('href', '/workspace/lumo/ideas')
  })

  it('navigates to the ideas page on click (client-side routing)', () => {
    const { onNavigate } = renderSidebar()
    fireEvent.click(screen.getByText('sidebar.ideas'))
    expect(onNavigate).toHaveBeenCalledWith('ideas')
  })
})

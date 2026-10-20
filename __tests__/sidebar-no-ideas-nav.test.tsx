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
    SidebarFooter: Pass,
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
import { render, screen } from '@testing-library/react'
import { AppSidebar } from '@/app/workspace/[workspaceUrl]/components/Sidebar'
import { pathToPage } from '@/app/workspace/[workspaceUrl]/utils/pathToPage'

function renderSidebar() {
  render(
    <AppSidebar
      currentPage={'my-tasks' as never}
      onNavigate={jest.fn()}
      unreadCount={0}
      draftCount={0}
    />
  )
}

// LUM-1040: the Ideas feature was removed — no sidebar entry, no route.
describe('workspace sidebar — Ideas removed', () => {
  it('renders no Ideas entry and no link to /ideas', () => {
    renderSidebar()
    expect(screen.queryByText('sidebar.ideas')).not.toBeInTheDocument()
    const hrefs = Array.from(document.querySelectorAll('a')).map(a =>
      a.getAttribute('href')
    )
    expect(hrefs).not.toContain('/workspace/lumo/ideas')
    // The neighbouring nav is still there.
    expect(screen.getByText('sidebar.documents')).toBeInTheDocument()
  })

  it('no longer resolves /ideas to a workspace page', () => {
    expect(pathToPage('/workspace/lumo/ideas', 'lumo').page).not.toBe('ideas')
  })
})

// LUM-1083: the Initiatives feature was removed — no sidebar entry, no route.
describe('workspace sidebar — Initiatives removed', () => {
  it('renders no Initiatives entry and no link to /initiatives', () => {
    renderSidebar()
    expect(screen.queryByText('sidebar.initiatives')).not.toBeInTheDocument()
    const hrefs = Array.from(document.querySelectorAll('a')).map(a =>
      a.getAttribute('href')
    )
    expect(hrefs.some(h => h?.includes('/initiatives'))).toBe(false)
    expect(screen.getByText('sidebar.documents')).toBeInTheDocument()
  })

  it('resolves old /initiatives links to the default page', () => {
    expect(pathToPage('/workspace/lumo/initiatives', 'lumo').page).toBe(
      'my-tasks'
    )
    expect(
      pathToPage('/workspace/lumo/initiatives/LUM-INIT-3', 'lumo').page
    ).toBe('my-tasks')
  })
})

// LUM-1287: the footer carries the "Send feedback" entry on every page that
// renders the workspace sidebar.
describe('workspace sidebar — feedback footer', () => {
  it('renders the Send feedback entry', () => {
    renderSidebar()
    expect(screen.getByText('sidebar.feedback')).toBeInTheDocument()
  })
})

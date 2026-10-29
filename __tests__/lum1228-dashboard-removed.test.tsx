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
jest.mock('@/lib/auth/client', () => ({
  useSignOut: () => jest.fn(),
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
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { AppSidebar } from '@/app/workspace/[workspaceUrl]/components/Sidebar'
import { pathToPage } from '@/app/workspace/[workspaceUrl]/utils/pathToPage'
import { pageToPath } from '@/app/workspace/[workspaceUrl]/utils/pageToPath'

const root = process.cwd()
const WS_DIR = join(root, 'app/workspace/[workspaceUrl]')

/**
 * LUM-1228 — the workspace Dashboard page was removed (user ruling
 * 2026-10-17: no redirect, the old URL is a plain 404), and every default
 * landing still resolves to My Tasks. LUM-1231 then removed the run-reviews
 * (spot-check) page it used to link to, the same way.
 */
describe('Dashboard removed (LUM-1228)', () => {
  it('has no /dashboard route: no page and no catch-all that could serve it, so Next answers 404', () => {
    expect(existsSync(join(WS_DIR, 'dashboard'))).toBe(false)
    const segments = readdirSync(WS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
    expect(segments.filter(n => n.startsWith('['))).toEqual([])
    expect(existsSync(join(WS_DIR, 'components/pages/DashboardPage.tsx'))).toBe(
      false
    )
  })

  it('the sidebar shows no Dashboard entry and no /dashboard link', () => {
    render(
      <AppSidebar
        currentPage={'my-tasks' as never}
        onNavigate={jest.fn()}
        unreadCount={0}
        draftCount={0}
      />
    )
    expect(screen.queryByText('sidebar.dashboard')).not.toBeInTheDocument()
    const hrefs = Array.from(document.querySelectorAll('a')).map(a =>
      a.getAttribute('href')
    )
    expect(hrefs.some(h => h?.endsWith('/dashboard'))).toBe(false)
  })

  it('a stale /dashboard entry in the client history resolves to My Tasks', () => {
    expect(pathToPage('/workspace/lumo/dashboard', 'lumo').page).toBe(
      'my-tasks'
    )
    // and nothing navigates there any more
    expect(pageToPath('lumo', 'dashboard' as never)).toBe(
      '/workspace/lumo/my-tasks'
    )
  })

  it('the default landing is My Tasks: /workspace/<slug> redirects there', async () => {
    const redirect = jest.fn((url: string) => {
      throw new Error(`REDIRECT ${url}`)
    })
    jest.resetModules()
    jest.doMock('next/navigation', () => ({ redirect }))
    const { default: WorkspaceAppPage } =
      await import('@/app/workspace/[workspaceUrl]/page')
    await expect(
      WorkspaceAppPage({ params: Promise.resolve({ workspaceUrl: 'lumo' }) })
    ).rejects.toThrow('REDIRECT /workspace/lumo/my-tasks')
  })

  it('no stored preference can name a default page (nothing holds "dashboard")', () => {
    const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8')
    const model = schema.slice(
      schema.indexOf('model UserPreference {'),
      schema.indexOf('}', schema.indexOf('model UserPreference {'))
    )
    const fields = Array.from(model.matchAll(/^\s+(\w+)\s+\S/gm)).map(
      m => m[1]!
    )
    expect(fields).toContain('theme')
    expect(
      fields.filter(f =>
        /dashboard|landing|(home|start|default|last)Page/i.test(f)
      )
    ).toEqual([])
    const prefsHook = readFileSync(
      join(WS_DIR, 'hooks/usePreferences.ts'),
      'utf8'
    )
    expect(prefsHook).not.toMatch(/dashboard/i)
  })
})

describe('run-reviews removed (LUM-1231)', () => {
  it('the sidebar has no Run reviews entry and no /run-reviews link', () => {
    render(
      <AppSidebar
        currentPage={'my-tasks' as never}
        onNavigate={jest.fn()}
        unreadCount={0}
        draftCount={0}
      />
    )
    expect(screen.queryByText('runReviews.title')).not.toBeInTheDocument()
    const hrefs = Array.from(document.querySelectorAll('a')).map(a =>
      a.getAttribute('href')
    )
    expect(hrefs.some(h => h?.endsWith('/run-reviews'))).toBe(false)
  })

  it('has no /run-reviews route, and a stale client entry resolves to My Tasks', () => {
    expect(existsSync(join(WS_DIR, 'run-reviews'))).toBe(false)
    expect(pathToPage('/workspace/lumo/run-reviews', 'lumo').page).toBe(
      'my-tasks'
    )
    expect(pageToPath('lumo', 'run-reviews' as never)).toBe(
      '/workspace/lumo/my-tasks'
    )
  })
})

/** @jest-environment jsdom */
/**
 * LUM-673: the workspace sidebar shows an Initiatives entry that links to
 * /workspace/<slug>/initiatives, so materialized plans are reachable from
 * navigation. The shadcn sidebar primitives are mocked to passthroughs so the
 * test exercises the nav item's link + label without the full sidebar/Clerk
 * context tree.
 */
const messages: Record<string, string> = {
  'sidebar.initiatives': 'Initiatives',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => messages[id] ?? id,
  }),
}))

jest.mock('@/components/ui/sidebar', () => ({
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => (
    <li>{children}</li>
  ),
  // `asChild` renders the single child (the <Link>) directly, like Radix Slot.
  SidebarMenuButton: ({ children }: { children: React.ReactNode }) => children,
}))

import { render, screen } from '@testing-library/react'
import { InitiativesSidebarItem } from '@/app/workspace/[workspaceUrl]/components/sidebar/InitiativesSidebarItem'

describe('InitiativesSidebarItem', () => {
  it('renders an Initiatives entry linking to /workspace/<slug>/initiatives', () => {
    render(
      <InitiativesSidebarItem
        workspaceUrl='acme'
        currentPage='my-tasks'
        onNavigate={() => {}}
      />
    )

    const link = screen.getByRole('link', { name: 'Initiatives' })
    expect(link).toHaveAttribute('href', '/workspace/acme/initiatives')
  })

  it('navigates in-app (no full reload) on click', () => {
    const onNavigate = jest.fn()
    render(
      <InitiativesSidebarItem
        workspaceUrl='acme'
        currentPage='my-tasks'
        onNavigate={onNavigate}
      />
    )

    screen.getByRole('link', { name: 'Initiatives' }).click()
    expect(onNavigate).toHaveBeenCalledWith('initiatives')
  })
})

/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { MilestoneBreadcrumb } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneBreadcrumb'

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => {
      const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
        string,
        string
      >
      return messages[id] ?? id
    },
  }),
}))

// next/link needs the app router context to render; stub it to a plain anchor
// so we can assert hrefs and the breadcrumb structure in isolation.
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
  }: {
    href: string
    children: React.ReactNode
  }) => <a href={href}>{children}</a>,
}))

function setup(
  overrides: Partial<Parameters<typeof MilestoneBreadcrumb>[0]> = {}
) {
  const props = {
    projectsHref: '/workspace/lumo/projects',
    projectHref: '/workspace/lumo/projects/lumo',
    projectName: 'Lumo',
    milestoneName: 'Sprint 能力增强',
    ...overrides,
  }
  return { ...render(<MilestoneBreadcrumb {...props} />), props }
}

describe('MilestoneBreadcrumb', () => {
  it('renders Projects > project > milestone with the right hrefs', () => {
    setup()

    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute(
      'href',
      '/workspace/lumo/projects'
    )
    expect(screen.getByRole('link', { name: 'Lumo' })).toHaveAttribute(
      'href',
      '/workspace/lumo/projects/lumo'
    )

    // The milestone is the current page: BreadcrumbPage renders a non-anchor
    // span carrying aria-current="page" (shadcn gives it role="link", so we
    // assert the tag, not the role).
    const current = screen.getByText('Sprint 能力增强')
    expect(current.tagName).toBe('SPAN')
    expect(current).toHaveAttribute('aria-current', 'page')
  })

  it('exposes exactly the two ancestors as navigable anchors, in order', () => {
    const { container } = setup({
      projectName: 'Backend',
      milestoneName: 'v1.0',
    })

    const anchors = Array.from(container.querySelectorAll('a'))
    expect(anchors.map(a => a.getAttribute('href'))).toEqual([
      '/workspace/lumo/projects',
      '/workspace/lumo/projects/lumo',
    ])
    // The milestone is not one of the navigable anchors.
    expect(anchors.map(a => a.textContent)).not.toContain('v1.0')
  })
})

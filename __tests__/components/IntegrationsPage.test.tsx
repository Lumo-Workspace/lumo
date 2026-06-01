/**
 * IntegrationsPage groups integration cards into TEAM / PERSONAL sections
 * driven by lib/integrations/registry, and floats connected cards to the top
 * within each section via CSS `order`.
 *
 * react-intl and the five (heterogeneous, network-fetching) card components are
 * mocked so the test exercises only the grouping + ordering logic.
 */
const messages: Record<string, string> = {
  'integrations.title': 'Integrations',
  'integrations.description': 'Connect external services.',
  'integrations.team.title': 'Team integrations',
  'integrations.team.description': 'Install once for the entire team.',
  'integrations.personal.title': 'Personal integrations',
  'integrations.personal.description':
    'Each member connects their own account.',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => messages[id] ?? id,
  }),
}))

jest.mock('next/navigation', () => ({
  useParams: () => ({ workspaceUrl: 'acme' }),
}))

jest.mock('sonner', () => ({ toast: { error: jest.fn() } }))

// Which mocked cards should report themselves "connected" on mount. The test
// flips entries before rendering to exercise connected-first ordering.
const CONNECTED: Record<string, boolean> = {}

function mockCard(name: string) {
  const React = require('react')
  return function Card({
    onConnectedChange,
  }: {
    onConnectedChange?: (c: boolean) => void
  }) {
    React.useEffect(() => {
      onConnectedChange?.(CONNECTED[name] ?? false)
    }, [onConnectedChange])
    return React.createElement('div', { 'data-testid': `card-${name}` }, name)
  }
}

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/GitHubIntegrationCard',
  () => ({ GitHubIntegrationCard: mockCard('github') })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/SlackIntegrationCard',
  () => ({ SlackIntegrationCard: mockCard('slack') })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/SentryIntegrationCard',
  () => ({ SentryIntegrationCard: mockCard('sentry') })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/FigmaIntegrationCard',
  () => ({ FigmaIntegrationCard: mockCard('figma') })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/GoogleDriveIntegrationCard',
  () => ({ GoogleDriveIntegrationCard: mockCard('googleDrive') })
)

import { render, screen } from '@testing-library/react'
import { IntegrationsPage } from '@/app/workspace/[workspaceUrl]/components/pages/IntegrationsPage'

function orderOf(testId: string): number {
  const wrapper = screen.getByTestId(testId).parentElement as HTMLElement
  return parseInt(wrapper.style.order, 10)
}

describe('IntegrationsPage', () => {
  beforeEach(() => {
    for (const k of Object.keys(CONNECTED)) delete CONNECTED[k]
  })

  it('renders a TEAM and a PERSONAL section with their headers', () => {
    render(<IntegrationsPage isOwner />)
    expect(screen.getByText('Team integrations')).toBeInTheDocument()
    expect(
      screen.getByText('Install once for the entire team.')
    ).toBeInTheDocument()
    expect(screen.getByText('Personal integrations')).toBeInTheDocument()
    expect(
      screen.getByText('Each member connects their own account.')
    ).toBeInTheDocument()
  })

  it('groups GitHub/Slack/Sentry under TEAM and Figma/Drive under PERSONAL', () => {
    const { container } = render(<IntegrationsPage isOwner />)
    const sections = container.querySelectorAll('section')
    expect(sections).toHaveLength(2)

    const team = sections[0]!
    const personal = sections[1]!
    expect(team.textContent).toContain('Team integrations')
    expect(team.querySelector('[data-testid="card-github"]')).toBeTruthy()
    expect(team.querySelector('[data-testid="card-slack"]')).toBeTruthy()
    expect(team.querySelector('[data-testid="card-sentry"]')).toBeTruthy()
    expect(team.querySelector('[data-testid="card-figma"]')).toBeNull()

    expect(personal.textContent).toContain('Personal integrations')
    expect(personal.querySelector('[data-testid="card-figma"]')).toBeTruthy()
    expect(
      personal.querySelector('[data-testid="card-googleDrive"]')
    ).toBeTruthy()
    expect(personal.querySelector('[data-testid="card-github"]')).toBeNull()
  })

  it('renders all five integration cards exactly once', () => {
    render(<IntegrationsPage isOwner />)
    for (const id of ['github', 'slack', 'sentry', 'figma', 'googleDrive']) {
      expect(screen.getAllByTestId(`card-${id}`)).toHaveLength(1)
    }
  })

  it('floats a connected card above disconnected ones within its section', () => {
    CONNECTED.github = true // connected → should sort ahead of slack/sentry
    render(<IntegrationsPage isOwner />)
    expect(orderOf('card-github')).toBeLessThan(100)
    expect(orderOf('card-slack')).toBeGreaterThanOrEqual(100)
    expect(orderOf('card-sentry')).toBeGreaterThanOrEqual(100)
    expect(orderOf('card-github')).toBeLessThan(orderOf('card-slack'))
  })
})

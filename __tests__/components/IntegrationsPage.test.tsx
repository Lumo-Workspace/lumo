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
  // Card display names — drive the alphabetical within-section ordering.
  // Registry order is slack/sentry/github, so alphabetical (GitHub < Sentry <
  // Slack) is a genuine reordering, not a coincidence of declaration order.
  'github.title': 'GitHub',
  'slack.title': 'Slack',
  'sentry.title': 'Sentry',
  'figma.title': 'Figma',
  'githubAccount.title': 'GitHub account',
  'googleDrive.title': 'Google Drive',
  'integrations.notAvailable': 'Not available on this deployment: {names}.',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }, values?: Record<string, string>) =>
      (messages[id] ?? id).replace(/\{(\w+)\}/g, (_m, k: string) =>
        String(values?.[k] ?? '')
      ),
    formatList: (items: string[]) => items.join(', '),
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
  '@/app/workspace/[workspaceUrl]/components/GitHubAccountCard',
  () => ({ GitHubAccountCard: mockCard('githubAccount') })
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
import type { IntegrationId } from '@/lib/integrations/registry'

const ALL_CONFIGURED: Record<IntegrationId, boolean> = {
  github: true,
  githubAccount: true,
  slack: true,
  sentry: true,
  figma: true,
  googleDrive: true,
}

function orderOf(testId: string): number {
  const wrapper = screen.getByTestId(testId).parentElement as HTMLElement
  return parseInt(wrapper.style.order, 10)
}

function wrapperOf(testId: string): HTMLElement {
  return screen.getByTestId(testId).parentElement as HTMLElement
}

describe('IntegrationsPage', () => {
  beforeEach(() => {
    for (const k of Object.keys(CONNECTED)) delete CONNECTED[k]
  })

  it('renders a TEAM and a PERSONAL section with their headers', () => {
    render(<IntegrationsPage isOwner configured={ALL_CONFIGURED} />)
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
    const { container } = render(
      <IntegrationsPage isOwner configured={ALL_CONFIGURED} />
    )
    const sections = container.querySelectorAll('section')
    expect(sections).toHaveLength(2)

    const team = sections[0]!
    const personal = sections[1]!
    expect(team.textContent).toContain('Team integrations')
    expect(team.querySelector('[data-testid="card-github"]')).toBeTruthy()
    expect(team.querySelector('[data-testid="card-slack"]')).toBeTruthy()
    expect(team.querySelector('[data-testid="card-sentry"]')).toBeTruthy()
    expect(team.querySelector('[data-testid="card-figma"]')).toBeNull()
    // A member's own GitHub link is personal — it must not sit in TEAM.
    expect(team.querySelector('[data-testid="card-githubAccount"]')).toBeNull()
    expect(
      personal.querySelector('[data-testid="card-githubAccount"]')
    ).toBeTruthy()

    expect(personal.textContent).toContain('Personal integrations')
    expect(personal.querySelector('[data-testid="card-figma"]')).toBeTruthy()
    expect(
      personal.querySelector('[data-testid="card-googleDrive"]')
    ).toBeTruthy()
    expect(personal.querySelector('[data-testid="card-github"]')).toBeNull()
  })

  it('renders all six integration cards exactly once', () => {
    render(<IntegrationsPage isOwner configured={ALL_CONFIGURED} />)
    for (const id of [
      'github',
      'slack',
      'sentry',
      'githubAccount',
      'figma',
      'googleDrive',
    ]) {
      expect(screen.getAllByTestId(`card-${id}`)).toHaveLength(1)
    }
  })

  it('floats a connected card above disconnected ones within its section', () => {
    CONNECTED.github = true // connected → should sort ahead of slack/sentry
    render(<IntegrationsPage isOwner configured={ALL_CONFIGURED} />)
    expect(orderOf('card-github')).toBeLessThan(100)
    expect(orderOf('card-slack')).toBeGreaterThanOrEqual(100)
    expect(orderOf('card-sentry')).toBeGreaterThanOrEqual(100)
    expect(orderOf('card-github')).toBeLessThan(orderOf('card-slack'))
  })

  it('orders disconnected cards alphabetically by display name within a section', () => {
    render(<IntegrationsPage isOwner configured={ALL_CONFIGURED} />)
    // TEAM: GitHub < Sentry < Slack (registry order is slack/sentry/github)
    expect(orderOf('card-github')).toBeLessThan(orderOf('card-sentry'))
    expect(orderOf('card-sentry')).toBeLessThan(orderOf('card-slack'))
    // PERSONAL: Figma < GitHub account < Google Drive
    expect(orderOf('card-figma')).toBeLessThan(orderOf('card-githubAccount'))
    expect(orderOf('card-githubAccount')).toBeLessThan(
      orderOf('card-googleDrive')
    )
    // PERSONAL: Figma < Google Drive
    expect(orderOf('card-figma')).toBeLessThan(orderOf('card-googleDrive'))
  })

  it('keeps connected cards ahead of disconnected ones regardless of alphabety', () => {
    CONNECTED.slack = true // Slack sorts last alphabetically but is connected
    render(<IntegrationsPage isOwner configured={ALL_CONFIGURED} />)
    expect(orderOf('card-slack')).toBeLessThan(100)
    expect(orderOf('card-github')).toBeGreaterThanOrEqual(100)
    expect(orderOf('card-sentry')).toBeGreaterThanOrEqual(100)
    expect(orderOf('card-slack')).toBeLessThan(orderOf('card-github'))
  })

  it('orders connected cards alphabetically among themselves', () => {
    CONNECTED.github = true
    CONNECTED.slack = true // both connected → GitHub before Slack
    render(<IntegrationsPage isOwner configured={ALL_CONFIGURED} />)
    expect(orderOf('card-github')).toBeLessThan(100)
    expect(orderOf('card-slack')).toBeLessThan(100)
    expect(orderOf('card-github')).toBeLessThan(orderOf('card-slack'))
  })
})

describe('IntegrationsPage — non-owner visibility', () => {
  beforeEach(() => {
    for (const k of Object.keys(CONNECTED)) delete CONNECTED[k]
  })

  it('hides unconnected TEAM cards but shows connected ones', () => {
    CONNECTED.github = true // only GitHub connected
    render(<IntegrationsPage isOwner={false} configured={ALL_CONFIGURED} />)
    expect(wrapperOf('card-github').hidden).toBe(false)
    expect(wrapperOf('card-slack').hidden).toBe(true)
    expect(wrapperOf('card-sentry').hidden).toBe(true)
  })

  it('always shows PERSONAL cards to non-owners', () => {
    render(<IntegrationsPage isOwner={false} configured={ALL_CONFIGURED} />)
    expect(wrapperOf('card-figma').hidden).toBe(false)
    expect(wrapperOf('card-googleDrive').hidden).toBe(false)
  })

  it('hides the TEAM section when no team integration is connected', () => {
    const { container } = render(
      <IntegrationsPage isOwner={false} configured={ALL_CONFIGURED} />
    )
    const teamSection = container.querySelectorAll('section')[0] as HTMLElement
    expect(teamSection.hidden).toBe(true)
  })

  it('shows the TEAM section when at least one team integration is connected', () => {
    CONNECTED.slack = true
    const { container } = render(
      <IntegrationsPage isOwner={false} configured={ALL_CONFIGURED} />
    )
    const teamSection = container.querySelectorAll('section')[0] as HTMLElement
    expect(teamSection.hidden).toBe(false)
  })
})

describe('IntegrationsPage — owner visibility', () => {
  beforeEach(() => {
    for (const k of Object.keys(CONNECTED)) delete CONNECTED[k]
  })

  it('shows every TEAM card and the TEAM section even when none are connected', () => {
    const { container } = render(
      <IntegrationsPage isOwner configured={ALL_CONFIGURED} />
    )
    expect(wrapperOf('card-github').hidden).toBe(false)
    expect(wrapperOf('card-slack').hidden).toBe(false)
    expect(wrapperOf('card-sentry').hidden).toBe(false)
    const teamSection = container.querySelectorAll('section')[0] as HTMLElement
    expect(teamSection.hidden).toBe(false)
  })
})

describe('LUM-1025 IntegrationsPage — integrations not configured on this deployment', () => {
  beforeEach(() => {
    for (const k of Object.keys(CONNECTED)) delete CONNECTED[k]
  })

  it('does not render an unconfigured card and names it as not available', () => {
    render(
      <IntegrationsPage
        isOwner
        configured={{ ...ALL_CONFIGURED, slack: false, figma: false }}
      />
    )
    expect(screen.queryByTestId('card-slack')).toBeNull()
    expect(screen.queryByTestId('card-figma')).toBeNull()
    expect(screen.getByTestId('card-github')).toBeInTheDocument()
    expect(
      screen.getByText('Not available on this deployment: Figma, Slack.')
    ).toBeInTheDocument()
  })

  it('renders no section and only the note when nothing is configured', () => {
    const none = Object.fromEntries(
      Object.keys(ALL_CONFIGURED).map(id => [id, false])
    ) as Record<IntegrationId, boolean>
    const { container } = render(<IntegrationsPage isOwner configured={none} />)
    expect(container.querySelectorAll('section')).toHaveLength(0)
    expect(
      screen.getByText(/^Not available on this deployment: /)
    ).toBeInTheDocument()
  })

  it('shows no note when every integration is configured', () => {
    render(<IntegrationsPage isOwner configured={ALL_CONFIGURED} />)
    expect(screen.queryByText(/Not available on this deployment/)).toBeNull()
  })
})

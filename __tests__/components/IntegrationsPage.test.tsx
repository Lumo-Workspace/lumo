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
  'integrations.team.description': 'Install once for the entire team.',
  'integrations.personal.description':
    'Each member connects their own account.',
  // Card display names — drive the alphabetical within-section ordering.
  // Registry order is slack/sentry/github, so alphabetical (GitHub < Sentry <
  // Slack) is a genuine reordering, not a coincidence of declaration order.
  'github.title': 'GitHub',
  'codeup.title': 'Codeup',
  'slack.title': 'Slack',
  'sentry.title': 'Sentry',
  'figma.title': 'Figma',
  'githubAccount.title': 'GitHub account',
  'googleDrive.title': 'Google Drive',
  'integrations.notAvailable': 'Not available on this deployment: {names}.',
  'integrations.team.noneConnected':
    'No team integration is connected yet. The workspace owner installs them here.',
  'settings.connectedAccounts': 'Connected accounts',
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
// Cards whose status is still loading: they have not reported yet (LUM-1339).
const LOADING = new Set<string>()

function mockCard(name: string) {
  const React = require('react')
  return function Card({
    onConnectedChange,
  }: {
    onConnectedChange?: (c: boolean) => void
  }) {
    React.useEffect(() => {
      if (!LOADING.has(name)) onConnectedChange?.(CONNECTED[name] ?? false)
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
  '@/app/workspace/[workspaceUrl]/components/CodeupIntegrationCard',
  () => ({ CodeupIntegrationCard: mockCard('codeup') })
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
  codeup: true,
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

describe('IntegrationsPage — one page per kind (LUM-1339)', () => {
  beforeEach(() => {
    for (const k of Object.keys(CONNECTED)) delete CONNECTED[k]
  })

  it('lists only TEAM cards under the Integrations title', () => {
    render(<IntegrationsPage kind='TEAM' isOwner configured={ALL_CONFIGURED} />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Integrations' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Install once for the entire team.')
    ).toBeInTheDocument()
    for (const id of ['github', 'slack', 'sentry', 'codeup']) {
      expect(screen.getAllByTestId(`card-${id}`)).toHaveLength(1)
    }
    // A member's own GitHub link is personal — it must not sit on this page.
    for (const id of ['githubAccount', 'figma', 'googleDrive']) {
      expect(screen.queryByTestId(`card-${id}`)).toBeNull()
    }
  })

  it('lists only PERSONAL cards under the Connected accounts title', () => {
    render(
      <IntegrationsPage kind='PERSONAL' isOwner configured={ALL_CONFIGURED} />
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'Connected accounts' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Each member connects their own account.')
    ).toBeInTheDocument()
    for (const id of ['githubAccount', 'figma', 'googleDrive']) {
      expect(screen.getAllByTestId(`card-${id}`)).toHaveLength(1)
    }
    for (const id of ['github', 'slack', 'sentry', 'codeup']) {
      expect(screen.queryByTestId(`card-${id}`)).toBeNull()
    }
  })

  it('floats a connected card above disconnected ones', () => {
    CONNECTED.github = true // connected → should sort ahead of slack/sentry
    render(<IntegrationsPage kind='TEAM' isOwner configured={ALL_CONFIGURED} />)
    expect(orderOf('card-github')).toBeLessThan(100)
    expect(orderOf('card-slack')).toBeGreaterThanOrEqual(100)
    expect(orderOf('card-sentry')).toBeGreaterThanOrEqual(100)
    expect(orderOf('card-github')).toBeLessThan(orderOf('card-slack'))
  })

  it('orders disconnected cards alphabetically by display name', () => {
    const { unmount } = render(
      <IntegrationsPage kind='TEAM' isOwner configured={ALL_CONFIGURED} />
    )
    // TEAM: GitHub < Sentry < Slack (registry order is slack/sentry/github)
    expect(orderOf('card-github')).toBeLessThan(orderOf('card-sentry'))
    expect(orderOf('card-sentry')).toBeLessThan(orderOf('card-slack'))
    unmount()
    render(
      <IntegrationsPage kind='PERSONAL' isOwner configured={ALL_CONFIGURED} />
    )
    // PERSONAL: Figma < GitHub account < Google Drive
    expect(orderOf('card-figma')).toBeLessThan(orderOf('card-githubAccount'))
    expect(orderOf('card-githubAccount')).toBeLessThan(
      orderOf('card-googleDrive')
    )
  })

  it('keeps connected cards ahead of disconnected ones regardless of alphabety', () => {
    CONNECTED.slack = true // Slack sorts last alphabetically but is connected
    render(<IntegrationsPage kind='TEAM' isOwner configured={ALL_CONFIGURED} />)
    expect(orderOf('card-slack')).toBeLessThan(100)
    expect(orderOf('card-github')).toBeGreaterThanOrEqual(100)
    expect(orderOf('card-slack')).toBeLessThan(orderOf('card-github'))
  })

  it('orders connected cards alphabetically among themselves', () => {
    CONNECTED.github = true
    CONNECTED.slack = true // both connected → GitHub before Slack
    render(<IntegrationsPage kind='TEAM' isOwner configured={ALL_CONFIGURED} />)
    expect(orderOf('card-github')).toBeLessThan(orderOf('card-slack'))
  })
})

describe('IntegrationsPage — non-owner visibility', () => {
  beforeEach(() => {
    for (const k of Object.keys(CONNECTED)) delete CONNECTED[k]
  })

  it('hides unconnected TEAM cards but shows connected ones', () => {
    CONNECTED.github = true // only GitHub connected
    render(
      <IntegrationsPage
        kind='TEAM'
        isOwner={false}
        configured={ALL_CONFIGURED}
      />
    )
    expect(wrapperOf('card-github').hidden).toBe(false)
    expect(wrapperOf('card-slack').hidden).toBe(true)
    expect(wrapperOf('card-sentry').hidden).toBe(true)
    expect(screen.queryByTestId('integrations-none-connected')).toBeNull()
  })

  it('always shows PERSONAL cards to non-owners', () => {
    render(
      <IntegrationsPage
        kind='PERSONAL'
        isOwner={false}
        configured={ALL_CONFIGURED}
      />
    )
    expect(wrapperOf('card-figma').hidden).toBe(false)
    expect(wrapperOf('card-googleDrive').hidden).toBe(false)
  })

  it('says nothing until every team card has reported its status', () => {
    LOADING.add('slack')
    try {
      render(
        <IntegrationsPage
          kind='TEAM'
          isOwner={false}
          configured={ALL_CONFIGURED}
        />
      )
      expect(screen.queryByTestId('integrations-none-connected')).toBeNull()
    } finally {
      LOADING.clear()
    }
  })

  it('says nothing is connected when no team integration is', () => {
    render(
      <IntegrationsPage
        kind='TEAM'
        isOwner={false}
        configured={ALL_CONFIGURED}
      />
    )
    expect(screen.getByTestId('integrations-none-connected')).toHaveTextContent(
      'No team integration is connected yet. The workspace owner installs them here.'
    )
  })
})

describe('IntegrationsPage — owner visibility', () => {
  beforeEach(() => {
    for (const k of Object.keys(CONNECTED)) delete CONNECTED[k]
  })

  it('shows every TEAM card even when none are connected', () => {
    render(<IntegrationsPage kind='TEAM' isOwner configured={ALL_CONFIGURED} />)
    expect(wrapperOf('card-github').hidden).toBe(false)
    expect(wrapperOf('card-slack').hidden).toBe(false)
    expect(wrapperOf('card-sentry').hidden).toBe(false)
    expect(screen.queryByTestId('integrations-none-connected')).toBeNull()
  })
})

describe('LUM-1025 IntegrationsPage — integrations not configured on this deployment', () => {
  beforeEach(() => {
    for (const k of Object.keys(CONNECTED)) delete CONNECTED[k]
  })

  it('does not render an unconfigured card and names it as not available', () => {
    render(
      <IntegrationsPage
        kind='TEAM'
        isOwner
        configured={{ ...ALL_CONFIGURED, slack: false, figma: false }}
      />
    )
    expect(screen.queryByTestId('card-slack')).toBeNull()
    expect(screen.getByTestId('card-github')).toBeInTheDocument()
    // Figma is personal: named on Connected accounts, not here.
    expect(
      screen.getByText('Not available on this deployment: Slack.')
    ).toBeInTheDocument()
  })

  it('names an unconfigured personal integration on Connected accounts', () => {
    render(
      <IntegrationsPage
        kind='PERSONAL'
        isOwner
        configured={{ ...ALL_CONFIGURED, slack: false, figma: false }}
      />
    )
    expect(screen.queryByTestId('card-figma')).toBeNull()
    expect(
      screen.getByText('Not available on this deployment: Figma.')
    ).toBeInTheDocument()
  })

  it('renders no card and only the note when nothing is configured', () => {
    const none = Object.fromEntries(
      Object.keys(ALL_CONFIGURED).map(id => [id, false])
    ) as Record<IntegrationId, boolean>
    render(<IntegrationsPage kind='TEAM' isOwner configured={none} />)
    expect(screen.queryAllByTestId(/^card-/)).toHaveLength(0)
    expect(
      screen.getByText(/^Not available on this deployment: /)
    ).toBeInTheDocument()
  })

  it('shows no note when every integration is configured', () => {
    render(<IntegrationsPage kind='TEAM' isOwner configured={ALL_CONFIGURED} />)
    expect(screen.queryByText(/Not available on this deployment/)).toBeNull()
  })
})

describe('LUM-1315 IntegrationsPage — integrations behind a rollout flag', () => {
  beforeEach(() => {
    for (const k of Object.keys(CONNECTED)) delete CONNECTED[k]
  })

  it('renders the Codeup card on the TEAM page when it is released', () => {
    render(<IntegrationsPage kind='TEAM' isOwner configured={ALL_CONFIGURED} />)
    expect(screen.getByTestId('card-codeup')).toBeInTheDocument()
  })

  it('neither renders nor names an unreleased integration', () => {
    render(
      <IntegrationsPage
        kind='TEAM'
        isOwner
        configured={{ ...ALL_CONFIGURED, codeup: false }}
        unreleased={['codeup']}
      />
    )
    expect(screen.queryByTestId('card-codeup')).toBeNull()
    expect(screen.queryByText(/Codeup/)).toBeNull()
  })

  it('hides an unreleased card even when it is configured', () => {
    render(
      <IntegrationsPage
        kind='TEAM'
        isOwner
        configured={ALL_CONFIGURED}
        unreleased={['codeup']}
      />
    )
    expect(screen.queryByTestId('card-codeup')).toBeNull()
    expect(screen.getByTestId('card-github')).toBeInTheDocument()
  })
})

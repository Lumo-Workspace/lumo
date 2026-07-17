/** @jest-environment jsdom */

// jsdom lacks ResizeObserver, which some Radix internals (Popover/Accordion)
// reference defensively. Same polyfill pattern as IdeaEvidenceTab.test.tsx.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

// react-intl ships ESM jest can't load from node_modules — repo convention is
// an id-as-message passthrough so copy is assertable (see IdeaEvidenceTab.test).
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({
      id,
      defaultMessage,
    }: {
      id: string
      defaultMessage?: string
    }) => defaultMessage ?? id,
  }),
  IntlProvider: ({ children }: { children: React.ReactNode }) => children,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useParams: () => ({ workspaceUrl: 'test-workspace' }),
}))

jest.mock('@/lib/api-client', () => ({
  apiFetch: jest.fn(),
}))

// The evidence lists themselves are not under test here — only the connection
// gate in front of them.
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useIdeaWebLinks', () => ({
  useIdeaWebLinks: jest.fn(),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useIdeaSlackContexts', () => ({
  useIdeaSlackContexts: jest.fn(),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useIdeaFigmaLinks', () => ({
  useIdeaFigmaLinks: jest.fn(),
}))

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IdeaEvidenceTab } from '@/app/workspace/[workspaceUrl]/components/IdeaEvidenceTab'
import { useIdeaWebLinks } from '@/app/workspace/[workspaceUrl]/hooks/useIdeaWebLinks'
import { useIdeaSlackContexts } from '@/app/workspace/[workspaceUrl]/hooks/useIdeaSlackContexts'
import { useIdeaFigmaLinks } from '@/app/workspace/[workspaceUrl]/hooks/useIdeaFigmaLinks'
import { apiFetch } from '@/lib/api-client'

const mockApiFetch = apiFetch as jest.Mock

/** Route the integration-status reads by URL, so a test can say "this
 * workspace has Slack but not Figma" the way reality would. */
function givenWorkspaceIntegrations(connected: {
  slack?: boolean
  figma?: boolean
  github?: boolean
}) {
  mockApiFetch.mockImplementation((url: string) => {
    if (url.startsWith('/api/slack/integration'))
      return Promise.resolve({ connected: connected.slack ?? false })
    if (url.startsWith('/api/figma/integration'))
      return Promise.resolve({ connected: connected.figma ?? false })
    if (url.startsWith('/api/github/integration'))
      return Promise.resolve({ connected: connected.github ?? false })
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  })
}

function renderEvidence() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <IdeaEvidenceTab ideaId='idea1' />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(useIdeaWebLinks as jest.Mock).mockReturnValue({
    webLinks: [],
    loading: false,
    error: null,
    refresh: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
    refreshOne: jest.fn(),
  })
  ;(useIdeaSlackContexts as jest.Mock).mockReturnValue({
    contexts: [],
    loading: false,
    error: null,
    refresh: jest.fn(),
    link: jest.fn(),
    refreshOne: jest.fn(),
    unlink: jest.fn(),
  })
  ;(useIdeaFigmaLinks as jest.Mock).mockReturnValue({
    figmaLinks: [],
    loading: false,
    error: null,
    refresh: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
    refreshAll: jest.fn(),
  })
})

describe('idea evidence ↔ workspace integrations', () => {
  it('idea evidence reuses an already-connected workspace integration', async () => {
    givenWorkspaceIntegrations({ slack: true, figma: true })
    renderEvidence()

    // Once the workspace's Slack state resolves the section shows its normal
    // empty state — never the "not connected" prompt (the LUM-684 bug).
    expect(await screen.findByText('No Slack messages')).toBeInTheDocument()
    expect(screen.queryByText('Slack not connected')).not.toBeInTheDocument()

    // …and attaching a source is offered directly, with no connect step.
    fireEvent.click(screen.getByRole('button', { name: 'slackContext.add' }))
    expect(
      await screen.findByPlaceholderText('task.contextLink.slack.placeholder')
    ).toBeInTheDocument()

    // Same for Figma: connected → straight to the URL input.
    fireEvent.click(
      screen.getByRole('button', { name: 'task.figma.addButton' })
    )
    expect(
      await screen.findByPlaceholderText('Paste a Figma URL…')
    ).toBeInTheDocument()
  })

  it('unconnected integration links to workspace settings not a separate flow', async () => {
    givenWorkspaceIntegrations({ slack: false, figma: false })
    renderEvidence()

    expect(await screen.findByText('Slack not connected')).toBeInTheDocument()

    // The add affordance points at workspace settings — it does not start an
    // idea-local connect flow.
    fireEvent.click(screen.getByRole('button', { name: 'slackContext.add' }))
    const slackCta = await screen.findByRole('link', {
      name: 'task.contextLink.slack.connectCta',
    })
    expect(slackCta).toHaveAttribute(
      'href',
      '/workspace/test-workspace/settings/integrations'
    )
    // No inline OAuth/connect button inside the idea.
    expect(
      screen.queryByRole('button', { name: /connect/i })
    ).not.toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'task.figma.addButton' })
    )
    const figmaCta = await screen.findByRole('link', {
      name: 'Open integrations →',
    })
    expect(figmaCta).toHaveAttribute(
      'href',
      '/workspace/test-workspace/settings/integrations'
    )
  })

  it('never shows a not-connected prompt while the status read is still in flight', () => {
    // Status never resolves — the surface must not guess "not connected".
    mockApiFetch.mockImplementation(() => new Promise(() => {}))
    renderEvidence()

    expect(screen.queryByText('Slack not connected')).not.toBeInTheDocument()
  })

  it('reads each integration from the workspace it is scoped to', async () => {
    givenWorkspaceIntegrations({ slack: true, figma: true })
    renderEvidence()

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/slack/integration?workspaceUrl=test-workspace'
      )
    )
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/figma/integration?workspaceUrl=test-workspace'
    )
  })
})

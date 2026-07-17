/** @jest-environment jsdom */

// jsdom lacks ResizeObserver, which some Radix internals (Popover/Accordion)
// reference defensively. Same polyfill pattern as IdeaDetailPanel.test.tsx.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

// react-intl ships ESM that jest can't load from node_modules directly (see
// ContextTab.test.tsx / RevisionDiffView.test.tsx) — the repo convention is
// to mock it with an id-as-message passthrough so real copy (button labels
// like "Add link") is assertable.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      { id, defaultMessage }: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      const base = defaultMessage ?? id
      return values ? `${base} ${Object.values(values).join(' ')}` : base
    },
  }),
  IntlProvider: ({ children }: { children: React.ReactNode }) => children,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useParams: () => ({ workspaceUrl: 'test-workspace' }),
}))

// Each evidence section reads its own workspace integration state (LUM-684),
// so the status endpoint has to answer for the sections to render their lists.
// The gate itself is covered by idea-evidence-integrations.test.tsx.
jest.mock('@/lib/api-client', () => ({
  apiFetch: jest.fn().mockResolvedValue({ connected: true }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useIdeaWebLinks', () => ({
  useIdeaWebLinks: jest.fn(),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useIdeaSlackContexts', () => ({
  useIdeaSlackContexts: jest.fn(),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useIdeaFigmaLinks', () => ({
  useIdeaFigmaLinks: jest.fn(),
}))

import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { IdeaEvidenceTab } from '@/app/workspace/[workspaceUrl]/components/IdeaEvidenceTab'
import { useIdeaWebLinks } from '@/app/workspace/[workspaceUrl]/hooks/useIdeaWebLinks'
import { useIdeaSlackContexts } from '@/app/workspace/[workspaceUrl]/hooks/useIdeaSlackContexts'
import { useIdeaFigmaLinks } from '@/app/workspace/[workspaceUrl]/hooks/useIdeaFigmaLinks'

const mockWebLinks = useIdeaWebLinks as jest.Mock
const mockSlack = useIdeaSlackContexts as jest.Mock
const mockFigma = useIdeaFigmaLinks as jest.Mock

function renderTab(props: { ideaId: string }) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale='en' messages={{}}>
        <IdeaEvidenceTab {...props} />
      </IntlProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()

  mockWebLinks.mockReturnValue({
    webLinks: [
      {
        id: 'wl1',
        ideaId: 'idea1',
        workspaceId: 'ws1',
        url: 'https://example.com/design-notes',
        domain: 'example.com',
        title: 'Design notes doc',
        description: null,
        note: null,
        imageUrl: null,
        faviconUrl: null,
        fetchedAt: null,
        fetchError: null,
        body: null,
        bodyFetchedAt: null,
        createdById: 'u1',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ],
    loading: false,
    error: null,
    refresh: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
    refreshOne: jest.fn(),
  })

  mockSlack.mockReturnValue({
    contexts: [
      {
        id: 'sc1',
        ideaId: 'idea1',
        workspaceId: 'ws1',
        permalink: 'https://slack.com/archives/C1/p1',
        slackTeamId: 't1',
        slackChannelId: 'C1',
        slackChannelName: 'general',
        rootTs: '1',
        threadTs: null,
        isThread: false,
        snapshot: {
          messages: [
            {
              ts: '1',
              text: 'attached slack message',
              userId: 'u1',
              userName: 'Alice',
            },
          ],
        },
        snapshotAt: '2026-07-01T00:00:00.000Z',
        refreshError: null,
        createdById: 'u1',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    loading: false,
    error: null,
    refresh: jest.fn(),
    link: jest.fn(),
    refreshOne: jest.fn(),
    unlink: jest.fn(),
  })

  mockFigma.mockReturnValue({
    figmaLinks: [
      {
        id: 'fl1',
        fileKey: 'abc',
        nodeId: '1:1',
        url: 'https://figma.com/file/abc',
        fileName: 'Idea evidence mockups',
        frameName: 'Frame 1',
        thumbnailUrl: null,
        thumbnailFetchedAt: null,
        lastSyncedAt: '2026-07-01T00:00:00.000Z',
        lastSyncError: null,
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    loading: false,
    error: null,
    refresh: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
    refreshAll: jest.fn(),
  })
})

describe('IdeaEvidenceTab', () => {
  it('idea evidence tab lists attached evidence and offers add controls', async () => {
    renderTab({ ideaId: 'idea1' })

    // Attached web link renders (title, falling back to domain if untitled).
    expect(screen.getByText('Design notes doc')).toBeInTheDocument()

    // Attached Slack context and Figma link also render, proving all three
    // idea evidence sections are wired to their hooks. Slack resolves async
    // now that the section reads the workspace's integration state itself.
    expect(
      await screen.findByText('attached slack message')
    ).toBeInTheDocument()
    expect(screen.getByText('Idea evidence mockups')).toBeInTheDocument()

    // Add controls (popover triggers) are present for each evidence kind,
    // identified by their aria-label (SectionAddButton sets aria-label from
    // the popover's i18n key — mocked react-intl above passes the id through).
    expect(
      screen.getByRole('button', { name: 'task.webLinks.addButton' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'slackContext.add' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'task.figma.addButton' })
    ).toBeInTheDocument()
  })
})

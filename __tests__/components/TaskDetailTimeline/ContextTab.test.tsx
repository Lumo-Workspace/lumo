jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (d: { id?: string; defaultMessage?: string }) =>
      d.id ?? d.defaultMessage ?? '',
  }),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useParams: () => ({ workspaceUrl: 'test-workspace' }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useSlackContexts', () => ({
  useSlackContexts: jest.fn(),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTaskDocuments', () => ({
  useTaskDocuments: jest.fn(),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useFigmaLinks', () => ({
  useFigmaLinks: jest.fn(),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useWebLinks', () => ({
  useWebLinks: jest.fn(),
}))
jest.mock('@/app/workspace/[workspaceUrl]/components/LinkPrPopover', () => ({
  LinkPrPopover: () => <div />,
}))
// LUM-1064: core test, run without the security plugin (the OSS build).
jest.mock('@/lib/plugins/installed.client', () => ({
  INSTALLED_CLIENT_PLUGINS: [],
}))
jest.mock('@/app/workspace/[workspaceUrl]/components/pr-helpers', () => ({
  PrStateBadge: () => <span />,
  CiIcon: () => <span />,
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/SpecArtifactGroup',
  () => ({ SpecArtifactGroup: () => <div data-testid='spec-artifacts' /> })
)

import { render, screen } from '@testing-library/react'
import { ContextTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ContextTab'
import { useSlackContexts } from '@/app/workspace/[workspaceUrl]/hooks/useSlackContexts'
import { useTaskDocuments } from '@/app/workspace/[workspaceUrl]/hooks/useTaskDocuments'
import { useFigmaLinks } from '@/app/workspace/[workspaceUrl]/hooks/useFigmaLinks'
import { useWebLinks } from '@/app/workspace/[workspaceUrl]/hooks/useWebLinks'

const mockSlack = useSlackContexts as jest.Mock
const mockDocs = useTaskDocuments as jest.Mock
const mockFigma = useFigmaLinks as jest.Mock
const mockWebLinks = useWebLinks as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockSlack.mockReturnValue({
    contexts: [],
    loading: false,
    error: null,
    refresh: jest.fn(),
    link: jest.fn(),
    refreshOne: jest.fn(),
    unlink: jest.fn(),
  })
  mockDocs.mockReturnValue({
    documents: [],
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
  mockFigma.mockReturnValue({
    figmaLinks: [],
    loading: false,
    error: null,
    refresh: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
    refreshAll: jest.fn(),
  })
  mockWebLinks.mockReturnValue({
    webLinks: [],
    loading: false,
    error: null,
    refresh: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
    refreshOne: jest.fn(),
  })
})

const baseProps = {
  taskId: 'tsk_1',
  workspaceId: 'ws_1',
  workspaceUrl: 'lumo',
  slackConnected: true,
  pullRequests: [],
  onLinkPr: jest.fn(),
  onUnlinkPr: jest.fn(),
  enabled: true,
}

describe('ContextTab', () => {
  it('renders all three section headers', () => {
    render(<ContextTab {...baseProps} />)
    expect(screen.getByText('task.context.section.slack')).toBeInTheDocument()
    expect(screen.getByText('task.pullRequests')).toBeInTheDocument()
    expect(
      screen.getByText('task.context.section.documents')
    ).toBeInTheDocument()
  })

  it('defaults a section open when its count is > 0', () => {
    mockSlack.mockReturnValue({
      contexts: [
        {
          id: 'c1',
          snapshot: {
            messages: [{ ts: '1', text: 't', userId: 'u', userName: null }],
          },
          snapshotAt: '',
          isThread: false,
          permalink: '#',
          slackChannelName: 'general',
          refreshError: null,
        },
      ],
      loading: false,
      error: null,
      refresh: jest.fn(),
      link: jest.fn(),
      refreshOne: jest.fn(),
      unlink: jest.fn(),
    })
    render(<ContextTab {...baseProps} />)
    expect(screen.getByText('#general')).toBeInTheDocument()
  })

  it('defaults a section closed when its count is 0', () => {
    render(<ContextTab {...baseProps} />)
    expect(
      screen.queryByText('task.context.documents.empty')
    ).not.toBeInTheDocument()
  })

  it('renders the spec artifacts group at the top of the context tab', () => {
    render(<ContextTab {...baseProps} />)
    expect(screen.getByTestId('spec-artifacts')).toBeInTheDocument()
  })

  it('labels the external links as the References group', () => {
    render(<ContextTab {...baseProps} />)
    expect(screen.getByText('context.group.reference')).toBeInTheDocument()
  })
})

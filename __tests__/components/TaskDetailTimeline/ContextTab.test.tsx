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
jest.mock('@/app/workspace/[workspaceUrl]/components/LinkPrPopover', () => ({
  LinkPrPopover: () => <div />,
}))
jest.mock('@/app/workspace/[workspaceUrl]/components/pr-helpers', () => ({
  PrStateBadge: () => <span />,
  CiIcon: () => <span />,
}))

import { render, screen } from '@testing-library/react'
import { ContextTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ContextTab'
import { useSlackContexts } from '@/app/workspace/[workspaceUrl]/hooks/useSlackContexts'
import { useTaskDocuments } from '@/app/workspace/[workspaceUrl]/hooks/useTaskDocuments'

const mockSlack = useSlackContexts as jest.Mock
const mockDocs = useTaskDocuments as jest.Mock

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
})

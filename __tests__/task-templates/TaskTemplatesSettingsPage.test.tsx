/** @jest-environment jsdom */
/**
 * LUM-970: Settings → Task templates. Everyone sees the list; only OWNERs
 * get create / edit / delete, and built-ins are never editable.
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))
jest.mock('@/lib/api-client', () => ({
  ApiClientError: class extends Error {},
  taskTemplatesClient: {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}))

import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { taskTemplatesClient } from '@/lib/api-client'
import { TaskTemplatesSettingsPage } from '@/app/workspace/[workspaceUrl]/components/pages/TaskTemplatesSettingsPage'

const client = taskTemplatesClient as unknown as Record<string, jest.Mock>

const templates = [
  {
    id: null,
    key: 'agent-brief',
    name: 'Agent brief',
    description: 'Goal, non-goals',
    content: '## Goal',
    contentHtml: '<h2>Goal</h2>',
    isSystem: true,
  },
  {
    id: 'tt_1',
    key: 'bug-report',
    name: 'Bug report',
    description: null,
    content: '## Repro',
    contentHtml: '<h2>Repro</h2>',
    isSystem: false,
  },
]

function renderPage(canManage: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <TaskTemplatesSettingsPage canManage={canManage} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  client.list!.mockResolvedValue({ templates })
})

describe('TaskTemplatesSettingsPage', () => {
  it('owner: can create, and edit/delete only workspace templates', async () => {
    renderPage(true)
    await screen.findByText('Bug report')
    expect(
      screen.getByRole('button', { name: /taskTemplate.settings.create/ })
    ).toBeInTheDocument()
    const builtIn = screen.getByTestId('task-template-row-agent-brief')
    expect(builtIn.querySelectorAll('button')).toHaveLength(0)
    const custom = screen.getByTestId('task-template-row-bug-report')
    expect(custom.querySelectorAll('button')).toHaveLength(2)
  })

  it('member: read-only list with the owner-only note', async () => {
    renderPage(false)
    await screen.findByText('Bug report')
    expect(
      screen.queryByRole('button', { name: /taskTemplate.settings.create/ })
    ).toBeNull()
    expect(
      screen.getByText('taskTemplate.settings.ownerOnly')
    ).toBeInTheDocument()
    expect(
      screen
        .getByTestId('task-template-row-bug-report')
        .querySelectorAll('button')
    ).toHaveLength(0)
  })

  it('owner: creating posts key / name / Markdown content', async () => {
    client.create!.mockResolvedValue({ template: templates[1] })
    renderPage(true)
    await screen.findByText('Bug report')
    fireEvent.click(
      screen.getByRole('button', { name: /taskTemplate.settings.create/ })
    )
    fireEvent.change(screen.getByLabelText('taskTemplate.settings.name'), {
      target: { value: 'Spike' },
    })
    fireEvent.change(screen.getByLabelText('taskTemplate.settings.key'), {
      target: { value: 'Spike' },
    })
    fireEvent.change(screen.getByLabelText('taskTemplate.settings.content'), {
      target: { value: '## Question' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.create' }))
    await waitFor(() =>
      expect(client.create).toHaveBeenCalledWith({
        key: 'spike',
        name: 'Spike',
        content: '## Question',
      })
    )
  })
})

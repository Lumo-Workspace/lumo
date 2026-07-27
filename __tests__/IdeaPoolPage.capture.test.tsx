/** @jest-environment jsdom */

// LUM-708: the inline capture input on the Ideas page — the web counterpart of
// `lumo idea`. Enter posts a non-blank statement through the ideas API client
// and clears the field; a blank value posts nothing.

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => (values ? `${id} ${Object.values(values).join(' ')}` : id),
    formatDate: (d: Date) => `date:${d.getUTCFullYear()}`,
  }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const mockUseIdeas = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useIdeas', () => ({
  useIdeas: () => mockUseIdeas(),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/usePlanRuns', () => ({
  usePlanRuns: () => ({
    runs: [],
    loading: false,
    error: null,
    refetch: jest.fn(),
  }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useIdeaGrouping', () => ({
  useIdeaGrouping: () => ({ clustering: null, loading: false, error: null }),
}))

// PageBreadcrumb pulls in SidebarTrigger -> useSidebar, which needs a
// SidebarProvider ancestor; the repo's other page suites stub it the same way.
jest.mock('@/app/workspace/[workspaceUrl]/components/PageBreadcrumb', () => ({
  PageBreadcrumb: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useUpdateIdea', () => ({
  useUpdateIdea: () => ({
    updateStatement: jest.fn(),
    saving: false,
    error: null,
  }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useUpdateIdeaStatus', () => ({
  useUpdateIdeaStatus: () => ({
    updateStatus: jest.fn(),
    updating: false,
    error: null,
  }),
}))

// The capture mutation is the subject — drive the real hook against a mocked
// api-client so the assertion lands on the POST payload the page produces.
const mockCapture = jest.fn()
jest.mock('@/lib/api-client', () => ({
  ideasClient: {
    capture: (...args: unknown[]) => mockCapture(...args),
  },
}))

import '@testing-library/jest-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IdeaPoolPage } from '@/app/workspace/[workspaceUrl]/components/pages/IdeaPoolPage'
import type { ApiIdea } from '@/app/workspace/[workspaceUrl]/types'

const existing: ApiIdea = {
  id: 'i1',
  number: 1,
  identifier: 'LUM-I1',
  statement: 'faster search',
  status: 'CAPTURED',
  sourceContext: null,
  sourceSessionId: null,
  sourceTaskId: null,
  proposedByMemberId: 'm1',
  createdAt: '2026-07-04T10:00:00.000Z',
  planRunId: null,
  initiative: null,
}

function renderPool() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <IdeaPoolPage workspaceUrl='lumo' />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockUseIdeas.mockReturnValue({
    ideas: [existing],
    loading: false,
    error: null,
    refetch: jest.fn(),
  })
  mockCapture.mockResolvedValue({
    idea: { ...existing, id: 'i2', identifier: 'LUM-I2', statement: 'new one' },
  })
})

describe('idea pool inline capture', () => {
  it('creates the idea on Enter and clears the input', async () => {
    renderPool()

    const input = screen.getByTestId('idea-capture-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  new one  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // The trimmed statement is what reaches the API client.
    await waitFor(() =>
      expect(mockCapture).toHaveBeenCalledWith({ statement: 'new one' })
    )
    // …and the field empties, ready for the next capture.
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('posts nothing when the input is blank or whitespace only', () => {
    renderPool()

    const input = screen.getByTestId('idea-capture-input')
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mockCapture).not.toHaveBeenCalled()
  })

  it('leaves the pool alone on any other key', () => {
    renderPool()

    const input = screen.getByTestId('idea-capture-input')
    fireEvent.change(input, { target: { value: 'not submitted yet' } })
    fireEvent.keyDown(input, { key: 'a' })

    expect(mockCapture).not.toHaveBeenCalled()
  })
})

/** @jest-environment jsdom */

// id-as-message, with the interpolated values appended so assertions can see
// what the dialog passed (e.g. the FB ref in the toast).
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => (values ? `${id} ${JSON.stringify(values)}` : id),
  }),
}))

const submitMock = jest.fn()
jest.mock('@/lib/api-client', () => ({
  ApiClientError: jest.requireActual('@/lib/api-client/base').ApiClientError,
  feedbackClient: { submit: (...a: unknown[]) => submitMock(...a) },
}))

const toastSuccess = jest.fn()
const toastWarning = jest.fn()
jest.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    warning: (...a: unknown[]) => toastWarning(...a),
  },
}))

// The real menu button needs a SidebarProvider; a plain button is enough to
// check the item opens the dialog.
jest.mock('@/components/ui/sidebar', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>
  return {
    SidebarMenu: Pass,
    SidebarMenuItem: Pass,
    SidebarMenuButton: ({
      children,
      onClick,
    }: {
      children?: React.ReactNode
      onClick?: () => void
    }) => (
      <button type='button' onClick={onClick}>
        {children}
      </button>
    ),
  }
})

import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FeedbackDialog } from '@/app/workspace/[workspaceUrl]/components/sidebar/FeedbackDialog'
import { FeedbackSidebarItem } from '@/app/workspace/[workspaceUrl]/components/sidebar/FeedbackSidebarItem'
import { ApiClientError } from '@/lib/api-client/base'
import { FEEDBACK_EVIDENCE_MAX_BYTES } from '@/lib/validation/feedback'

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
})

beforeEach(() => {
  jest.clearAllMocks()
})

function withQuery(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

function renderDialog() {
  const onClose = jest.fn()
  render(withQuery(<FeedbackDialog onClose={onClose} />))
  return { onClose }
}

const sendButton = () =>
  screen.getByRole('button', { name: /feedback\.action\.send/ })

function png(name: string, size = 100): File {
  const f = new File(['x'], name, { type: 'image/png' })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('LUM-1287 FeedbackDialog', () => {
  it('puts focus in the title when it opens', async () => {
    renderDialog()
    await waitFor(() =>
      expect(screen.getByLabelText('feedback.field.title')).toHaveFocus()
    )
  })

  it('keeps Send disabled until there is a title', async () => {
    const user = userEvent.setup()
    renderDialog()
    expect(sendButton()).toBeDisabled()
    await user.type(screen.getByLabelText('feedback.field.title'), '   ')
    expect(sendButton()).toBeDisabled()
    await user.type(screen.getByLabelText('feedback.field.title'), 'Crash')
    expect(sendButton()).toBeEnabled()
  })

  it('shows what-happened / expected for a bug, one details box otherwise', async () => {
    const user = userEvent.setup()
    renderDialog()
    expect(screen.getByLabelText('feedback.field.actual')).toBeInTheDocument()
    expect(screen.getByLabelText('feedback.field.expected')).toBeInTheDocument()
    expect(
      screen.queryByLabelText('feedback.field.details')
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'feedback.kind.idea' }))
    expect(screen.getByLabelText('feedback.field.details')).toBeInTheDocument()
    expect(
      screen.queryByLabelText('feedback.field.actual')
    ).not.toBeInTheDocument()
  })

  it('sends a bug report with its screenshots, toasts the ref and closes', async () => {
    const user = userEvent.setup()
    submitMock.mockResolvedValue({ ref: 'FB-12', failedFiles: [] })
    const { onClose } = renderDialog()

    await user.type(
      screen.getByLabelText('feedback.field.title'),
      'Board crashes'
    )
    await user.type(
      screen.getByLabelText('feedback.field.actual'),
      'White screen'
    )
    const shot = png('shot.png')
    await user.upload(screen.getByLabelText('feedback.field.screenshots'), shot)
    await user.click(sendButton())

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(submitMock).toHaveBeenCalledWith(
      {
        kind: 'BUG',
        title: 'Board crashes',
        actual: 'White screen',
        expected: null,
      },
      [shot]
    )
    expect(toastSuccess).toHaveBeenCalledWith('feedback.sent {"ref":"FB-12"}')
  })

  it('sends an idea’s details as `expected`', async () => {
    const user = userEvent.setup()
    submitMock.mockResolvedValue({ ref: 'FB-13', failedFiles: [] })
    renderDialog()

    await user.click(screen.getByRole('radio', { name: 'feedback.kind.idea' }))
    await user.type(screen.getByLabelText('feedback.field.title'), 'Dark mode')
    await user.type(screen.getByLabelText('feedback.field.details'), 'Please')
    await user.click(sendButton())

    await waitFor(() =>
      expect(submitMock).toHaveBeenCalledWith(
        { kind: 'IDEA', title: 'Dark mode', expected: 'Please' },
        []
      )
    )
  })

  it('warns when some screenshots could not be attached', async () => {
    const user = userEvent.setup()
    const shot = png('shot.png')
    submitMock.mockResolvedValue({ ref: 'FB-14', failedFiles: [shot] })
    const { onClose } = renderDialog()

    await user.type(screen.getByLabelText('feedback.field.title'), 'T')
    await user.click(sendButton())

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(toastWarning).toHaveBeenCalledWith(
      'feedback.sent.partial {"ref":"FB-14","count":1}'
    )
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('refuses an oversized screenshot before sending', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.type(screen.getByLabelText('feedback.field.title'), 'T')
    await user.upload(
      screen.getByLabelText('feedback.field.screenshots'),
      png('huge.png', FEEDBACK_EVIDENCE_MAX_BYTES + 1)
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'feedback.error.fileTooLarge'
    )
    expect(screen.getByRole('alert')).toHaveTextContent('huge.png')
    expect(sendButton()).toBeDisabled()
  })

  it('shows the rate-limit message on 429 and keeps the text', async () => {
    const user = userEvent.setup()
    submitMock.mockRejectedValue(
      new ApiClientError('feedback limit reached', 429, 'RATE_LIMITED')
    )
    const { onClose } = renderDialog()

    await user.type(screen.getByLabelText('feedback.field.title'), 'Keep me')
    await user.click(sendButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'feedback.error.rateLimited'
    )
    expect(screen.getByLabelText('feedback.field.title')).toHaveValue('Keep me')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows the generic message on any other failure', async () => {
    const user = userEvent.setup()
    submitMock.mockRejectedValue(new ApiClientError('boom', 500))
    renderDialog()

    await user.type(screen.getByLabelText('feedback.field.title'), 'T')
    await user.click(sendButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'feedback.error.generic'
    )
  })
})

describe('LUM-1287 FeedbackSidebarItem', () => {
  it('opens the feedback dialog from the sidebar entry', async () => {
    const user = userEvent.setup()
    render(withQuery(<FeedbackSidebarItem />))
    expect(screen.queryByText('feedback.dialog.title')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'sidebar.feedback' }))
    expect(screen.getByText('feedback.dialog.title')).toBeInTheDocument()
  })
})

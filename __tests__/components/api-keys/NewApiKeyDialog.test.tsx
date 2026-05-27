/**
 * Mock react-intl per LinkDocPopover.test.tsx pattern — formatMessage
 * returns the en string when known, otherwise falls back to the key id.
 */
const en: Record<string, string> = {
  'apiKeys.newKeyTitle': 'API key created',
  'apiKeys.newKeyDesc': "Copy this key now — it won't be shown again.",
  'common.close': 'Close',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { NewApiKeyDialog } from '@/app/workspace/[workspaceUrl]/components/api-keys/NewApiKeyDialog'

describe('NewApiKeyDialog', () => {
  function renderDialog(
    overrides: Partial<React.ComponentProps<typeof NewApiKeyDialog>> = {}
  ) {
    const props: React.ComponentProps<typeof NewApiKeyDialog> = {
      open: true,
      keyValue: 'lum_test_123',
      copied: false,
      onCopy: jest.fn(),
      onClose: jest.fn(),
      ...overrides,
    }
    render(<NewApiKeyDialog {...props} />)
    return props
  }

  it('renders the one-time key value when open', () => {
    renderDialog({ keyValue: 'lum_abc_def' })
    expect(screen.getByText('lum_abc_def')).toBeInTheDocument()
  })

  it('renders the title and description from i18n', () => {
    renderDialog()
    expect(screen.getByText('API key created')).toBeInTheDocument()
    expect(
      screen.getByText("Copy this key now — it won't be shown again.")
    ).toBeInTheDocument()
  })

  it('invokes onCopy when the copy button is clicked', () => {
    const onCopy = jest.fn()
    renderDialog({ onCopy })
    fireEvent.click(screen.getByRole('button', { name: /copy/i }))
    expect(onCopy).toHaveBeenCalledTimes(1)
  })

  it('invokes onClose when the close action is clicked', () => {
    const onClose = jest.fn()
    renderDialog({ onClose })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not render the dialog content when closed', () => {
    renderDialog({ open: false })
    expect(screen.queryByText('lum_test_123')).not.toBeInTheDocument()
  })
})

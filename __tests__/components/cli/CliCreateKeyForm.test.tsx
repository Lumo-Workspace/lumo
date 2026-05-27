const en: Record<string, string> = {
  'cli.step.login.labelPlaceholder': 'Key label (e.g. Claude Code on Macbook)',
  'cli.step.login.createSubmit': 'Create API key',
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

const baseHookReturn = {
  keys: [],
  loading: false,
  label: '',
  setLabel: jest.fn(),
  creating: false,
  newKey: null as { key: string } | null,
  setNewKey: jest.fn(),
  copied: false,
  revokeTarget: null,
  setRevokeTarget: jest.fn(),
  revoking: false,
  handleCreate: jest.fn().mockResolvedValue(undefined),
  handleRevoke: jest.fn().mockResolvedValue(undefined),
  handleCopy: jest.fn().mockResolvedValue(undefined),
}

const useApiKeysMock = jest.fn(() => baseHookReturn)

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useApiKeys', () => ({
  useApiKeys: () => useApiKeysMock(),
}))

import { CliCreateKeyForm } from '@/app/workspace/[workspaceUrl]/components/cli/CliCreateKeyForm'

describe('CliCreateKeyForm', () => {
  beforeEach(() => {
    useApiKeysMock.mockReturnValue({ ...baseHookReturn, label: '' })
  })

  it('renders the label input and the create button', () => {
    render(<CliCreateKeyForm />)
    expect(
      screen.getByPlaceholderText('Key label (e.g. Claude Code on Macbook)')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Create API key' })
    ).toBeInTheDocument()
  })

  it('disables the create button when label is empty', () => {
    render(<CliCreateKeyForm />)
    expect(
      screen.getByRole('button', { name: 'Create API key' })
    ).toBeDisabled()
  })

  it('enables the create button and calls handleCreate when clicked', () => {
    const handleCreate = jest.fn().mockResolvedValue(undefined)
    useApiKeysMock.mockReturnValue({
      ...baseHookReturn,
      label: 'My laptop',
      handleCreate,
    })
    render(<CliCreateKeyForm />)
    const button = screen.getByRole('button', { name: 'Create API key' })
    expect(button).not.toBeDisabled()
    fireEvent.click(button)
    expect(handleCreate).toHaveBeenCalledTimes(1)
  })

  it('shows the NewApiKeyDialog when newKey is populated', () => {
    useApiKeysMock.mockReturnValue({
      ...baseHookReturn,
      newKey: {
        key: 'lum_freshly_minted',
      } as typeof baseHookReturn.newKey,
    })
    render(<CliCreateKeyForm />)
    expect(screen.getByText('lum_freshly_minted')).toBeInTheDocument()
    expect(screen.getByText('API key created')).toBeInTheDocument()
  })

  it('calls setNewKey(null) when the dialog close action fires', () => {
    const setNewKey = jest.fn()
    useApiKeysMock.mockReturnValue({
      ...baseHookReturn,
      newKey: { key: 'lum_x' } as typeof baseHookReturn.newKey,
      setNewKey,
    })
    render(<CliCreateKeyForm />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(setNewKey).toHaveBeenCalledWith(null)
  })
})

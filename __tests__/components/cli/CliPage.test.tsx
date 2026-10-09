const en: Record<string, string> = {
  'apiKeys.newKeyTitle': 'API key created',
  'apiKeys.newKeyDesc': "Copy this key now — it won't be shown again.",
  'common.close': 'Close',
  'cli.subtitle':
    'Lumo command-line interface — install, log in, and stay up to date.',
  'cli.step.install.title': 'Install',
  'cli.step.install.description':
    'Installs the CLI globally and wires up the Claude Code skill and hooks.',
  'cli.step.login.title': 'Log in',
  'cli.step.login.description':
    'Opens this page in your browser. Create a key below or on the API Keys page, then paste it back into the terminal.',
  'cli.step.login.labelPlaceholder': 'Key label (e.g. Claude Code on Macbook)',
  'cli.step.login.createSubmit': 'Create API key',
  'cli.step.update.title': 'Stay up to date',
  'cli.step.update.description':
    "Upgrades to the latest npm release. Don't run npm install -g manually after the first install.",
  'cli.copy': 'Copy',
  'cli.copied': 'Copied',
  'settings.cli': 'CLI',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

const baseHookReturn = {
  keys: [],
  loading: false,
  label: '',
  setLabel: jest.fn(),
  creating: false,
  newKey: null,
  setNewKey: jest.fn(),
  copied: false,
  revokeTarget: null,
  setRevokeTarget: jest.fn(),
  revoking: false,
  handleCreate: jest.fn().mockResolvedValue(undefined),
  handleRevoke: jest.fn().mockResolvedValue(undefined),
  handleCopy: jest.fn().mockResolvedValue(undefined),
}

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useApiKeys', () => ({
  useApiKeys: () => baseHookReturn,
}))

import { render, screen } from '@testing-library/react'
import { CliPage } from '@/app/workspace/[workspaceUrl]/components/pages/CliPage'

describe('CliPage', () => {
  it('renders the page title and subtitle', () => {
    render(<CliPage />)
    expect(screen.getByRole('heading', { name: 'CLI' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Lumo command-line interface — install, log in, and stay up to date.'
      )
    ).toBeInTheDocument()
  })

  it('renders all three step titles', () => {
    render(<CliPage />)
    expect(screen.getByText('Install')).toBeInTheDocument()
    expect(screen.getByText('Log in')).toBeInTheDocument()
    expect(screen.getByText('Stay up to date')).toBeInTheDocument()
  })

  it('renders all three numeric badges', () => {
    render(<CliPage />)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders the install commands', () => {
    render(<CliPage />)
    expect(screen.getByText('npm install -g @lumoai/cli')).toBeInTheDocument()
    expect(screen.getByText('lumo init')).toBeInTheDocument()
  })

  it('renders the login command', () => {
    render(<CliPage />)
    expect(screen.getByText('lumo auth login')).toBeInTheDocument()
  })

  it('renders the update command', () => {
    render(<CliPage />)
    expect(screen.getByText('lumo update')).toBeInTheDocument()
  })

  it('embeds the create-API-key form inside step 2', () => {
    render(<CliPage />)
    expect(
      screen.getByPlaceholderText('Key label (e.g. Claude Code on Macbook)')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Create API key' })
    ).toBeInTheDocument()
  })
})

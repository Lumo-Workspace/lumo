/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { MilestoneActionsMenu } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneActionsMenu'

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => {
      const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
        string,
        string
      >
      return messages[id] ?? id
    },
  }),
}))

// Radix's dropdown relies on portals + pointer capture that jsdom doesn't
// implement, and the repo doesn't test it elsewhere. Stub the primitives to
// passthrough so we can assert the menu's real logic: which items show per
// archived state, and that each item is wired to the right callback.
jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
    disabled,
  }: {
    children: React.ReactNode
    onSelect?: () => void
    disabled?: boolean
  }) => (
    <button disabled={disabled} onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}))

function setup(overrides: Partial<Parameters<typeof MilestoneActionsMenu>[0]> = {}) {
  const props = {
    archived: false,
    disabled: false,
    onEdit: jest.fn(),
    onArchiveToggle: jest.fn(),
    onDelete: jest.fn(),
    ...overrides,
  }
  render(<MilestoneActionsMenu {...props} />)
  return props
}

describe('MilestoneActionsMenu', () => {
  it('renders edit, archive and delete and wires each callback when not archived', () => {
    const props = setup()
    expect(
      screen.getByLabelText('Open milestone actions')
    ).toBeInTheDocument()

    screen.getByText('Edit milestone').click()
    expect(props.onEdit).toHaveBeenCalledTimes(1)

    screen.getByText('Archive').click()
    expect(props.onArchiveToggle).toHaveBeenCalledTimes(1)

    screen.getByText('Delete milestone').click()
    expect(props.onDelete).toHaveBeenCalledTimes(1)

    expect(screen.queryByText('Unarchive')).not.toBeInTheDocument()
  })

  it('hides edit and offers unarchive when archived', () => {
    const props = setup({ archived: true })
    expect(screen.queryByText('Edit milestone')).not.toBeInTheDocument()
    expect(screen.queryByText('Archive')).not.toBeInTheDocument()

    screen.getByText('Unarchive').click()
    expect(props.onArchiveToggle).toHaveBeenCalledTimes(1)
  })

  it('disables archive and delete while a mutation is pending', () => {
    setup({ disabled: true })
    expect(screen.getByText('Archive').closest('button')).toBeDisabled()
    expect(
      screen.getByText('Delete milestone').closest('button')
    ).toBeDisabled()
  })
})

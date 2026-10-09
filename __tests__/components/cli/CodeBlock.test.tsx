const en: Record<string, string> = {
  'cli.copy': 'Copy',
  'cli.copied': 'Copied',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

import { render, screen, fireEvent, act } from '@testing-library/react'
import { CodeBlock } from '@/app/workspace/[workspaceUrl]/components/cli/CodeBlock'

beforeAll(() => {
  Object.assign(navigator, {
    clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
  })
})

beforeEach(() => {
  ;(navigator.clipboard.writeText as jest.Mock).mockClear()
  jest.useFakeTimers()
})

afterEach(() => {
  act(() => {
    jest.runOnlyPendingTimers()
  })
  jest.useRealTimers()
})

describe('CodeBlock', () => {
  it('renders every line with a leading $ prompt', () => {
    render(<CodeBlock lines={['npm install -g @lumoai/cli', 'lumo init']} />)
    expect(screen.getByText('npm install -g @lumoai/cli')).toBeInTheDocument()
    expect(screen.getByText('lumo init')).toBeInTheDocument()
    expect(screen.getAllByText('$').length).toBe(2)
  })

  it('renders one copy button per line', () => {
    render(<CodeBlock lines={['cmd-a', 'cmd-b']} />)
    expect(screen.getAllByRole('button', { name: /copy/i }).length).toBe(2)
  })

  it('writes the corresponding line to the clipboard when copy clicked', async () => {
    render(<CodeBlock lines={['npm install -g @lumoai/cli', 'lumo init']} />)
    const buttons = screen.getAllByRole('button', { name: /copy/i })
    await act(async () => {
      fireEvent.click(buttons[1]!)
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('lumo init')
  })

  it('flips the button icon to a check after copy then back after 2s', async () => {
    render(<CodeBlock lines={['lumo update']} />)
    const button = screen.getByRole('button', { name: /copy/i })
    await act(async () => {
      fireEvent.click(button)
    })
    expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument()
    act(() => {
      jest.advanceTimersByTime(2000)
    })
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
  })
})

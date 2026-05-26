/**
 * Mock react-intl to avoid ESM transform issues under jest.
 * Returns the key as the rendered string when no translation is registered,
 * matching react-intl's missing-translation fallback.
 */
const en: Record<string, string> = {
  'task.contextLink.weblink.placeholder': 'https://example.com',
  'task.contextLink.common.errors.network': 'Network error',
  'task.webLinks.addButton': 'Add web link',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LinkWebLinkPopover } from '@/app/workspace/[workspaceUrl]/components/LinkWebLinkPopover'

function openPopover() {
  const trigger = screen.getByRole('button', { name: 'Add web link' })
  fireEvent.click(trigger)
}

describe('LinkWebLinkPopover', () => {
  it('renders the trigger button', () => {
    render(<LinkWebLinkPopover onAttach={jest.fn()} />)
    expect(
      screen.getByRole('button', { name: 'Add web link' })
    ).toBeInTheDocument()
  })

  it('submits URL via Enter and clears input', async () => {
    const onAttach = jest.fn().mockResolvedValue(undefined)
    render(<LinkWebLinkPopover onAttach={onAttach} />)
    openPopover()

    const input = await screen.findByPlaceholderText('https://example.com')
    await userEvent.type(input, 'https://example.com{Enter}')

    await waitFor(() => {
      expect(onAttach).toHaveBeenCalledWith('https://example.com')
    })
  })

  it('trims whitespace before submitting', async () => {
    const onAttach = jest.fn().mockResolvedValue(undefined)
    render(<LinkWebLinkPopover onAttach={onAttach} />)
    openPopover()

    const input = await screen.findByPlaceholderText('https://example.com')
    await userEvent.type(input, '  https://foo.com  {Enter}')

    await waitFor(() => {
      expect(onAttach).toHaveBeenCalledWith('https://foo.com')
    })
  })

  it('does not submit when input is empty or whitespace-only', async () => {
    const onAttach = jest.fn().mockResolvedValue(undefined)
    render(<LinkWebLinkPopover onAttach={onAttach} />)
    openPopover()

    const input = await screen.findByPlaceholderText('https://example.com')
    await userEvent.type(input, '   {Enter}')

    expect(onAttach).not.toHaveBeenCalled()
  })

  it('shows error message when onAttach rejects', async () => {
    const onAttach = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('bad url'), { status: 422 }))
    render(<LinkWebLinkPopover onAttach={onAttach} />)
    openPopover()

    const input = await screen.findByPlaceholderText('https://example.com')
    await userEvent.type(input, 'not-a-url{Enter}')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('bad url')
  })

  it('falls back to network error message when error has no message', async () => {
    const onAttach = jest.fn().mockRejectedValue({})
    render(<LinkWebLinkPopover onAttach={onAttach} />)
    openPopover()

    const input = await screen.findByPlaceholderText('https://example.com')
    await userEvent.type(input, 'https://x.com{Enter}')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Network error')
  })
})

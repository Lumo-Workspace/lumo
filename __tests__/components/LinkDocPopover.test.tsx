/**
 * Mock react-intl to avoid ESM transform issues under jest.
 * Returns the key as the rendered string when no translation is registered,
 * matching react-intl's missing-translation fallback.
 */
const en: Record<string, string> = {
  'task.contextLink.doc.placeholder':
    'Search documents or paste a doc URL / slug',
  'task.contextLink.doc.searchEmpty': 'No documents match',
  'task.contextLink.common.errors.network': 'Network error',
  'task.documents.addButton': 'Add document',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LinkDocPopover } from '@/app/workspace/[workspaceUrl]/components/LinkDocPopover'

function openPopover() {
  const trigger = screen.getByRole('button', { name: 'Add document' })
  fireEvent.click(trigger)
}

describe('LinkDocPopover', () => {
  it('renders the trigger button', () => {
    render(
      <LinkDocPopover
        onSearch={jest.fn().mockResolvedValue([])}
        onAttach={jest.fn()}
      />
    )
    expect(
      screen.getByRole('button', { name: 'Add document' })
    ).toBeInTheDocument()
  })

  it('attaches by documentId when user clicks a search result', async () => {
    const onSearch = jest.fn().mockResolvedValue([
      {
        id: 'cltestabc12345678901234567',
        title: 'Roadmap',
        emoji: null,
        slug: 'roadmap-3',
      },
    ])
    const onAttach = jest.fn().mockResolvedValue(undefined)
    render(<LinkDocPopover onSearch={onSearch} onAttach={onAttach} />)
    openPopover()

    const input = await screen.findByPlaceholderText(
      'Search documents or paste a doc URL / slug'
    )
    await userEvent.type(input, 'road')

    const hit = await screen.findByText('Roadmap')
    await userEvent.click(hit)

    await waitFor(() => {
      expect(onAttach).toHaveBeenCalledWith({
        documentId: 'cltestabc12345678901234567',
      })
    })
  })

  it('attaches by identifier when input is slug-N and Enter is pressed', async () => {
    const onSearch = jest.fn().mockResolvedValue([])
    const onAttach = jest.fn().mockResolvedValue(undefined)
    render(<LinkDocPopover onSearch={onSearch} onAttach={onAttach} />)
    openPopover()

    const input = await screen.findByPlaceholderText(
      'Search documents or paste a doc URL / slug'
    )
    await userEvent.type(input, 'roadmap-42{Enter}')

    await waitFor(() => {
      expect(onAttach).toHaveBeenCalledWith({ identifier: 'roadmap-42' })
    })
    // Identifier branch must not hit the search endpoint
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('attaches by identifier when input is a doc URL', async () => {
    const onSearch = jest.fn().mockResolvedValue([])
    const onAttach = jest.fn().mockResolvedValue(undefined)
    render(<LinkDocPopover onSearch={onSearch} onAttach={onAttach} />)
    openPopover()

    const input = await screen.findByPlaceholderText(
      'Search documents or paste a doc URL / slug'
    )
    const url = 'https://www.uselumo.ai/workspace/lumo/documents/roadmap-42'
    await userEvent.type(input, `${url}{Enter}`)

    await waitFor(() => {
      expect(onAttach).toHaveBeenCalledWith({ identifier: url })
    })
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('attaches by identifier when input is a cuid', async () => {
    const onSearch = jest.fn().mockResolvedValue([])
    const onAttach = jest.fn().mockResolvedValue(undefined)
    render(<LinkDocPopover onSearch={onSearch} onAttach={onAttach} />)
    openPopover()

    const input = await screen.findByPlaceholderText(
      'Search documents or paste a doc URL / slug'
    )
    const cuid = 'cmpm5iyh8003g04icczs9szx0'
    await userEvent.type(input, `${cuid}{Enter}`)

    await waitFor(() => {
      expect(onAttach).toHaveBeenCalledWith({ identifier: cuid })
    })
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('shows error message when onAttach rejects', async () => {
    const onAttach = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('bad'), { status: 422 }))
    render(
      <LinkDocPopover
        onSearch={jest.fn().mockResolvedValue([])}
        onAttach={onAttach}
      />
    )
    openPopover()

    const input = await screen.findByPlaceholderText(
      'Search documents or paste a doc URL / slug'
    )
    await userEvent.type(input, 'roadmap-42{Enter}')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('bad')
  })

  it('falls back to network error when rejection has no message', async () => {
    const onAttach = jest.fn().mockRejectedValue({})
    render(
      <LinkDocPopover
        onSearch={jest.fn().mockResolvedValue([])}
        onAttach={onAttach}
      />
    )
    openPopover()

    const input = await screen.findByPlaceholderText(
      'Search documents or paste a doc URL / slug'
    )
    await userEvent.type(input, 'roadmap-42{Enter}')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Network error')
  })
})

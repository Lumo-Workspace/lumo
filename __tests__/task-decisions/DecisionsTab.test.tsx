/**
 * LUM-1303: the Decisions tab (option B) — numbered cards ("Decision N"),
 * newest first, with an optional "Why"; record from a collapsible composer
 * card, edit in place and delete from the ⋯ menu.
 */
import '@testing-library/jest-dom'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'

jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      locale: 'en',
      formatMessage: (
        { id, defaultMessage }: { id: string; defaultMessage?: string },
        values?: Record<string, string | number>
      ) =>
        Object.entries(values ?? {}).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
          messages[id] ?? defaultMessage ?? id
        ),
      formatDate: (d: string) => new Date(d).toISOString().slice(0, 10),
    }),
  }
})

const add = jest.fn()
const edit = jest.fn()
const remove = jest.fn()
let decisions: unknown[] = []
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTaskDecisions', () => ({
  useTaskDecisions: () => ({
    decisions,
    loading: false,
    error: null,
    add,
    edit,
    remove,
  }),
}))

// jsdom has no PointerEvent, so fireEvent.pointerDown would drop `button`
// and the Radix DropdownMenu trigger (which opens on pointerdown) ignores it.
if (typeof window.PointerEvent === 'undefined') {
  window.PointerEvent = class extends MouseEvent {} as typeof PointerEvent
}

import { DecisionsTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/DecisionsTab'

const row = (over: Record<string, unknown>) => ({
  id: 'd1',
  taskId: 't1',
  number: 1,
  text: 'keep `v1`',
  rationale: null,
  createdById: 'm1',
  sourceSessionId: null,
  createdAt: '2026-10-04T09:00:00Z',
  updatedAt: '2026-10-04T09:00:00Z',
  ...over,
})

const authors = new Map([['m1', { name: 'Ada', imageUrl: null }]])
const renderTab = () =>
  render(<DecisionsTab taskId='t1' authors={authors} enabled />)

beforeEach(() => {
  jest.clearAllMocks()
  add.mockResolvedValue({})
  edit.mockResolvedValue({})
  remove.mockResolvedValue({})
  decisions = []
})

describe('DecisionsTab', () => {
  it('empty: says so and opens the composer from its button', () => {
    renderTab()
    expect(screen.getByText('No decisions yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }))
    expect(screen.getByLabelText('Decision')).toHaveFocus()
  })

  it('cards: newest first, "Decision N", Why, author and date', () => {
    decisions = [
      row({ id: 'd1', number: 1, text: 'older', createdById: null }),
      row({
        id: 'd3',
        number: 3,
        text: 'keep `v1`',
        rationale: 'v2 is separate',
        sourceSessionId: 's1',
        createdAt: '2026-10-05T09:00:00Z',
      }),
    ]
    renderTab()
    const cards = screen.getAllByRole('listitem')
    expect(cards[0]).toHaveAccessibleName('Decision 3')
    expect(cards[0]).toHaveTextContent('Decision 3')
    expect(cards[0]?.querySelector('code')).toHaveTextContent('v1')
    expect(cards[0]).toHaveTextContent('Why v2 is separate')
    // A CLI write shows as the member — no agent marker.
    expect(cards[0]).toHaveTextContent('Ada · 2026-10-05')
    expect(cards[0]).not.toHaveTextContent(/agent/i)
    // A decision moved over from a description has no author.
    expect(cards[1]).toHaveTextContent('Decision 1')
    expect(cards[1]).toHaveTextContent(
      'Moved from the description · 2026-10-04'
    )
  })

  it('records from the collapsible composer; the rationale is optional', async () => {
    decisions = [row({})]
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Record a decision' }))
    const save = screen.getByRole('button', { name: 'Record decision' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Decision'), {
      target: { value: ' ship v2 ' },
    })
    fireEvent.click(save)
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({ text: 'ship v2', rationale: null })
    )
    // Collapses back to the one-line button.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Record a decision' })
      ).toBeInTheDocument()
    )
  })

  it('Escape cancels the composer without recording', () => {
    decisions = [row({})]
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Record a decision' }))
    fireEvent.keyDown(screen.getByLabelText('Decision'), { key: 'Escape' })
    expect(screen.queryByLabelText('Decision')).toBeNull()
    expect(add).not.toHaveBeenCalled()
  })

  it('edits in place from the ⋯ menu, keeping the number', async () => {
    decisions = [row({ number: 4, rationale: 'why' })]
    renderTab()
    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Actions for Decision 4' }),
      { button: 0, ctrlKey: false }
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    const card = screen.getByRole('listitem')
    expect(card).toHaveTextContent('Decision 4')
    fireEvent.change(within(card).getByLabelText('Why (optional)'), {
      target: { value: '' },
    })
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith({
        id: 'd1',
        text: 'keep `v1`',
        rationale: null,
      })
    )
  })

  it('deletes from the ⋯ menu after confirming', async () => {
    decisions = [row({ number: 2 })]
    renderTab()
    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Actions for Decision 2' }),
      { button: 0, ctrlKey: false }
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(
      await screen.findByRole('alertdialog', { name: 'Delete Decision 2?' })
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('d1'))
  })

  it('a failed delete keeps the dialog open and shows why', async () => {
    remove.mockRejectedValueOnce(new Error('Decision not found'))
    decisions = [row({ number: 2 })]
    renderTab()
    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Actions for Decision 2' }),
      { button: 0, ctrlKey: false }
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Decision not found'
    )
    expect(
      screen.getByRole('alertdialog', { name: 'Delete Decision 2?' })
    ).toBeInTheDocument()
  })
})

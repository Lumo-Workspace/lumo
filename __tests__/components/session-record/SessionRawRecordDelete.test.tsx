/**
 * @jest-environment jsdom
 *
 * LUM-944 — the "delete this session's raw record" control: hidden unless the
 * viewer may delete, a confirm dialog that states the counts (including the
 * events an undispositioned crossing keeps) and that summaries stay, batched
 * passes until done, and the kept count reported afterwards.
 */
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQueryClient as render } from '../../helpers/query-client'
import { SessionRawRecordDelete } from '@/components/session-record/SessionRawRecordDelete'
import { sessionsClient } from '@/lib/api-client'
import { toast } from 'sonner'

// react-intl ships ESM jest can't load; a stand-in over the real en.json
// that understands the `{n, plural, one {…} other {…}}` and `{x}` forms used here.
function formatIcu(text: string, values: Record<string, unknown> = {}): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const open = text.indexOf('{', i)
    if (open === -1) return out + text.slice(i)
    out += text.slice(i, open)
    let depth = 0
    let end = open
    for (; end < text.length; end++) {
      if (text[end] === '{') depth++
      else if (text[end] === '}' && --depth === 0) break
    }
    const body = text.slice(open + 1, end)
    const plural = /^(\w+),\s*plural,\s*/.exec(body)
    if (plural) {
      const n = Number(values[plural[1]!])
      const branches: Record<string, string> = {}
      const re = /(\w+)\s*\{([^{}]*)\}/g
      let m: RegExpExecArray | null
      while ((m = re.exec(body.slice(plural[0].length))))
        branches[m[1]!] = m[2]!
      const pick = (n === 1 ? branches.one : undefined) ?? branches.other ?? ''
      out += pick.replace(/#/g, String(n))
    } else {
      out += String(values[body] ?? '')
    }
    i = end + 1
  }
  return out
}

jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      locale: 'en',
      formatMessage: (
        { id }: { id: string },
        values?: Record<string, unknown>
      ) => {
        const text = messages[id]
        if (text === undefined) throw new Error(`missing message ${id}`)
        return formatIcu(text, values)
      },
      formatDate: (value: string) => `date(${value})`,
    }),
  }
})
jest.mock('@/lib/api-client', () => ({
  sessionsClient: {
    getRawRecordStatus: jest.fn(),
    deleteRawRecordBatch: jest.fn(),
  },
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))

const client = sessionsClient as unknown as Record<string, jest.Mock>

const STATUS = {
  canDelete: true,
  totalEvents: 12,
  deletable: 10,
  keptForCrossings: 2,
  deleted: 0,
  lastDeletion: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  client.getRawRecordStatus!.mockResolvedValue(STATUS)
})

describe('SessionRawRecordDelete (LUM-944)', () => {
  it('renders nothing when the viewer may not delete', async () => {
    client.getRawRecordStatus!.mockResolvedValue({
      ...STATUS,
      canDelete: false,
    })
    const { container } = render(<SessionRawRecordDelete sessionId='s1' />)
    await waitFor(() =>
      expect(client.getRawRecordStatus).toHaveBeenCalledWith('s1')
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('confirm dialog shows deletable and crossing-kept counts and that summaries stay', async () => {
    render(<SessionRawRecordDelete sessionId='s1' />)
    expect(
      await screen.findByTestId('session-raw-record-kept')
    ).toHaveTextContent(
      '2 events keep their raw content because an undispositioned boundary crossing points at them'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete raw record…' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(
      'This clears the raw content and the one-line turn summaries of 10 events in this session and its subagent sessions.'
    )
    expect(
      screen.getByTestId('session-raw-record-confirm-kept')
    ).toHaveTextContent(
      '2 more events are linked to an undispositioned boundary crossing'
    )
    expect(dialog).toHaveTextContent(
      'The session summary and run summary are not deleted here.'
    )
    expect(client.deleteRawRecordBatch).not.toHaveBeenCalled()
  })

  it('confirming runs batched passes with the cursor and reports the kept count', async () => {
    client
      .deleteRawRecordBatch!.mockResolvedValueOnce({
        deleted: 6,
        keptForCrossings: 1,
        done: false,
        cursor: 'e6',
      })
      .mockResolvedValueOnce({
        deleted: 4,
        keptForCrossings: 1,
        done: true,
        cursor: null,
      })
    const onDeleted = jest.fn()
    render(<SessionRawRecordDelete sessionId='s1' onDeleted={onDeleted} />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete raw record…' })
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete raw record' })
    )

    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
    expect(client.deleteRawRecordBatch!.mock.calls).toEqual([
      ['s1', null],
      ['s1', 'e6'],
    ])
    expect(toast.success).toHaveBeenCalledWith(
      'Deleted the raw content of 10 events. 2 events were kept because of an undispositioned boundary crossing; delete again once it is dispositioned.'
    )
    // Status is re-read after the delete.
    expect(client.getRawRecordStatus).toHaveBeenCalledTimes(2)
  })

  it('shows who deleted last and disables the button when nothing is left', async () => {
    client.getRawRecordStatus!.mockResolvedValue({
      ...STATUS,
      deletable: 0,
      keptForCrossings: 0,
      deleted: 12,
      lastDeletion: { at: '2026-10-03T08:00:00.000Z', byName: 'Ada' },
    })
    render(<SessionRawRecordDelete sessionId='s1' />)
    expect(
      await screen.findByTestId('session-raw-record-deleted')
    ).toHaveTextContent(
      'Raw content of 12 events deleted · last on date(2026-10-03T08:00:00.000Z) by Ada'
    )
    expect(
      screen.getByRole('button', { name: 'Nothing left to delete' })
    ).toBeDisabled()
  })

  it('a failed pass shows the error toast and does not call onDeleted', async () => {
    client.deleteRawRecordBatch!.mockRejectedValue(new Error('boom'))
    const onDeleted = jest.fn()
    render(<SessionRawRecordDelete sessionId='s1' onDeleted={onDeleted} />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete raw record…' })
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete raw record' })
    )
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(onDeleted).not.toHaveBeenCalled()
  })
})

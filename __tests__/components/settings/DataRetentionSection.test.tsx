/**
 * LUM-933 — Settings → Data retention renders one row per kind of data with
 * its own save, and warns before a session record change that lets the next
 * daily cleanup clear history.
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react'
import { DataRetentionSection } from '@/app/workspace/[workspaceUrl]/components/settings/DataRetentionSection'
import { workspacesClient } from '@/lib/api-client'

// react-intl ships ESM only; resolve messages from the real en.json so a
// missing key fails the test instead of rendering its id.
jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      formatMessage: (
        { id }: { id: string },
        values?: Record<string, unknown>
      ) => {
        const text = messages[id]
        if (text === undefined) throw new Error(`missing message ${id}`)
        return text.replace(/\{(\w+)\}/g, (_m: string, k: string) =>
          String(values?.[k] ?? '')
        )
      },
    }),
  }
})
jest.mock('@/lib/api-client', () => ({
  workspacesClient: { updateMe: jest.fn() },
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))

const updateMe = workspacesClient.updateMe as jest.Mock

const DEFAULTS = {
  // An existing workspace after the migration: nothing chosen yet.
  hookEventRetentionMode: 'RETAIN',
  hookEventRetentionDays: null,
  scanEvidenceRetentionDays: 7,
  crossingRawRetentionDays: 7,
  deadLetterRetentionDays: 7,
}

function renderSection(settings = DEFAULTS) {
  return render(<DataRetentionSection settings={settings} />)
}

function select(rowId: string) {
  return within(screen.getByTestId(`retention-row-${rowId}`)).getByRole(
    'combobox'
  ) as HTMLSelectElement
}

beforeEach(() => {
  jest.clearAllMocks()
  updateMe.mockResolvedValue({})
})

describe('DataRetentionSection', () => {
  it('data retention block shows four rows with their defaults', async () => {
    renderSection()
    expect(screen.getByText('Data retention')).toBeInTheDocument()
    for (const row of [
      'session-record',
      'scan-evidence',
      'crossing-raw',
      'dead-letter',
    ]) {
      expect(screen.getByTestId(`retention-row-${row}`)).toBeInTheDocument()
    }

    const session = select('session-record')
    expect(session.value).toBe('forever')
    expect(Array.from(session.options).map(o => o.textContent)).toEqual([
      'Keep forever (default)',
      '30 days',
      '90 days',
      '180 days',
      '365 days',
      'Discard when used up',
    ])
    expect(select('scan-evidence').value).toBe('7')
    expect(
      Array.from(select('scan-evidence').options).map(o => o.value)
    ).toEqual(['0', '7', '14', '30'])
    expect(select('crossing-raw').value).toBe('7')
    expect(
      Array.from(select('crossing-raw').options).map(o => o.value)
    ).toEqual(['7', '30', '90'])
    expect(select('dead-letter').value).toBe('7')
    expect(Array.from(select('dead-letter').options).map(o => o.value)).toEqual(
      ['7', '30', '90']
    )

    // Each row saves only its own fields.
    fireEvent.change(select('session-record'), { target: { value: 'used_up' } })
    fireEvent.click(
      within(screen.getByTestId('retention-row-session-record')).getByRole(
        'button'
      )
    )
    await waitFor(() =>
      expect(updateMe).toHaveBeenCalledWith({
        hookEventRetentionMode: 'USED_UP',
        hookEventRetentionDays: null,
      })
    )
    fireEvent.change(select('dead-letter'), { target: { value: '30' } })
    fireEvent.click(
      within(screen.getByTestId('retention-row-dead-letter')).getByRole(
        'button'
      )
    )
    await waitFor(() =>
      expect(updateMe).toHaveBeenLastCalledWith({ deadLetterRetentionDays: 30 })
    )
    fireEvent.change(select('crossing-raw'), { target: { value: '90' } })
    fireEvent.click(
      within(screen.getByTestId('retention-row-crossing-raw')).getByRole(
        'button'
      )
    )
    await waitFor(() =>
      expect(updateMe).toHaveBeenLastCalledWith({
        crossingRawRetentionDays: 90,
      })
    )
  })

  it('session record row warns that shortening clears older raw events', async () => {
    renderSection()
    expect(
      screen.queryByTestId('retention-warning-session-record')
    ).not.toBeInTheDocument()

    fireEvent.change(select('session-record'), { target: { value: '30' } })
    const warning = screen.getByTestId('retention-warning-session-record')
    // LUM-933 ruling: a stricter setting only governs data stored afterwards.
    expect(warning).toHaveTextContent(
      /applies only to session records stored from now on/i
    )
    expect(warning).toHaveTextContent(/not cleared by this change/i)
    expect(warning).not.toHaveTextContent(/cannot be restored/i)

    fireEvent.change(select('session-record'), { target: { value: 'used_up' } })
    expect(
      screen.getByTestId('retention-warning-session-record')
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('retention-hint-session-record')
    ).toHaveTextContent(/Code and command output are not stored/)

    // Back to the saved choice: no warning.
    fireEvent.change(select('session-record'), { target: { value: 'forever' } })
    expect(
      screen.queryByTestId('retention-warning-session-record')
    ).not.toBeInTheDocument()

    // Once a shorter tier is saved, lengthening it again does not warn.
    fireEvent.change(select('session-record'), { target: { value: '30' } })
    fireEvent.click(
      within(screen.getByTestId('retention-row-session-record')).getByRole(
        'button'
      )
    )
    await waitFor(() =>
      expect(updateMe).toHaveBeenCalledWith({
        hookEventRetentionMode: 'RETAIN',
        hookEventRetentionDays: 30,
      })
    )
    await waitFor(() =>
      expect(
        screen.queryByTestId('retention-warning-session-record')
      ).not.toBeInTheDocument()
    )
    fireEvent.change(select('session-record'), { target: { value: '365' } })
    expect(
      screen.queryByTestId('retention-warning-session-record')
    ).not.toBeInTheDocument()
  })

  it('crossing row notes that a shorter window only applies to new rulings', () => {
    renderSection({ ...DEFAULTS, crossingRawRetentionDays: 30 })
    expect(
      screen.queryByTestId('retention-warning-crossing-raw')
    ).not.toBeInTheDocument()
    fireEvent.change(select('crossing-raw'), { target: { value: '7' } })
    expect(
      screen.getByTestId('retention-warning-crossing-raw')
    ).toHaveTextContent(/only to crossings dispositioned from now on/i)
  })

  it('reads a stored used-up mode back as the used-up choice', () => {
    renderSection({
      ...DEFAULTS,
      hookEventRetentionMode: 'USED_UP',
      hookEventRetentionDays: null,
    })
    expect(select('session-record').value).toBe('used_up')
  })
})

/** @jest-environment jsdom */
import '@testing-library/jest-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockUpdate = jest.fn()
const mockToastSuccess = jest.fn()
const mockToastError = jest.fn()

jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))
jest.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => mockToastSuccess(...a),
    error: (...a: unknown[]) => mockToastError(...a),
  },
}))
jest.mock('@/lib/api-client', () => ({
  sprintsClient: { update: (...a: unknown[]) => mockUpdate(...a) },
}))
// A picker stub whose button, when clicked, fires onChange with a fixed date.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/fields/DatePickerField',
  () => ({
    startOfDay: (d: Date) => d,
    DatePickerField: ({
      value,
      onChange,
    }: {
      value: Date
      onChange: (d: Date) => void
    }) => (
      <button
        type='button'
        onClick={() => onChange(new Date('2026-08-01T00:00:00.000Z'))}
      >
        {value.toISOString().slice(0, 10)}
      </button>
    ),
  })
)

import { SprintDateRange } from '@/app/workspace/[workspaceUrl]/sprints/components/SprintDateRange'

const sprint = {
  id: 'sprint-1',
  startDate: new Date('2026-07-13T00:00:00.000Z'),
  endDate: new Date('2026-07-26T00:00:00.000Z'),
} as any

beforeEach(() => jest.clearAllMocks())

describe('SprintDateRange', () => {
  it('optimistically updates the start date and refetches on success', async () => {
    mockUpdate.mockResolvedValue(undefined)
    const onRefresh = jest.fn()
    render(<SprintDateRange sprint={sprint} onRefresh={onRefresh} />)

    // First picker = start date.
    fireEvent.click(screen.getByText('2026-07-13'))

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('sprint-1', {
        startDate: '2026-08-01T00:00:00.000Z',
      })
    )
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(mockToastSuccess).toHaveBeenCalled()
    // Optimistic value is reflected immediately.
    expect(screen.getByText('2026-08-01')).toBeInTheDocument()
  })

  it('reverts the optimistic value and toasts on failure', async () => {
    mockUpdate.mockRejectedValue(new Error('nope'))
    const onRefresh = jest.fn()
    render(<SprintDateRange sprint={sprint} onRefresh={onRefresh} />)

    fireEvent.click(screen.getByText('2026-07-26')) // end date picker

    await waitFor(() => expect(mockToastError).toHaveBeenCalled())
    expect(onRefresh).not.toHaveBeenCalled()
    // Reverted back to the original end date.
    expect(screen.getByText('2026-07-26')).toBeInTheDocument()
  })
})

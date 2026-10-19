/** @jest-environment jsdom */
/** LUM-1264 — removing a test case confirms through an AlertDialog. */
import '@testing-library/jest-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      locale: 'en',
      formatMessage: ({ id }: { id: string }) => messages[id] ?? id,
    }),
  }
})

const mockRemove = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTestCases', () => ({
  useTestCases: () => ({
    testCases: [{ id: 'c7', number: 7, title: 'Round trip', runs: [] }],
    pullRequests: [],
    loading: false,
    error: null,
    add: jest.fn(),
    update: jest.fn(),
    remove: mockRemove,
    recordRun: jest.fn(),
  }),
}))

// The card's own menu is covered by its suite; stub it to a remove button.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TestCaseCard',
  () => ({
    TestCaseCard: ({ onRemove }: { onRemove: () => void }) => (
      <button type='button' onClick={onRemove}>
        remove-case
      </button>
    ),
  })
)

import { TestCasesSection } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TestCasesSection'

beforeEach(() => mockRemove.mockReset())

function setup() {
  render(
    <TestCasesSection
      owner={{ kind: 'task', id: 't-1' }}
      handlePrefix='LUM-1'
      enabled
    />
  )
  fireEvent.click(screen.getByText('remove-case'))
}

it('cancel keeps the test case', () => {
  setup()
  expect(screen.getByRole('alertdialog')).toHaveTextContent(
    'Remove this test case?'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(mockRemove).not.toHaveBeenCalled()
})

it('confirm removes the chosen test case', async () => {
  setup()
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
  await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('7'))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})

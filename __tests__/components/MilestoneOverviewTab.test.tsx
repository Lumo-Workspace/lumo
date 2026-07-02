/** @jest-environment jsdom */

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

// useMentionSources is exercised separately; here we only assert what the tab
// forwards into it (the real @people fix is passing members, not []).
const mockUseMentionSources = jest.fn((_members: unknown) => [])
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMentionSources', () => ({
  useMentionSources: (members: unknown) => mockUseMentionSources(members),
}))

// DescriptionEditor pulls Tiptap — stub the lazy wrapper the tab imports
// to buttons that fire onCommit.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/DescriptionEditorLazy',
  () => ({
    DescriptionEditor: ({
      value,
      onCommit,
    }: {
      value: string | null
      onCommit: (html: string) => void
    }) => (
      <>
        <button data-testid='desc' onClick={() => onCommit('<p>new body</p>')}>
          {value ?? 'empty'}
        </button>
        <button data-testid='desc-empty' onClick={() => onCommit('')}>
          empty commit
        </button>
      </>
    ),
  })
)

import { render, screen, fireEvent } from '@testing-library/react'
import { MilestoneOverviewTab } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneOverviewTab'

const members = [
  { actorId: 'u1', name: 'Ada', email: 'ada@example.com' },
] as never

function setup(name = 'Beta release', description: string | null = 'Old body') {
  const onUpdate = jest.fn()
  render(
    <MilestoneOverviewTab
      milestone={{
        id: 'm1',
        name,
        description,
        startDate: null,
        targetDate: null,
      }}
      onUpdate={onUpdate}
      members={members}
      workspaceUrl='acme'
    />
  )
  return { onUpdate }
}

beforeEach(() => {
  mockUseMentionSources.mockClear()
})

test('forwards real members into useMentionSources (enables @people)', () => {
  setup()
  expect(mockUseMentionSources).toHaveBeenCalledWith(members)
  expect(mockUseMentionSources).not.toHaveBeenCalledWith([])
})

test('renders the milestone name and current description', () => {
  setup()
  expect(screen.getByText('Beta release')).toBeTruthy()
  expect(screen.getByTestId('desc').textContent).toBe('Old body')
})

test('committing description calls onUpdate with { description }', () => {
  const { onUpdate } = setup()
  fireEvent.click(screen.getByTestId('desc'))
  expect(onUpdate).toHaveBeenCalledWith({ description: '<p>new body</p>' })
})

test('renaming via title blur calls onUpdate with trimmed { name }', () => {
  const { onUpdate } = setup()
  const title = screen.getByText('Beta release')
  title.textContent = '  Gamma  '
  fireEvent.blur(title)
  expect(onUpdate).toHaveBeenCalledWith({ name: 'Gamma' })
})

test('blurring an unchanged title does not call onUpdate', () => {
  const { onUpdate } = setup()
  const title = screen.getByText('Beta release')
  fireEvent.blur(title)
  expect(onUpdate).not.toHaveBeenCalled()
})

test('committing an empty description calls onUpdate with { description: null }', () => {
  const { onUpdate } = setup()
  fireEvent.click(screen.getByTestId('desc-empty'))
  expect(onUpdate).toHaveBeenCalledWith({ description: null })
})

test('archived milestone does not commit name or description edits', () => {
  const onUpdate = jest.fn()
  render(
    <MilestoneOverviewTab
      milestone={{
        id: 'm1',
        name: 'Beta release',
        description: 'Old body',
        startDate: null,
        targetDate: null,
      }}
      onUpdate={onUpdate}
      members={members}
      workspaceUrl='acme'
      archived
    />
  )
  // description commit is gated
  fireEvent.click(screen.getByTestId('desc'))
  // title is not contentEditable; even if blurred with changed text, no commit
  const title = screen.getByText('Beta release')
  title.textContent = 'Gamma'
  fireEvent.blur(title)
  expect(onUpdate).not.toHaveBeenCalled()
})

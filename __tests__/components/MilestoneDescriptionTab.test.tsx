/** @jest-environment jsdom */

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
import { MilestoneDescriptionTab } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneDescriptionTab'

const members = [
  { actorId: 'u1', name: 'Ada', email: 'ada@example.com' },
] as never

function setup(description: string | null = 'Old body', archived = false) {
  const onUpdate = jest.fn()
  render(
    <MilestoneDescriptionTab
      milestoneId='m1'
      description={description}
      onUpdate={onUpdate}
      members={members}
      archived={archived}
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

test('renders the current description', () => {
  setup()
  expect(screen.getByTestId('desc').textContent).toBe('Old body')
})

test('committing description calls onUpdate with { description }', () => {
  const { onUpdate } = setup()
  fireEvent.click(screen.getByTestId('desc'))
  expect(onUpdate).toHaveBeenCalledWith({ description: '<p>new body</p>' })
})

test('committing an empty description calls onUpdate with { description: null }', () => {
  const { onUpdate } = setup()
  fireEvent.click(screen.getByTestId('desc-empty'))
  expect(onUpdate).toHaveBeenCalledWith({ description: null })
})

test('archived milestone does not commit description edits', () => {
  const { onUpdate } = setup('Old body', true)
  fireEvent.click(screen.getByTestId('desc'))
  expect(onUpdate).not.toHaveBeenCalled()
})

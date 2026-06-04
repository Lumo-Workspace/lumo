/** @jest-environment jsdom */

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

// DescriptionEditor pulls Tiptap — stub it to buttons that fire onCommit.
jest.mock('@/app/workspace/[workspaceUrl]/components/DescriptionEditor', () => ({
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
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { MilestoneOverviewTab } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneOverviewTab'

function setup(name = 'Beta release', description: string | null = 'Old body') {
  const onUpdate = jest.fn()
  render(
    <MilestoneOverviewTab
      milestone={{ id: 'm1', name, description }}
      onUpdate={onUpdate}
    />
  )
  return { onUpdate }
}

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
      milestone={{ id: 'm1', name: 'Beta release', description: 'Old body' }}
      onUpdate={onUpdate}
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

/**
 * LUM-1308 — a Records row can carry header controls beside its fold
 * trigger (never inside it): clicking one does not fold the row.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { RecordRow } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/RecordRow'

test('actions render beside the trigger and do not toggle the row', () => {
  const onToggle = jest.fn()
  const onAction = jest.fn()
  render(
    <RecordRow
      id='r'
      title='Lumo review'
      summary='Clean'
      actions={
        <button type='button' onClick={onAction}>
          Copy for agent
        </button>
      }
      expanded={false}
      onToggle={onToggle}
    >
      body
    </RecordRow>
  )
  const action = screen.getByRole('button', { name: 'Copy for agent' })
  const trigger = screen.getByRole('button', { name: /Lumo review/ })
  expect(trigger.contains(action)).toBe(false)
  fireEvent.click(action)
  expect(onAction).toHaveBeenCalled()
  expect(onToggle).not.toHaveBeenCalled()
  fireEvent.click(trigger)
  expect(onToggle).toHaveBeenCalledTimes(1)
})

test('without actions the row has only its trigger', () => {
  render(
    <RecordRow id='r' title='Agent runs' expanded={false} onToggle={jest.fn()}>
      body
    </RecordRow>
  )
  expect(screen.getAllByRole('button')).toHaveLength(1)
})

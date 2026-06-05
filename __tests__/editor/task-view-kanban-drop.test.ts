import {
  KANBAN_STATUSES,
  statusFromDropTarget,
} from '@/lib/editor/nodes/task-view-kanban-drop'

describe('statusFromDropTarget', () => {
  it('returns the target status when dropping on a different valid column', () => {
    expect(statusFromDropTarget('DONE', 'TODO')).toBe('DONE')
  })
  it('returns null when the column equals the current status (no-op)', () => {
    expect(statusFromDropTarget('TODO', 'TODO')).toBeNull()
  })
  it('returns null for a null / unknown drop target', () => {
    expect(statusFromDropTarget(null, 'TODO')).toBeNull()
    expect(statusFromDropTarget('BOGUS', 'TODO')).toBeNull()
  })
  it('exposes the four statuses in board order', () => {
    expect(KANBAN_STATUSES).toEqual(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'])
  })
})

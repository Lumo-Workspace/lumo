import {
  KANBAN_STATUSES,
  sortColumnTasks,
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
  it('exposes every droppable status in board order', () => {
    expect(KANBAN_STATUSES).toEqual([
      'BACKLOG',
      'TODO',
      'IN_PROGRESS',
      'IN_REVIEW',
      'DONE',
    ])
  })
})

describe('sortColumnTasks', () => {
  it('orders cards deterministically by task number, without mutating the input', () => {
    const input: any[] = [
      { id: 'c', number: 30 },
      { id: 'a', number: 10 },
      { id: 'b', number: 20 },
    ]
    const sorted = sortColumnTasks(input)
    expect(sorted.map(t => t.id)).toEqual(['a', 'b', 'c'])
    // input array is not mutated
    expect(input[0].id).toBe('c')
  })
})

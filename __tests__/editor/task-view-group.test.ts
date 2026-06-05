import { groupTasks } from '@/lib/editor/nodes/task-view-group'

const tasks = [
  { id: '1', status: 'DONE', projectId: 'p1', milestoneId: 'm1' },
  { id: '2', status: 'TODO', projectId: 'p2', milestoneId: null },
] as any[]

describe('groupTasks', () => {
  it('none → one group with all tasks', () => {
    const g = groupTasks(tasks, 'none', {}, {}, 'Ungrouped')
    expect(g).toHaveLength(1)
    expect(g[0]!.tasks).toHaveLength(2)
  })
  it('status → fixed order TODO before DONE, only non-empty groups', () => {
    const g = groupTasks(tasks, 'status', {}, {}, 'Ungrouped')
    expect(g.map(x => x.key)).toEqual(['TODO', 'DONE'])
  })
  it('project → uses the name map, label falls back to id', () => {
    const g = groupTasks(tasks, 'project', { p1: 'Alpha' }, {}, 'Ungrouped')
    const labels = g.map(x => x.label).sort()
    expect(labels).toContain('Alpha')
    expect(labels).toContain('p2')
  })
  it('milestone → null milestone lands in the Ungrouped bucket last', () => {
    const g = groupTasks(tasks, 'milestone', {}, { m1: 'V1' }, 'Ungrouped')
    expect(g[g.length - 1]!.label).toBe('Ungrouped')
  })
})

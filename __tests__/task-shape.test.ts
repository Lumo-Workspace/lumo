import { shapeSprintTask } from '@/lib/api/task-shape'

const baseTask = {
  id: 't-1',
  number: 42,
  title: 'Fix bug',
  status: 'IN_PROGRESS',
  team: { identifier: 'LUM' },
  project: {
    id: 'p-1',
    name: 'Lumo',
    owner: { actor: { id: 'actor-9' } },
  },
  parent: null,
  children: [{ id: 'c-1' }, { id: 'c-2' }],
  _count: { children: 2 },
}

describe('shapeSprintTask', () => {
  it('flattens owner/team and adds the sprint board fields', () => {
    const shaped = shapeSprintTask(baseTask)
    expect(shaped).toMatchObject({
      id: 't-1',
      teamIdentifier: 'LUM',
      viewOrder: null,
      project: { id: 'p-1', name: 'Lumo', ownerActorId: 'actor-9' },
      parent: null,
      childrenDoneCount: 2,
      _count: { children: 2 },
    })
  })

  it('strips the nested project.owner relation after lifting ownerActorId', () => {
    const shaped = shapeSprintTask(baseTask)
    expect('owner' in shaped.project).toBe(false)
  })

  it('falls back to empty string when team.identifier is missing', () => {
    const shaped = shapeSprintTask({ ...baseTask, team: null })
    expect(shaped.teamIdentifier).toBe('')
  })

  it('falls back to null ownerActorId when there is no owner actor', () => {
    const shaped = shapeSprintTask({
      ...baseTask,
      project: { id: 'p-1', name: 'Lumo', owner: null },
    })
    expect(shaped.project.ownerActorId).toBeNull()
  })

  it('flattens a parent and tolerates a missing parent team identifier', () => {
    const shaped = shapeSprintTask({
      ...baseTask,
      parent: {
        id: 'par-1',
        title: 'Epic',
        number: 7,
        team: null,
      },
    })
    expect(shaped.parent).toEqual({
      id: 'par-1',
      title: 'Epic',
      number: 7,
      teamIdentifier: '',
    })
  })

  it('treats a missing children array as zero done', () => {
    const { children, ...noChildren } = baseTask
    void children
    const shaped = shapeSprintTask(noChildren)
    expect(shaped.childrenDoneCount).toBe(0)
  })
})

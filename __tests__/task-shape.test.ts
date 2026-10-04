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
}

describe('shapeSprintTask', () => {
  it('flattens owner/team and adds the sprint board fields', () => {
    const shaped = shapeSprintTask(baseTask)
    expect(shaped).toMatchObject({
      id: 't-1',
      teamIdentifier: 'LUM',
      viewOrder: null,
      project: { id: 'p-1', name: 'Lumo', ownerActorId: 'actor-9' },
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

  it('no longer exposes parent / subtask fields (LUM-959)', () => {
    const shaped = shapeSprintTask(baseTask)
    expect(shaped).not.toHaveProperty('parent')
    expect(shaped).not.toHaveProperty('childrenDoneCount')
  })
})

import { sortTasks } from '@/app/workspace/[workspaceUrl]/utils/sortTasks'

// Minimal task shape that satisfies the SortableTask constraint
function makeTask(overrides: {
  id?: string
  title?: string
  priority?: string
  assignee?: {
    type: string
    member?: { clerkId: string } | null
    agent?: { name: string } | null
  } | null
  assigneeActorId?: string | null
  createdAt?: string
  updatedAt?: string
}) {
  return {
    id: overrides.id ?? 'task_1',
    title: overrides.title ?? 'Untitled',
    priority: overrides.priority ?? 'MEDIUM',
    assignee: overrides.assignee ?? null,
    assigneeActorId: overrides.assigneeActorId ?? null,
    createdAt: overrides.createdAt ?? '2024-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2024-01-01T00:00:00.000Z',
  }
}

describe('sortTasks – title', () => {
  it('sorts alphabetically A→Z by default', () => {
    const tasks = [
      makeTask({ title: 'Zebra task' }),
      makeTask({ title: 'Apple task' }),
      makeTask({ title: 'Mango task' }),
    ]
    const result = sortTasks(tasks, 'title')
    expect(result.map(t => t.title)).toEqual([
      'Apple task',
      'Mango task',
      'Zebra task',
    ])
  })

  it('sorts Z→A when direction is desc', () => {
    const tasks = [makeTask({ title: 'Alpha' }), makeTask({ title: 'Beta' })]
    const result = sortTasks(tasks, 'title', 'desc')
    expect(result.map(t => t.title)).toEqual(['Beta', 'Alpha'])
  })

  it('does not mutate the original array', () => {
    const tasks = [makeTask({ title: 'B' }), makeTask({ title: 'A' })]
    sortTasks(tasks, 'title')
    expect(tasks[0]!.title).toBe('B')
  })
})

describe('sortTasks – priority', () => {
  it('sorts highest priority first (URGENT before LOW) by default', () => {
    const tasks = [
      makeTask({ priority: 'LOW' }),
      makeTask({ priority: 'URGENT' }),
      makeTask({ priority: 'MEDIUM' }),
      makeTask({ priority: 'HIGH' }),
    ]
    const result = sortTasks(tasks, 'priority')
    expect(result.map(t => t.priority)).toEqual([
      'URGENT',
      'HIGH',
      'MEDIUM',
      'LOW',
    ])
  })

  it('sorts lowest priority first when direction is desc', () => {
    const tasks = [
      makeTask({ priority: 'URGENT' }),
      makeTask({ priority: 'LOW' }),
    ]
    const result = sortTasks(tasks, 'priority', 'desc')
    expect(result.map(t => t.priority)).toEqual(['LOW', 'URGENT'])
  })

  it('uses updatedAt as tiebreaker (newest first) for equal priorities', () => {
    const tasks = [
      makeTask({ priority: 'HIGH', updatedAt: '2024-01-01T00:00:00.000Z' }),
      makeTask({ priority: 'HIGH', updatedAt: '2024-06-01T00:00:00.000Z' }),
    ]
    const result = sortTasks(tasks, 'priority')
    expect(result[0]!.updatedAt).toBe('2024-06-01T00:00:00.000Z')
  })
})

describe('sortTasks – assignee', () => {
  const alice = {
    type: 'HUMAN',
    member: { clerkId: 'clerk_alice' },
    agent: null,
  }
  const bob = {
    type: 'HUMAN',
    member: { clerkId: 'clerk_bob' },
    agent: null,
  }
  const botActor = {
    type: 'AGENT',
    member: null,
    agent: { name: 'Deploy Bot' },
  }

  const getMemberName = (clerkId: string) => {
    if (clerkId === 'clerk_alice') return 'Alice'
    if (clerkId === 'clerk_bob') return 'Bob'
    return undefined
  }

  it('sorts assigned tasks alphabetically by name', () => {
    const tasks = [makeTask({ assignee: bob }), makeTask({ assignee: alice })]
    const result = sortTasks(tasks, 'assignee', undefined, getMemberName)
    expect(result[0]!.assignee).toBe(alice)
    expect(result[1]!.assignee).toBe(bob)
  })

  it('sorts unassigned tasks last regardless of direction', () => {
    const tasks = [
      makeTask({ assignee: null }),
      makeTask({ assignee: alice }),
      makeTask({ assignee: null }),
    ]
    const result = sortTasks(tasks, 'assignee', undefined, getMemberName)
    expect(result[0]!.assignee).toBe(alice)
    expect(result[1]!.assignee).toBeNull()
    expect(result[2]!.assignee).toBeNull()
  })

  it('uses agent name for AGENT assignees', () => {
    const tasks = [
      makeTask({ assignee: botActor }),
      makeTask({ assignee: alice }),
    ]
    const result = sortTasks(tasks, 'assignee', undefined, getMemberName)
    // 'Alice' < 'Deploy Bot' alphabetically
    expect(result[0]!.assignee).toBe(alice)
    expect(result[1]!.assignee).toBe(botActor)
  })

  it('works without getMemberName (unassigned tasks still sort last)', () => {
    const tasks = [makeTask({ assignee: alice }), makeTask({ assignee: null })]
    const result = sortTasks(tasks, 'assignee')
    expect(result[result.length - 1]!.assignee).toBeNull()
  })
})

describe('sortTasks – created', () => {
  it('sorts newest first by default', () => {
    const tasks = [
      makeTask({ createdAt: '2024-01-01T00:00:00.000Z' }),
      makeTask({ createdAt: '2024-06-01T00:00:00.000Z' }),
      makeTask({ createdAt: '2023-01-01T00:00:00.000Z' }),
    ]
    const result = sortTasks(tasks, 'created')
    expect(result[0]!.createdAt).toBe('2024-06-01T00:00:00.000Z')
    expect(result[2]!.createdAt).toBe('2023-01-01T00:00:00.000Z')
  })

  it('sorts oldest first when direction is asc', () => {
    const tasks = [
      makeTask({ createdAt: '2024-06-01T00:00:00.000Z' }),
      makeTask({ createdAt: '2023-01-01T00:00:00.000Z' }),
    ]
    const result = sortTasks(tasks, 'created', 'asc')
    expect(result[0]!.createdAt).toBe('2023-01-01T00:00:00.000Z')
  })
})

describe('sortTasks – updated', () => {
  it('sorts newest first by default', () => {
    const tasks = [
      makeTask({ updatedAt: '2024-01-01T00:00:00.000Z' }),
      makeTask({ updatedAt: '2024-09-01T00:00:00.000Z' }),
    ]
    const result = sortTasks(tasks, 'updated')
    expect(result[0]!.updatedAt).toBe('2024-09-01T00:00:00.000Z')
  })

  it('sorts oldest first when direction is asc', () => {
    const tasks = [
      makeTask({ updatedAt: '2024-09-01T00:00:00.000Z' }),
      makeTask({ updatedAt: '2024-01-01T00:00:00.000Z' }),
    ]
    const result = sortTasks(tasks, 'updated', 'asc')
    expect(result[0]!.updatedAt).toBe('2024-01-01T00:00:00.000Z')
  })

  it('identical updatedAt maintains stable relative order', () => {
    const ts = '2024-01-01T00:00:00.000Z'
    const tasks = [
      makeTask({ id: 'a', updatedAt: ts }),
      makeTask({ id: 'b', updatedAt: ts }),
    ]
    const result = sortTasks(tasks, 'updated')
    // Order is stable (both compare as 0)
    expect(result.map(t => t.id)).toEqual(['a', 'b'])
  })
})

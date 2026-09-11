/**
 * @jest-environment node
 */
import {
  buildCloseDecisions,
  describeSprintClose,
  formatUnfinishedRefusal,
} from '@/cli/src/commands/sprint-close'
import type { TaskRow } from '@/cli/src/lib/format'

const makeTask = (
  id: string,
  number: number,
  status: string
): TaskRow & { id: string } => ({
  id,
  number,
  title: `Task ${number}`,
  status,
  priority: 'MEDIUM',
  teamIdentifier: 'LUM',
  project: { id: 'p-1', name: 'Lumo' },
})

const done1 = makeTask('task-done-1', 1, 'DONE')
const done2 = makeTask('task-done-2', 2, 'DONE')
const inProgress = makeTask('task-ip', 3, 'IN_PROGRESS')
const todo = makeTask('task-todo', 4, 'TODO')
const inReview = makeTask('task-ir', 5, 'IN_REVIEW')

describe('buildCloseDecisions', () => {
  it('returns empty object when all tasks are DONE', () => {
    const result = buildCloseDecisions([done1, done2], 'move')
    expect(result).toEqual({})
  })

  it('maps non-DONE tasks to moveToNext in move mode', () => {
    const result = buildCloseDecisions([done1, inProgress, todo], 'move')
    expect(result).toEqual({
      'task-ip': 'moveToNext',
      'task-todo': 'moveToNext',
    })
    expect(result).not.toHaveProperty('task-done-1')
  })

  it('maps non-DONE tasks to backToBacklog in backlog mode', () => {
    const result = buildCloseDecisions([done1, inProgress, inReview], 'backlog')
    expect(result).toEqual({
      'task-ip': 'backToBacklog',
      'task-ir': 'backToBacklog',
    })
    expect(result).not.toHaveProperty('task-done-1')
  })

  it('handles a mix of all statuses', () => {
    const tasks = [done1, done2, inProgress, todo, inReview]
    const moveResult = buildCloseDecisions(tasks, 'move')
    expect(Object.keys(moveResult)).toHaveLength(3)
    expect(moveResult['task-ip']).toBe('moveToNext')
    expect(moveResult['task-todo']).toBe('moveToNext')
    expect(moveResult['task-ir']).toBe('moveToNext')

    const backlogResult = buildCloseDecisions(tasks, 'backlog')
    expect(Object.keys(backlogResult)).toHaveLength(3)
    expect(backlogResult['task-ip']).toBe('backToBacklog')
    expect(backlogResult['task-todo']).toBe('backToBacklog')
    expect(backlogResult['task-ir']).toBe('backToBacklog')
  })

  it('returns empty object for empty task list', () => {
    expect(buildCloseDecisions([], 'move')).toEqual({})
    expect(buildCloseDecisions([], 'backlog')).toEqual({})
  })
})

describe('formatUnfinishedRefusal', () => {
  it('includes sprint number and name in the header', () => {
    const out = formatUnfinishedRefusal(5, 'Sprint 5', [inProgress])
    expect(out).toContain('Refusing to close sprint #5 "Sprint 5"')
  })

  it('shows count of non-DONE tasks', () => {
    const out = formatUnfinishedRefusal(5, 'Sprint 5', [inProgress, todo])
    expect(out).toContain('2 task(s) not DONE')
  })

  it('excludes DONE tasks from the list and count', () => {
    const out = formatUnfinishedRefusal(5, 'Sprint 5', [done1, inProgress])
    expect(out).toContain('1 task(s) not DONE')
    expect(out).not.toContain('LUM-1')
    expect(out).toContain('LUM-3')
  })

  it('shows fixed-width rows for unfinished tasks', () => {
    const out = formatUnfinishedRefusal(3, 'Sprint 3', [inProgress, todo])
    expect(out).toContain('LUM-3')
    expect(out).toContain('IN_PROGRESS')
    expect(out).toContain('LUM-4')
    expect(out).toContain('TODO')
  })

  it('mentions --move-all --confirm, --backlog-all --confirm, and Web UI in resolution hint', () => {
    const out = formatUnfinishedRefusal(1, 'My Sprint', [inProgress])
    expect(out).toContain('--move-all --confirm')
    expect(out).toContain('--backlog-all --confirm')
    expect(out).not.toContain('--yes')
    expect(out).toContain('Web UI')
  })

  it('ends with a resolution hint line', () => {
    const out = formatUnfinishedRefusal(2, 'Sprint 2', [todo])
    const lines = out.split('\n')
    const lastMeaningful = lines[lines.length - 1] ?? ''
    expect(lastMeaningful.length).toBeGreaterThan(0)
  })
})

describe('describeSprintClose (confirmation envelope changes[])', () => {
  it('names the sprint and lists every unfinished task with its destination', () => {
    expect(
      describeSprintClose(5, 'Sprint 5', [done1, inProgress, todo], 'move')
    ).toEqual([
      'Will close sprint #5 "Sprint 5"',
      '2 unfinished tasks move to the next sprint: LUM-3, LUM-4',
    ])
    expect(describeSprintClose(5, 'Sprint 5', [inReview], 'backlog')).toEqual([
      'Will close sprint #5 "Sprint 5"',
      '1 unfinished task return to the backlog: LUM-5',
    ])
  })

  it('says nothing moves when every task is DONE', () => {
    expect(describeSprintClose(2, 'S2', [done1, done2], 'move')).toEqual([
      'Will close sprint #2 "S2"',
      'No unfinished tasks — nothing is moved',
    ])
  })
})

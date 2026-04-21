import {
  priorityBreakdown,
  memberBreakdown,
  type BreakdownTask,
  type MemberRef,
} from '@/lib/services/sprint-breakdown'

const t = (
  priority: BreakdownTask['priority'],
  status: BreakdownTask['status'],
  assigneeActorId: string | null = null
): BreakdownTask => ({ priority, status, assigneeActorId })

describe('priorityBreakdown', () => {
  it('returns empty when there are no tasks', () => {
    expect(priorityBreakdown([])).toEqual([])
  })

  it('only emits priorities that have at least one task', () => {
    const tasks = [
      t('HIGH', 'TODO'),
      t('HIGH', 'DONE'),
      t('LOW', 'IN_PROGRESS'),
    ]
    const out = priorityBreakdown(tasks)
    expect(out).toEqual([
      { priority: 'HIGH', done: 1, total: 2 },
      { priority: 'LOW', done: 0, total: 1 },
    ])
  })

  it('orders buckets URGENT → HIGH → MEDIUM → LOW regardless of input order', () => {
    const tasks = [
      t('LOW', 'TODO'),
      t('MEDIUM', 'DONE'),
      t('URGENT', 'DONE'),
      t('HIGH', 'IN_REVIEW'),
    ]
    expect(priorityBreakdown(tasks).map(b => b.priority)).toEqual([
      'URGENT',
      'HIGH',
      'MEDIUM',
      'LOW',
    ])
  })

  it('counts only DONE as done', () => {
    const tasks = [
      t('HIGH', 'TODO'),
      t('HIGH', 'IN_PROGRESS'),
      t('HIGH', 'IN_REVIEW'),
      t('HIGH', 'DONE'),
    ]
    expect(priorityBreakdown(tasks)).toEqual([
      { priority: 'HIGH', done: 1, total: 4 },
    ])
  })
})

describe('memberBreakdown', () => {
  const alice: MemberRef = { id: 'm-alice', name: 'Alice', actorId: 'a-alice' }
  const bob: MemberRef = { id: 'm-bob', name: 'Bob', actorId: 'a-bob' }
  const cat: MemberRef = { id: 'm-cat', name: 'Cat', actorId: 'a-cat' }

  it('returns empty when no tasks are assigned to known members', () => {
    expect(memberBreakdown([], [alice])).toEqual([])
    expect(memberBreakdown([t('HIGH', 'TODO', null)], [alice])).toEqual([])
  })

  it('ignores unassigned tasks', () => {
    const tasks = [
      t('HIGH', 'DONE', 'a-alice'),
      t('HIGH', 'TODO', null),
      t('HIGH', 'TODO', null),
    ]
    expect(memberBreakdown(tasks, [alice])).toEqual([
      { member: alice, done: 1, total: 1 },
    ])
  })

  it('ignores tasks assigned to an actor id not in the members list (agents or stale)', () => {
    const tasks = [
      t('HIGH', 'DONE', 'a-alice'),
      t('HIGH', 'TODO', 'a-agent-xyz'),
    ]
    expect(memberBreakdown(tasks, [alice])).toEqual([
      { member: alice, done: 1, total: 1 },
    ])
  })

  it('sorts by descending total, then by name ascending as a tiebreaker', () => {
    const tasks = [
      // Bob: 3 total, 1 done
      t('HIGH', 'DONE', 'a-bob'),
      t('HIGH', 'TODO', 'a-bob'),
      t('HIGH', 'IN_PROGRESS', 'a-bob'),
      // Alice: 2 total, 2 done
      t('LOW', 'DONE', 'a-alice'),
      t('HIGH', 'DONE', 'a-alice'),
      // Cat: 2 total, 0 done (same total as Alice → name tiebreaker places Alice first)
      t('MEDIUM', 'TODO', 'a-cat'),
      t('MEDIUM', 'IN_REVIEW', 'a-cat'),
    ]
    const out = memberBreakdown(tasks, [alice, bob, cat])
    expect(out.map(b => b.member.name)).toEqual(['Bob', 'Alice', 'Cat'])
    expect(out).toEqual([
      { member: bob, done: 1, total: 3 },
      { member: alice, done: 2, total: 2 },
      { member: cat, done: 0, total: 2 },
    ])
  })

  it('skips members whose actorId is null', () => {
    const ghost: MemberRef = { id: 'm-ghost', name: 'Ghost', actorId: null }
    const tasks = [t('HIGH', 'DONE', 'a-alice')]
    expect(memberBreakdown(tasks, [ghost, alice])).toEqual([
      { member: alice, done: 1, total: 1 },
    ])
  })
})

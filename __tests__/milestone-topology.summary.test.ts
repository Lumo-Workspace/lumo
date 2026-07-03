import {
  computeMilestoneTopology,
  type MilestoneTopologyInput,
  type TopologyEdgeRow,
  type TopologyTaskRow,
} from '@/lib/summaries/milestone-topology'
import type { TaskStatus } from '@prisma/client'

function task(
  id: string,
  status: TaskStatus = 'TODO',
  title = `Task ${id}`
): TopologyTaskRow {
  return { id, ref: `LUM-${id}`, title, status }
}

function edge(
  blocking: string,
  blocked: string,
  overrides: Partial<TopologyEdgeRow> = {}
): TopologyEdgeRow {
  return {
    blockedTaskId: blocked,
    blockingTaskId: blocking,
    kind: 'BLOCKS',
    status: 'CONFIRMED',
    blockingStatus: 'TODO',
    ...overrides,
  }
}

function compute(input: MilestoneTopologyInput) {
  return computeMilestoneTopology(input)
}

describe('computeMilestoneTopology', () => {
  test('linear chain: layered topo order, critical path, only the head is ready', () => {
    const out = compute({
      tasks: [task('1'), task('2'), task('3')],
      edges: [edge('1', '2'), edge('2', '3')],
    })
    expect(out.edgeCount).toBe(2)
    expect(out.levels).toEqual([['LUM-1'], ['LUM-2'], ['LUM-3']])
    expect(out.criticalPath.map(n => n.ref)).toEqual([
      'LUM-1',
      'LUM-2',
      'LUM-3',
    ])
    expect(out.nextBatch.map(b => b.ref)).toEqual(['LUM-1'])
    expect(out.nextBatch[0]?.unblocksCount).toBe(1)
    expect(out.nextBatch[0]?.onCriticalPath).toBe(true)
    expect(out.blockedOpenCount).toBe(2)
    expect(out.cycleRefs).toEqual([])
  })

  test('next batch ranks by open tasks directly unblocked, descending, ref tiebreak', () => {
    const out = compute({
      // 2 unblocks two tasks, 5 unblocks one, 7 unblocks none.
      tasks: [task('2'), task('3'), task('4'), task('5'), task('6'), task('7')],
      edges: [edge('2', '3'), edge('2', '4'), edge('5', '6')],
    })
    expect(out.nextBatch.map(b => b.ref)).toEqual(['LUM-2', 'LUM-5', 'LUM-7'])
    expect(out.nextBatch.map(b => b.unblocksCount)).toEqual([2, 1, 0])
  })

  test('a DONE blocker releases its dependent; unblocking a DONE task counts nothing', () => {
    const out = compute({
      tasks: [task('1', 'DONE'), task('2'), task('3', 'DONE')],
      edges: [edge('1', '2', { blockingStatus: 'DONE' }), edge('2', '3')],
    })
    expect(out.nextBatch.map(b => b.ref)).toEqual(['LUM-2'])
    // LUM-2's only dependent (LUM-3) is already DONE — releasing it frees nothing.
    expect(out.nextBatch[0]?.unblocksCount).toBe(0)
    expect(out.blockedOpenCount).toBe(0)
  })

  test('SUGGESTED / DISMISSED / RELATES edges do not participate', () => {
    const out = compute({
      tasks: [task('1'), task('2'), task('3'), task('4')],
      edges: [
        edge('1', '2', { status: 'SUGGESTED' }),
        edge('1', '3', { status: 'DISMISSED' }),
        edge('1', '4', { kind: 'RELATES' }),
      ],
    })
    expect(out.edgeCount).toBe(0)
    expect(out.levels).toEqual([])
    expect(out.criticalPath).toEqual([])
    // Nothing is truly blocked — every open task is ready.
    expect(out.nextBatch.map(b => b.ref)).toEqual([
      'LUM-1',
      'LUM-2',
      'LUM-3',
      'LUM-4',
    ])
    expect(out.blockedOpenCount).toBe(0)
  })

  test('an open out-of-milestone blocker keeps the task out of the next batch', () => {
    const out = compute({
      tasks: [task('1'), task('2')],
      edges: [
        // ext is not a member task; still gates LUM-1 while open.
        edge('ext', '1', { blockingStatus: 'IN_PROGRESS' }),
      ],
    })
    // External edge is not part of the intra-milestone topology…
    expect(out.edgeCount).toBe(0)
    // …but its openness still disqualifies the dependent.
    expect(out.nextBatch.map(b => b.ref)).toEqual(['LUM-2'])
    expect(out.blockedOpenCount).toBe(1)
  })

  test('a DONE out-of-milestone blocker does not gate', () => {
    const out = compute({
      tasks: [task('1')],
      edges: [edge('ext', '1', { blockingStatus: 'DONE' })],
    })
    expect(out.nextBatch.map(b => b.ref)).toEqual(['LUM-1'])
  })

  test('cycle: members reported explicitly, no crash, acyclic part still layered', () => {
    const out = compute({
      tasks: [task('1'), task('2'), task('3'), task('4')],
      edges: [
        edge('1', '2'),
        edge('2', '1'), // cycle 1↔2
        edge('3', '4'), // independent acyclic chain
      ],
    })
    expect(out.cycleRefs).toEqual(['LUM-1', 'LUM-2'])
    expect(out.levels).toEqual([['LUM-3'], ['LUM-4']])
    expect(out.criticalPath.map(n => n.ref)).toEqual(['LUM-3', 'LUM-4'])
    // Cycle members block each other — neither is ready.
    expect(out.nextBatch.map(b => b.ref)).toEqual(['LUM-3'])
  })

  test('critical path keeps DONE tasks in the chain with their status', () => {
    const out = compute({
      tasks: [task('1', 'DONE'), task('2', 'IN_PROGRESS'), task('3')],
      edges: [edge('1', '2', { blockingStatus: 'DONE' }), edge('2', '3')],
    })
    expect(out.criticalPath.map(n => `${n.ref}:${n.status}`)).toEqual([
      'LUM-1:DONE',
      'LUM-2:IN_PROGRESS',
      'LUM-3:TODO',
    ])
  })

  test('duplicate edges dedupe; edges to unknown blocked tasks are ignored', () => {
    const out = compute({
      tasks: [task('1'), task('2')],
      edges: [edge('1', '2'), edge('1', '2'), edge('1', 'ghost')],
    })
    expect(out.edgeCount).toBe(1)
    expect(out.nextBatch[0]?.unblocksCount).toBe(1)
  })

  test('no edges at all: empty topology, every open task ready', () => {
    const out = compute({
      tasks: [task('1'), task('2', 'DONE')],
      edges: [],
    })
    expect(out.edgeCount).toBe(0)
    expect(out.levels).toEqual([])
    expect(out.criticalPath).toEqual([])
    expect(out.cycleRefs).toEqual([])
    expect(out.nextBatch.map(b => b.ref)).toEqual(['LUM-1'])
    expect(out.blockedOpenCount).toBe(0)
  })

  test('diamond graph: single deepest critical path, ready set is the sources', () => {
    const out = compute({
      tasks: [task('1'), task('2'), task('3'), task('4'), task('5')],
      // 1 → 2 → 4, 1 → 3 → 4, 4 → 5
      edges: [
        edge('1', '2'),
        edge('1', '3'),
        edge('2', '4'),
        edge('3', '4'),
        edge('4', '5'),
      ],
    })
    expect(out.levels).toEqual([
      ['LUM-1'],
      ['LUM-2', 'LUM-3'],
      ['LUM-4'],
      ['LUM-5'],
    ])
    expect(out.criticalPath).toHaveLength(4)
    expect(out.criticalPath[0]?.ref).toBe('LUM-1')
    expect(out.criticalPath[3]?.ref).toBe('LUM-5')
    expect(out.nextBatch.map(b => b.ref)).toEqual(['LUM-1'])
    expect(out.nextBatch[0]?.unblocksCount).toBe(2)
  })
})

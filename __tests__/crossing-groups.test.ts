/**
 * LUM-496 Task 2: `groupCrossings` is the pure ordering rule behind the Record
 * tab's collapsible crossing groups. What a reviewer must act on first has to
 * sort to the top — blocking groups (an open, non-advisory crossing) before
 * anything settled or advisory, then severity, then how many are still open.
 */
import {
  groupCrossings,
  type CrossingGroup,
} from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/crossing-groups'
import type { BoundaryCrossingView } from '@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings'

function crossing(over: Partial<BoundaryCrossingView>): BoundaryCrossingView {
  return {
    id: 'bc-1',
    category: 'PROJECT_RULE_VIOLATION',
    detail: 'x',
    detectedAt: '2026-09-01T00:00:00.000Z',
    reversible: true,
    occurrenceCount: 1,
    lastSeenAt: '2026-09-01T00:00:00.000Z',
    severity: 'MEDIUM',
    disposition: null,
    advisory: false,
    ...over,
  } as BoundaryCrossingView
}

const categories = (groups: CrossingGroup[]) => groups.map(g => g.category)

it('groups by category and counts open vs total', () => {
  const groups = groupCrossings([
    crossing({ id: 'a', category: 'SCOPE_EXPANSION' }),
    crossing({
      id: 'b',
      category: 'SCOPE_EXPANSION',
      disposition: 'CONFIRMED',
    }),
    crossing({ id: 'c', category: 'SCOPE_EXPANSION' }),
  ])
  expect(groups).toHaveLength(1)
  expect(groups[0]).toMatchObject({
    category: 'SCOPE_EXPANSION',
    open: 2,
    total: 3,
  })
  // Input order is preserved inside a group — the panel renders the same rows
  // in the same order as before the grouping wrapper.
  expect(groups[0]!.crossings.map(c => c.id)).toEqual(['a', 'b', 'c'])
})

it('takes the max severity and is advisory only when every crossing is', () => {
  const [mixed] = groupCrossings([
    crossing({ id: 'a', severity: 'LOW', advisory: true }),
    crossing({ id: 'b', severity: 'HIGH', advisory: false }),
  ])
  expect(mixed).toMatchObject({ severity: 'HIGH', advisory: false })

  const [allAdvisory] = groupCrossings([
    crossing({ id: 'a', severity: 'LOW', advisory: true }),
    crossing({ id: 'b', severity: 'MEDIUM', advisory: true }),
  ])
  expect(allAdvisory).toMatchObject({ severity: 'MEDIUM', advisory: true })
})

it('sorts blocking groups first, even below a higher-severity settled group', () => {
  const groups = groupCrossings([
    // HIGH but fully dispositioned — nothing left to decide.
    crossing({
      id: 'a',
      category: 'DESTRUCTIVE_DB_COMMAND',
      severity: 'HIGH',
      disposition: 'FALSE_POSITIVE',
    }),
    // HIGH but advisory — never blocks Done (LUM-590).
    crossing({
      id: 'b',
      category: 'EXFILTRATION_PUBLIC',
      severity: 'HIGH',
      advisory: true,
    }),
    // LOW and open — the only one that actually blocks.
    crossing({ id: 'c', category: 'SCOPE_EXPANSION', severity: 'LOW' }),
  ])
  expect(categories(groups)[0]).toBe('SCOPE_EXPANSION')
})

it('orders non-blocking groups by severity, then open count, then category', () => {
  const groups = groupCrossings([
    crossing({ id: 'a', category: 'ZZZ_LOW', severity: 'LOW', advisory: true }),
    crossing({ id: 'b', category: 'AAA_LOW', severity: 'LOW', advisory: true }),
    crossing({
      id: 'c',
      category: 'MED_ONE',
      severity: 'MEDIUM',
      advisory: true,
    }),
    crossing({
      id: 'd',
      category: 'MED_TWO',
      severity: 'MEDIUM',
      advisory: true,
    }),
    crossing({
      id: 'e',
      category: 'MED_TWO',
      severity: 'MEDIUM',
      advisory: true,
    }),
  ])
  // MEDIUM before LOW; within MEDIUM the group with more open first; the two
  // LOW groups tie on open count so the category name breaks it.
  expect(categories(groups)).toEqual([
    'MED_TWO',
    'MED_ONE',
    'AAA_LOW',
    'ZZZ_LOW',
  ])
})

it('returns an empty list for no crossings', () => {
  expect(groupCrossings([])).toEqual([])
})

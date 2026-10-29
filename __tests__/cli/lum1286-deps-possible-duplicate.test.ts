/** @jest-environment node */
// LUM-1286: a background duplicate check leaves a suggested DUPLICATES edge.
import { formatDepsList, type DepEdge } from '@/cli/src/commands/task-deps'

it('shows a suggested duplicate with its score as evidence', () => {
  const edge = {
    id: 'edge_possible_dup_1',
    direction: 'BLOCKED_BY',
    kind: 'DUPLICATES',
    status: 'SUGGESTED',
    source: 'DETECTED',
    reason: 'possible_duplicate',
    detail: { score: 0.9 },
    other: {
      identifier: 'LUM-12',
      title: 'Add Google OAuth login',
      status: 'TODO',
    },
  } as unknown as DepEdge

  const out = formatDepsList('LUM-50', [edge])

  expect(out).toMatch(/duplicate of LUM-12 "Add Google OAuth login"/)
  expect(out).toMatch(/possible_duplicate\(90%\)/)
})

it('points the confirm hint at the other task when two edges share a short id', () => {
  const mk = (id: string, ident: string) =>
    ({
      id,
      direction: 'BLOCKED_BY',
      kind: 'DUPLICATES',
      status: 'SUGGESTED',
      source: 'DETECTED',
      reason: 'possible_duplicate',
      detail: { score: 0.95 },
      other: { identifier: ident, title: 't', status: 'TODO' },
    }) as unknown as DepEdge
  // Edges written in one batch get cuids that share their first 8 chars.
  const out = formatDepsList('LUM-50', [
    mk('cmvj5trv0001aaaa', 'LUM-2'),
    mk('cmvj5trv0002bbbb', 'LUM-243'),
  ])

  expect(out).toMatch(/lumo task dep confirm LUM-50 LUM-2 /)
  expect(out).toMatch(/lumo task dep confirm LUM-50 LUM-243 /)
})

it('says "duplicate of" when a suggested duplicate is confirmed', () => {
  const { formatDepsConfirmed } = require('@/cli/src/commands/task-deps')
  const edge = {
    id: 'cmvj5trv0001aaaa',
    direction: 'BLOCKED_BY',
    kind: 'DUPLICATES',
    status: 'CONFIRMED',
    source: 'DETECTED',
    reason: 'possible_duplicate',
    detail: { score: 0.95 },
    other: { identifier: 'LUM-2', title: 'Export burndown', status: 'TODO' },
  }
  expect(formatDepsConfirmed('LUM-50', edge, false)).toMatch(
    /LUM-50 duplicate of LUM-2/
  )
})

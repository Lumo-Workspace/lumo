/** @jest-environment node */
import {
  aggregateManagedScanOps,
  failureKey,
  type ManagedScanRow,
} from '../aggregate'

const NOW = new Date('2026-09-10T12:00:00Z')
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000)

const rows: ManagedScanRow[] = [
  {
    id: 'a',
    stages: { external: 'RAN' },
    error: null,
    startedAt: minutesAgo(5),
    managedRunId: 'r1',
  },
  {
    id: 'b',
    stages: { external: 'RAN' },
    error: null,
    startedAt: minutesAgo(10),
    managedRunId: 'r2',
  },
  {
    id: 'c',
    stages: { external: 'SUPERSEDED' },
    error: 'external: superseded by abc1234',
    startedAt: minutesAgo(11),
    managedRunId: 'r3',
  },
  {
    id: 'd',
    stages: { external: 'PENDING' },
    error: null,
    startedAt: minutesAgo(50),
    managedRunId: 'r4',
  },
  {
    id: 'e',
    stages: { external: 'PENDING' },
    error: null,
    startedAt: minutesAgo(3),
    managedRunId: 'r5',
  },
  {
    id: 'f',
    stages: { external: 'FAILED' },
    error:
      'external: rate-limited: 21 managed scans started in the last hour (cap 20)',
    startedAt: minutesAgo(20),
    managedRunId: 'r6',
  },
  {
    id: 'g',
    stages: { external: 'FAILED' },
    error: 'external: gitleaks exit 2; semgrep produced no report',
    startedAt: minutesAgo(21),
    managedRunId: 'r7',
  },
  {
    id: 'h',
    stages: { external: 'FAILED' },
    error: 'raw stage A crash',
    startedAt: minutesAgo(22),
    managedRunId: 'r8',
  },
  {
    id: 'i',
    stages: null,
    error: null,
    startedAt: minutesAgo(23),
    managedRunId: 'r9',
  },
]

test('counts external states, PENDING over 45 min, and failure reasons; RAN rate excludes superseded rows', () => {
  const s = aggregateManagedScanOps(rows, NOW)
  expect(s.scans).toBe(9)
  expect(s.external).toEqual({
    RAN: 2,
    FAILED: 3,
    PENDING: 2,
    SUPERSEDED: 1,
    other: 1,
  })
  expect(s.pendingOver45Min).toBe(1)
  // 2 RAN / (9 − 1 superseded)
  expect(s.ranRate).toBeCloseTo(0.25)
  expect(s.failureReasons).toEqual({
    'rate-limited': 1,
    'gitleaks exit 2': 1,
    unknown: 1,
  })
})

test('an empty or all-superseded input has no RAN rate', () => {
  expect(aggregateManagedScanOps([], NOW).ranRate).toBeNull()
  expect(aggregateManagedScanOps([rows[2]], NOW).ranRate).toBeNull()
})

test('failureKey keeps the prefixed reason up to the first ":" or ";" and caps its length', () => {
  expect(failureKey(null)).toBe('unknown')
  expect(failureKey('not prefixed')).toBe('unknown')
  expect(failureKey('external: scanner did not report within 45 min')).toBe(
    'scanner did not report within 45 min'
  )
  expect(failureKey(`external: ${'x'.repeat(100)}`)).toHaveLength(60)
})

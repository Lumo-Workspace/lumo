/**
 * @jest-environment node
 *
 * LUM-963 — a SENSITIVE_PATH_READ crossing never blocks DONE.
 *
 * Drives the REAL chain: the detector's crossing → the real
 * `boundaryCrossingRepository.findUndispositionedByTask` → the real
 * `readDoneVerdict`, over an in-memory Prisma mock that honours the `where`
 * clause. Only the other two gate planes (security findings, test cases) are
 * stubbed empty.
 */
import { detectCrossings } from '@/lib/services/boundary-detector.service'
import { readDoneVerdict } from '@/lib/services/done-verdict.service'

type Row = Record<string, unknown>
const rows: Row[] = []

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => row[k] === v)
}

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    boundaryCrossing: {
      findMany: jest.fn(async ({ where }: { where: Row }) =>
        rows.filter(r => matches(r, where))
      ),
    },
    workspace: {
      findUnique: jest.fn(async () => ({ boundaryGateEnabled: true })),
    },
  },
}))
jest.mock('@/ee/security/services/pr-security-scan-gate', () => ({
  listOpenBlockingFindings: jest.fn(async () => []),
}))
jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: {
    listForTask: jest.fn(async () => []),
    runsPerCase: jest.fn(async () => new Map()),
  },
}))

/** Persist a detected crossing the way detectAndRecord does (open row). */
function record(taskId: string, c: ReturnType<typeof detectCrossings>[number]) {
  rows.push({
    taskId,
    category: c.category,
    severity: c.severity,
    target: c.target,
    detail: c.detail,
    advisory: c.advisory ?? false,
    disposition: null,
  })
}

beforeEach(() => {
  rows.length = 0
})

test('an open SENSITIVE_PATH_READ crossing leaves the DONE verdict CLEAR', async () => {
  const [read] = detectCrossings({
    toolName: 'Read',
    filePath: '/Users/dev/.ssh/id_rsa',
    payload: { tool_input: { file_path: '/Users/dev/.ssh/id_rsa' } },
  })
  expect(read?.category).toBe('SENSITIVE_PATH_READ')
  record('t-1', read!)

  const verdict = await readDoneVerdict('t-1', 'w-1')
  expect(verdict.decision).toBe('CLEAR')
  expect(verdict.blockers).toEqual([])
})

test('a blocking crossing on the same task still blocks — the read is not what blocks', async () => {
  const crossings = detectCrossings({
    toolName: 'Bash',
    filePath: null,
    payload: {
      tool_input: { command: 'cat /etc/shadow && git push origin main' },
    },
  })
  expect(crossings.map(c => c.category).sort()).toEqual([
    'PUSH_TO_PROTECTED_BRANCH',
    'SENSITIVE_PATH_READ',
  ])
  for (const c of crossings) record('t-2', c)

  const verdict = await readDoneVerdict('t-2', 'w-1')
  expect(verdict.decision).toBe('BLOCKED')
  const text = JSON.stringify(verdict.blockers)
  expect(text).toMatch(/PUSH_TO_PROTECTED_BRANCH/)
  expect(text).not.toMatch(/SENSITIVE_PATH_READ/)
})

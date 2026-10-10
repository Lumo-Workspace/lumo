/**
 * @jest-environment node
 *
 * LUM-963 — a SENSITIVE_PATH_READ crossing never blocks DONE (core half).
 *
 * LUM-1064: the SENSITIVE_PATH_READ detector is a security-plugin detector,
 * so this core copy runs with no plugin installed (the OSS build) and seeds
 * the read crossing as a hand-made row shaped like the one the plugin records
 * (LOW, advisory). The plugin-driven version — the detector's own crossing
 * through the same chain — lives in
 * __tests__/ee/security/boundary-gate-lum963-sensitive-read.test.ts.
 *
 * Drives the REAL chain: the real
 * `boundaryCrossingRepository.findUndispositionedByTask` → the real
 * `readDoneVerdict`, over an in-memory Prisma mock that honours the `where`
 * clause. The test-case plane is stubbed empty; with no plugin there is no
 * plugin DONE-gate plane at all.
 */
import { detectCrossings } from '@/lib/services/boundary-detector.service'
import { readDoneVerdict } from '@/lib/services/done-verdict.service'
import { severityFor } from '@/lib/boundary-crossing/taxonomy'

type Row = Record<string, unknown>
const rows: Row[] = []

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => row[k] === v)
}

// LUM-1064: core test, run without the security plugin (the OSS build).
jest.mock('@/lib/plugins/installed', () => ({ INSTALLED_SERVER_PLUGINS: [] }))
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

/** An open read crossing, shaped like the security plugin's record. */
function recordSensitiveRead(taskId: string, target: string, via: string) {
  rows.push({
    taskId,
    category: 'SENSITIVE_PATH_READ',
    severity: severityFor('SENSITIVE_PATH_READ'),
    target,
    detail: `read sensitive path ${target} (credential) via ${via} — advisory`,
    advisory: true,
    disposition: null,
  })
}

beforeEach(() => {
  rows.length = 0
})

test('an open SENSITIVE_PATH_READ crossing leaves the DONE verdict CLEAR', async () => {
  recordSensitiveRead('t-1', '/Users/dev/.ssh/id_rsa', 'Read')
  expect(rows[0]).toMatchObject({ severity: 'LOW', advisory: true })

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
  // No plugin: the core detector reports the push only.
  expect(crossings.map(c => c.category)).toEqual(['PUSH_TO_PROTECTED_BRANCH'])
  for (const c of crossings) record('t-2', c)
  recordSensitiveRead('t-2', '/etc/shadow', 'Bash')

  const verdict = await readDoneVerdict('t-2', 'w-1')
  expect(verdict.decision).toBe('BLOCKED')
  const text = JSON.stringify(verdict.blockers)
  expect(text).toMatch(/PUSH_TO_PROTECTED_BRANCH/)
  expect(text).not.toMatch(/SENSITIVE_PATH_READ/)
})

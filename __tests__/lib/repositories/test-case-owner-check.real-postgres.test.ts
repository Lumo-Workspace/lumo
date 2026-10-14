/**
 * @jest-environment node
 *
 * LUM-1135 — a test case belongs to exactly one owner (task XOR milestone).
 * Against a REAL Postgres (every migration replayed into PGlite): only the
 * database can say whether the CHECK constraint rejects the bad shapes.
 */
import { createPgliteHarness } from '../../../scripts/test-support/pglite-harness'

// jest.setup.js mocks PrismaClient globally; this suite needs the real one.
const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)

jest.setTimeout(180_000)

beforeAll(async () => {
  await harness.start()
})

afterAll(async () => {
  await harness.stop()
})

// Raw SQL on purpose: the typed client cannot build these invalid rows.
it('rejects a test case with neither owner', async () => {
  await expect(
    harness.prisma!.$executeRawUnsafe(
      `INSERT INTO test_cases (id, number, title, steps, verification, expected, "updatedAt")
       VALUES ('lum1135-none', 1, 't', '{}', '{}', 'e', now())`
    )
  ).rejects.toThrow(/test_cases_owner_check/)
})

it('rejects a test case with both owners', async () => {
  // CHECK constraints fire before FK triggers, so the ids need not exist.
  await expect(
    harness.prisma!.$executeRawUnsafe(
      `INSERT INTO test_cases (id, "taskId", "milestoneId", number, title, steps, verification, expected, "updatedAt")
       VALUES ('lum1135-both', 'no-task', 'no-milestone', 999999, 't', '{}', '{}', 'e', now())`
    )
  ).rejects.toThrow(/test_cases_owner_check/)
})

it('rejects a test case run with neither owner', async () => {
  await expect(
    harness.prisma!.$executeRawUnsafe(
      `INSERT INTO test_case_runs (id, "testCaseId", result, environment)
       VALUES ('lum1135-run-none', 'no-case', 'PASS', 'LOCAL')`
    )
  ).rejects.toThrow(/test_case_runs_owner_check/)
})

it('rejects a disposition with neither owner', async () => {
  await expect(
    harness.prisma!.$executeRawUnsafe(
      `INSERT INTO test_case_run_dispositions (id, "runId", disposition, "dispositionedById", channel)
       VALUES ('lum1135-disp-none', 'no-run', 'KNOWN_DEFECT', 'm', 'WEB')`
    )
  ).rejects.toThrow(/test_case_run_dispositions_owner_check/)
})

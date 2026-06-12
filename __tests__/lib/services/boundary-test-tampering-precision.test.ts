/**
 * LUM-455 — TEST_TAMPERING precision gate (refines LUM-441).
 *
 * Editing a file a MACHINE checkpointer runs is suspected test-tampering. But
 * LUM-445 dogfood showed cosmetic-only edits (adding a `!`, reflowing
 * whitespace, reordering lines) being flagged as noise. The gate now suppresses
 * a provably cosmetic-only edit while STILL flagging any edit that touches an
 * assertion — or that it can't confidently prove harmless (a Write, an
 * unparseable payload). Conservative by construction: when in doubt, record.
 *
 *  c1 — a cosmetic-only edit (whitespace/comments/`!`/reorder) records nothing.
 *  c2 — a substantive edit (assertion changed) OR an ambiguous one (a Write with
 *       no before-side) still records the crossing.
 */
import {
  boundaryDetectorService,
  isCosmeticTestEdit,
} from '@/lib/services/boundary-detector.service'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'

jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: { listByTask: jest.fn() },
}))

const createCrossing = boundaryCrossingRepository.create as jest.Mock
const createActivity = activityRepository.create as jest.Mock
const listByTask = acceptanceCriterionRepository.listByTask as jest.Mock

const CHECKPOINTER =
  "npx tsx scripts/jest-t.ts 'the widget renders' __tests__/widget.test.ts"
const FILE = '/Users/dev/repo/__tests__/widget.test.ts'

const machineCriterion = {
  id: 'crit-1',
  taskId: 't-1',
  statement: 'the widget renders',
  verifierType: 'MACHINE' as const,
  checkpointer: CHECKPOINTER,
  evidenceRequired: false,
  source: 'AGENT_DRAFT' as const,
  addedAtRound: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
}

/** Run the full detect+record path for an Edit (old→new) on the checkpointer file. */
async function recordEdit(oldString: string, newString: string) {
  await boundaryDetectorService.detectAndRecord({
    taskId: 't-1',
    hookEventId: 'evt-1',
    toolName: 'Edit',
    filePath: FILE,
    payload: {
      tool_input: {
        file_path: FILE,
        old_string: oldString,
        new_string: newString,
      },
    },
  })
}

/** Run the path for a Write (content only — no before-side to diff against). */
async function recordWrite(content: string) {
  await boundaryDetectorService.detectAndRecord({
    taskId: 't-1',
    hookEventId: 'evt-1',
    toolName: 'Write',
    filePath: FILE,
    payload: { tool_input: { file_path: FILE, content } },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  createCrossing.mockResolvedValue({ id: 'bc-1' })
  createActivity.mockResolvedValue({ id: 'act-1' })
  listByTask.mockResolvedValue([machineCriterion])
})

describe('TEST_TAMPERING precision gate — detect+record (LUM-455)', () => {
  it('cosmetic-only test edit does not record a TEST_TAMPERING crossing', async () => {
    // The edit only: reorders two lines, adds non-null assertions (`!`), adds a
    // comment, and reflows whitespace. No assertion or value changes.
    const before = [
      'const a = obj.value',
      'const b = other.value',
      'expect(a).toBe(b)',
    ].join('\n')
    const after = [
      '// tighten the types here',
      'const b = other!.value',
      'const a   =   obj!.value',
      'expect(a).toBe(b)',
    ].join('\n')

    await recordEdit(before, after)

    // Provably non-substantive → suppressed as noise. Nothing is persisted.
    expect(createCrossing).not.toHaveBeenCalled()
    expect(createActivity).not.toHaveBeenCalled()
  })

  it('substantive or ambiguous test edit still records a TEST_TAMPERING crossing', async () => {
    // (A) Substantive: the assertion's expected value is weakened 6 → 7. This is
    // exactly the test-weakening the gate must never hide.
    await recordEdit('expect(result).toBe(6)', 'expect(result).toBe(7)')
    expect(createCrossing).toHaveBeenCalledTimes(1)
    expect(createCrossing).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 't-1', category: 'TEST_TAMPERING' })
    )

    // (B) Substantive even when no assertion line changes: a non-assertion value
    // the test depends on is altered (input 6 → 7) — still recorded.
    createCrossing.mockClear()
    await recordEdit('const input = 6', 'const input = 7')
    expect(createCrossing).toHaveBeenCalledTimes(1)

    // (C) Ambiguous: a Write replaces the file wholesale — there is no before-side
    // to diff, so the gate cannot prove it harmless and records it.
    createCrossing.mockClear()
    await recordWrite('it.skip("renders", () => {})')
    expect(createCrossing).toHaveBeenCalledTimes(1)
    expect(createCrossing).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'TEST_TAMPERING' })
    )
  })
})

describe('isCosmeticTestEdit — pure classifier (LUM-455)', () => {
  it('treats whitespace, comments, non-null assertions and reordering as cosmetic', () => {
    expect(
      isCosmeticTestEdit('expect(x).toBe(1)', '  expect(x).toBe(1)  ')
    ).toBe(true)
    expect(isCosmeticTestEdit('expect(x).toBe(1)', 'expect(x!).toBe(1)')).toBe(
      true
    )
    expect(
      isCosmeticTestEdit('a()\nb()', 'b()\na() // reordered with a note')
    ).toBe(true)
  })

  it('keeps a real change substantive and never proves a one-sided edit harmless', () => {
    // An operator flip is NOT a non-null assertion — `!==` survives normalization.
    expect(isCosmeticTestEdit('a === b', 'a !== b')).toBe(false)
    expect(isCosmeticTestEdit('expect(x).toBe(1)', 'expect(x).toBe(2)')).toBe(
      false
    )
    // A changed string literal that merely looks like a comment is not stripped.
    expect(
      isCosmeticTestEdit(
        "const u = 'https://a.com'",
        "const u = 'https://b.com'"
      )
    ).toBe(false)
    // A missing side (Write / no before) can never be proven cosmetic.
    expect(isCosmeticTestEdit(null, 'anything')).toBe(false)
    expect(isCosmeticTestEdit('anything', null)).toBe(false)
  })
})

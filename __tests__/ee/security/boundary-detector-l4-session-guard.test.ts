/**
 * @jest-environment node
 *
 * LUM-1064: plugin half of __tests__/boundary-detector-l4-session-guard.test.ts (split)
 * — the LUM-466 prose confirmation (an advanced detector of the security plugin).
 *
 * LUM-736 — L4 Session Guard: three new BoundaryCrossingCategory values on the
 * existing detector chain (no LLM, no finding table).
 *
 *  - HOOK_BYPASS        — a Bash segment runs `git commit`/`git push --no-verify`,
 *                         `git commit -n` (short flag, also folded: `-nm`/`-an`;
 *                         LUM-744), `git -c core.hooksPath=… commit|push`
 *                         (LUM-744), or prefixes `HUSKY=0` — also when the git
 *                         invocation sits inside a shell wrapper string
 *                         (`bash -c "git …"`, LUM-744 follow-up). Segment-scoped +
 *                         prose-confirmed so a commit message / PR body quoting
 *                         the flag never self-trips (the LUM-640/722 lesson).
 *  - TEST_FILE_DELETED  — an `rm` / `git rm` segment whose delete targets are
 *                         test files (`*.test.*`, `*.spec.*`, `__tests__/`).
 *  - SENSITIVE_PATH_EDIT — an Edit/Write that lands on a sensitive path
 *                         (auth/, middleware.ts / proxy.ts, .github/workflows/,
 *                         a lockfile, prisma/schema.prisma); the default path set
 *                         is replaceable by a ProjectPolicy `path-glob` rule
 *                         mapped to SENSITIVE_PATH_EDIT.
 */
import {
  detectCrossings,
  confirmActionCandidates,
} from '@/lib/services/boundary-detector.service'
import type { ActionConfirmJudge } from '@/ee/security/boundary-crossing/action-confirm'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'

jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    create: jest.fn(),
    coalesceRecurrence: jest.fn().mockResolvedValue(0),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {
    create: jest.fn(),
    listByTaskAndType: jest.fn().mockResolvedValue([]),
  },
}))
// The project-policy load is best-effort; a missing task means "no policy".
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findWithProjectWorkspaceId: jest.fn().mockResolvedValue(null),
  },
}))

const createCrossing = boundaryCrossingRepository.create as jest.Mock
const createActivity = activityRepository.create as jest.Mock

const bash = (command: string) => ({ tool_input: { command } })
const bashEvent = (command: string) => ({
  toolName: 'Bash',
  filePath: null,
  payload: bash(command),
})
const categories = (command: string) =>
  detectCrossings(bashEvent(command)).map(c => c.category)

/** A judge that must never be consulted — a real action is certain without it. */
const neverJudge: ActionConfirmJudge = jest.fn(async () => {
  throw new Error(
    'judge must not be called for a deterministically-certain action'
  )
})
const proseOnlyJudge: ActionConfirmJudge = jest.fn(async () => 'PROSE_ONLY')

beforeEach(() => {
  jest.clearAllMocks()
  createCrossing.mockResolvedValue({ id: 'bc-1' })
  createActivity.mockResolvedValue({ id: 'act-1' })
})

// --- HOOK_BYPASS ---------------------------------------------------------------

describe('HOOK_BYPASS — git hook bypass in the command segment (LUM-736)', () => {
  it('a --no-verify mentioned only inside the commit message is dropped by prose confirmation', async () => {
    const event = bashEvent(
      'git commit -m "docs: explain why --no-verify is banned"'
    )
    const candidates = detectCrossings(event)
    const kept = await confirmActionCandidates(
      event,
      candidates,
      proseOnlyJudge
    )
    expect(kept.map(c => c.category)).not.toContain('HOOK_BYPASS')
  })

  it('a real --no-verify outside all quotes is kept without consulting the judge', async () => {
    const event = bashEvent('git commit --no-verify -m "fix: real bypass"')
    const kept = await confirmActionCandidates(
      event,
      detectCrossings(event),
      neverJudge
    )
    expect(kept.map(c => c.category)).toContain('HOOK_BYPASS')
    expect(neverJudge).not.toHaveBeenCalled()
  })
})

// --- HOOK_BYPASS (LUM-744): -n short flag + core.hooksPath override ----------

describe('HOOK_BYPASS short flag -n — git commit -n is --no-verify (LUM-744)', () => {
  it('does not flag a -n that lives only inside the quoted commit message', async () => {
    // Attached to the closing quote → not a flag token at all.
    expect(categories('git commit -m "use -n"')).not.toContain('HOOK_BYPASS')
    // Free-standing inside quotes → raw candidate, dropped by prose confirmation.
    const event = bashEvent("git commit -m 'docs: why -n is banned here'")
    const kept = await confirmActionCandidates(
      event,
      detectCrossings(event),
      proseOnlyJudge
    )
    expect(kept.map(c => c.category)).not.toContain('HOOK_BYPASS')
  })

  it('a real -n outside all quotes is kept without consulting the judge', async () => {
    const event = bashEvent('git commit -nm "fix: real bypass"')
    const kept = await confirmActionCandidates(
      event,
      detectCrossings(event),
      neverJudge
    )
    expect(kept.map(c => c.category)).toContain('HOOK_BYPASS')
    expect(neverJudge).not.toHaveBeenCalled()
  })
})

describe('HOOK_BYPASS core.hooksPath — -c core.hooksPath=… before commit/push (LUM-744)', () => {
  it('a real override outside all quotes is kept without consulting the judge', async () => {
    const event = bashEvent('git -c core.hooksPath=/dev/null commit -m "x"')
    const kept = await confirmActionCandidates(
      event,
      detectCrossings(event),
      neverJudge
    )
    expect(kept.map(c => c.category)).toContain('HOOK_BYPASS')
    expect(neverJudge).not.toHaveBeenCalled()
  })
})

// --- HOOK_BYPASS (LUM-744 follow-up): shell-wrapper-quoted git ---------------

describe('HOOK_BYPASS shell wrapper — bash -c / sh -c quoted git (LUM-744 follow-up)', () => {
  const realActionJudge: ActionConfirmJudge = jest.fn(async () => 'REAL_ACTION')

  it('a wrapped bypass is a prose candidate: kept on REAL_ACTION, dropped on PROSE_ONLY', async () => {
    const event = bashEvent('bash -c "git commit --no-verify -m x"')
    const candidates = detectCrossings(event)
    expect(candidates.map(c => c.category)).toContain('HOOK_BYPASS')

    const kept = await confirmActionCandidates(
      event,
      candidates,
      realActionJudge
    )
    expect(kept.map(c => c.category)).toContain('HOOK_BYPASS')
    expect(realActionJudge).toHaveBeenCalled()

    const dropped = await confirmActionCandidates(
      event,
      candidates,
      proseOnlyJudge
    )
    expect(dropped.map(c => c.category)).not.toContain('HOOK_BYPASS')
  })
})

// --- TEST_FILE_DELETED ---------------------------------------------------------

describe('TEST_FILE_DELETED — rm / git rm of a test file (LUM-736)', () => {
  it('a test path quoted only inside a commit message is dropped by prose confirmation', async () => {
    const event = bashEvent(
      'git commit -m "chore: rm __tests__/legacy.test.ts follow-up"'
    )
    const kept = await confirmActionCandidates(
      event,
      detectCrossings(event),
      proseOnlyJudge
    )
    expect(kept.map(c => c.category)).not.toContain('TEST_FILE_DELETED')
  })
})

// --- SENSITIVE_PATH_EDIT -------------------------------------------------------

// --- TEST_FILE_DELETED — judged by net deletion, not command text (LUM-779) --

/**
 * LUM-779: the command text is a LEAD, the repo state is the verdict. The CLI
 * post-tool-use hook folds `_lumo_deleted_test_files` into the payload — the
 * tracked test files that are actually missing after the command ran (vs HEAD
 * and vs the base branch). The detector reads that field:
 *
 *   - present and non-empty → a tracked test really went away → blocking (as before)
 *   - present and empty     → a restore / an untracked scratch probe → advisory
 *   - absent                → older CLI or git could not answer → fail-closed (blocking)
 *
 * The path matcher is NOT loosened: a `/tmp` or probe-looking path still trips
 * the matcher — only the state check can downgrade it.
 */

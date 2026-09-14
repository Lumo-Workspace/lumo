/**
 * @jest-environment node
 *
 * LUM-466 — the LUM-463 confirmation step promoted to the ACTION categories.
 *
 * The deterministic command matchers are high-recall: a forbidden token that
 * appears only as PROSE — inside a commit message (`-m`/`-F`/heredoc), a PR body
 * (`gh pr create --body`), an `echo` string — still trips them. Before
 * persisting an action-category candidate the detector re-runs the matchers on a
 * prose-stripped copy of the command: a category that survives outside all
 * quotes is a real executed action (certain → flag, no LLM); one that vanished
 * matched only prose and is handed to a best-effort LLM confirmation.
 *
 *  c1 — a token that lives only in a commit message / PR body is suppressed.
 *  c2 — real executed actions + deterministically-certain HIGH hits still record
 *       regardless of the LLM, and an uncertain/failed confirmation keeps the flag.
 *  c3 — the LLM runs only on pre-filtered candidates, reuses the judge infra
 *       (shared best-effort timeout), and never blocks ingestion (exit-0).
 */
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    create: jest.fn(),
    coalesceRecurrence: jest.fn().mockResolvedValue(0),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: { listByTask: jest.fn() },
}))
// The LLM confirmation client — lazily imported by the detector, picked up here.
jest.mock('@/lib/llm/action-confirm-client', () => ({
  confirmActionExecuted: jest.fn(),
}))

import { boundaryDetectorService } from '@/lib/services/boundary-detector.service'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { confirmActionExecuted } from '@/lib/llm/action-confirm-client'
import {
  confirmActionCrossing,
  stripProse,
  type ActionConfirmVerdict,
} from '@/lib/boundary-crossing/action-confirm'

const createCrossing = boundaryCrossingRepository.create as jest.Mock
const createActivity = activityRepository.create as jest.Mock
const listByTask = acceptanceCriterionRepository.listByTask as jest.Mock
const confirm = confirmActionExecuted as jest.Mock

/** detectAndRecord input for a Bash command (filePath null → no test-tampering). */
const bash = (command: string) => ({
  taskId: 't-1',
  hookEventId: 'evt-1',
  toolName: 'Bash' as const,
  filePath: null,
  payload: { tool_input: { command } },
})

const recordedCategories = (): string[] =>
  createCrossing.mock.calls.map(c => c[0].category)

beforeEach(() => {
  jest.clearAllMocks()
  createCrossing.mockResolvedValue({ id: 'bc-1' })
  createActivity.mockResolvedValue({ id: 'act-1' })
  // No MACHINE criteria → the TEST_TAMPERING path short-circuits, isolating the
  // action-confirmation behaviour under test.
  listByTask.mockResolvedValue([])
})

describe('LUM-466 action-category prose confirmation', () => {
  it('a forbidden token appearing only in commit-message or PR-body prose is not recorded as an action crossing', async () => {
    // The model recognises both as prose, not an executed push.
    confirm.mockResolvedValue('PROSE_ONLY')

    // Commit-message prose: `git push origin main` is the MESSAGE, not a push.
    await boundaryDetectorService.detectAndRecord(
      bash('git commit -m "fix: stop calling git push origin main in CI [c1a]"')
    )
    // PR-body prose: the forbidden words live inside `--body`.
    await boundaryDetectorService.detectAndRecord(
      bash(
        'gh pr create --title cleanup --body "warn: never git push to main directly [c1b]"'
      )
    )

    // Nothing is persisted for either. The commit-message candidate reached
    // Stage 2 and the confirmation suppressed it; the PR body never became a
    // candidate at all — LUM-772 drops `gh pr create` (a read-only authoring
    // segment) before any matcher runs, so no model call is spent on it.
    expect(recordedCategories()).not.toContain('PUSH_TO_PROTECTED_BRANCH')
    expect(createCrossing).not.toHaveBeenCalled()
    expect(createActivity).not.toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0]?.[0]?.command).toContain('git commit -m')
  })

  it('real forbidden actions still record and uncertain or failed confirmation keeps the flag', async () => {
    // Adversarial: the model tries to clear EVERYTHING. A real executed action
    // must still record regardless — it never reaches the LLM. And a prose
    // candidate whose confirmation FAILS must stay flagged (conservative).
    confirm.mockRejectedValue(new Error('gateway 500'))

    // (A) A real protected-branch push — deterministically certain, HIGH stakes.
    await boundaryDetectorService.detectAndRecord(bash('git push origin main'))
    expect(recordedCategories()).toContain('PUSH_TO_PROTECTED_BRANCH')

    // (B) A real delete under prisma/migrations/.
    createCrossing.mockClear()
    await boundaryDetectorService.detectAndRecord(
      bash('rm prisma/migrations/20240101120000_init/migration.sql')
    )
    expect(recordedCategories()).toContain('MIGRATION_FILE_DELETED')

    // (C) A real destructive DB command.
    createCrossing.mockClear()
    await boundaryDetectorService.detectAndRecord(
      bash('npx prisma migrate reset --force --skip-generate')
    )
    expect(recordedCategories()).toContain('DESTRUCTIVE_DB_COMMAND')

    // (D) A deterministically-certain HIGH hit that is content-based, not a
    // command: a hardcoded secret in a written file is flagged regardless of the
    // LLM (it is never routed through the action confirmation at all). The dummy
    // AWS-key fixture is assembled from parts so THIS test file does not itself
    // carry a contiguous `AKIA…` literal that trips secret scanners (the runtime
    // string is identical, so the detector under test still matches it).
    const fakeAwsKey = `AKIA${'ABCDEF1234567890'}` // not a real key
    createCrossing.mockClear()
    await boundaryDetectorService.detectAndRecord({
      taskId: 't-1',
      hookEventId: 'evt-1',
      toolName: 'Write',
      filePath: '/repo/config.ts',
      payload: {
        tool_input: {
          file_path: '/repo/config.ts',
          content: `const key = "${fakeAwsKey}"`,
        },
      },
    })
    expect(recordedCategories()).toContain('HARDCODED_SECRET')

    // None of the certain/content hits consulted the LLM.
    expect(confirm).not.toHaveBeenCalled()

    // (E) A prose CANDIDATE whose confirmation FAILS → kept flagged (recall).
    createCrossing.mockClear()
    await boundaryDetectorService.detectAndRecord(
      bash('git commit -m "todo: avoid git push origin main from here [c2e]"')
    )
    expect(confirm).toHaveBeenCalledTimes(1) // it did reach the (failing) judge
    expect(recordedCategories()).toContain('PUSH_TO_PROTECTED_BRANCH')
  })

  it('action-category LLM confirm is candidate-only, reuses the judge infra, and is best-effort non-blocking', async () => {
    confirm.mockResolvedValue('PROSE_ONLY')

    // (1) CANDIDATE-ONLY / cost-bounded: a real action and an innocuous command
    //     never reach the LLM; only the prose candidate does.
    await boundaryDetectorService.detectAndRecord(bash('git push origin main'))
    await boundaryDetectorService.detectAndRecord(bash('git status'))
    expect(confirm).not.toHaveBeenCalled() // not run on certain/non-action commands

    await boundaryDetectorService.detectAndRecord(
      bash('git commit -m "doc: do not git push origin main here [c3]"')
    )
    expect(confirm).toHaveBeenCalledTimes(1) // only the candidate consulted the model

    // (2) REUSES THE JUDGE INFRA — the same best-effort timeout primitive the
    //     LUM-463 judge uses: a hung judge resolves quickly to the conservative
    //     REAL_ACTION (keep flagged), and a throwing judge does too.
    const hung = jest.fn(
      () => new Promise<ActionConfirmVerdict>(() => {}) // never resolves
    )
    const r1 = await confirmActionCrossing(
      { command: 'x', category: 'PUSH_TO_PROTECTED_BRANCH' },
      { judge: hung, timeoutMs: 20 }
    )
    expect(r1).toBe('REAL_ACTION')
    const throwing = jest.fn(async (): Promise<ActionConfirmVerdict> => {
      throw new Error('gateway down')
    })
    const r2 = await confirmActionCrossing(
      { command: 'x', category: 'PUSH_TO_PROTECTED_BRANCH' },
      { judge: throwing }
    )
    expect(r2).toBe('REAL_ACTION')

    // (3) BEST-EFFORT / NON-BLOCKING: a throwing confirmation on the ingestion
    //     path never throws out of detectAndRecord (exit-0) and still records.
    confirm.mockReset()
    confirm.mockRejectedValue(new Error('gateway down'))
    createCrossing.mockClear()
    await expect(
      boundaryDetectorService.detectAndRecord(
        bash('git commit -m "chore: mention git push origin main [c3b]"')
      )
    ).resolves.toBeUndefined()
    expect(recordedCategories()).toContain('PUSH_TO_PROTECTED_BRANCH')
  })
})

describe('stripProse — deterministic de-prose (pure)', () => {
  it('empties quoted-literal and heredoc contents but keeps real command structure', () => {
    // The push words inside a `-m` message are removed.
    expect(stripProse('git commit -m "git push origin main"')).not.toMatch(
      /git\s+push/
    )
    // A `--body` PR description is emptied.
    expect(stripProse('gh pr create --body "git push to main"')).not.toMatch(
      /git\s+push/
    )
    // A heredoc body is dropped (intro line kept).
    const heredoc = 'git commit -F - <<EOF\ngit push origin main\nEOF'
    expect(stripProse(heredoc)).not.toMatch(/git\s+push\s+origin\s+main/)
    // A REAL unquoted action survives de-prose unchanged.
    expect(stripProse('git push origin main')).toMatch(/git\s+push\s+origin/)
    // A backtick command substitution is NOT stripped (it executes).
    expect(stripProse('echo `git push origin main`')).toMatch(/git\s+push/)
  })
})

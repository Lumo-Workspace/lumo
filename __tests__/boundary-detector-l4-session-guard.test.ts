/**
 * @jest-environment node
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
  detectSensitivePathEdit,
  sensitivePathGlobsFromRules,
  boundaryDetectorService,
} from '@/lib/services/boundary-detector.service'
import type { ActionConfirmJudge } from '@/lib/boundary-crossing/action-confirm'
import type { PolicyRule } from '@/lib/services/policy/types'
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
  it('flags git commit --no-verify', () => {
    expect(categories('git commit -m "fix: x" --no-verify')).toContain(
      'HOOK_BYPASS'
    )
  })

  it('flags git push --no-verify to any branch', () => {
    expect(categories('git push --no-verify origin lumo/LUM-736-x')).toContain(
      'HOOK_BYPASS'
    )
  })

  it('flags a HUSKY=0 env prefix on the git invocation', () => {
    expect(categories('HUSKY=0 git commit -m "chore: skip hooks"')).toContain(
      'HOOK_BYPASS'
    )
  })

  it('is MEDIUM severity and coalesces on the matched segment, not the whole line', () => {
    const [hit] = detectCrossings(
      bashEvent('npm test && git commit -m "x" --no-verify && echo done')
    ).filter(c => c.category === 'HOOK_BYPASS')
    expect(hit?.severity).toBe('MEDIUM')
    expect(hit?.target).toBe('git commit -m "x" --no-verify')
  })

  it('does not flag --no-verify in a non-git segment (grep / log)', () => {
    expect(categories('grep -rn no-verify docs/')).not.toContain('HOOK_BYPASS')
    expect(categories('git log --oneline | grep -- --no-verify')).not.toContain(
      'HOOK_BYPASS'
    )
  })

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
  it('flags git commit -n as a standalone token', () => {
    expect(categories('git commit -n -m "fix: x"')).toContain('HOOK_BYPASS')
    expect(categories('git commit --amend -n')).toContain('HOOK_BYPASS')
  })

  it('flags -n folded into a combined short-flag token (-nm / -an / -anm)', () => {
    expect(categories('git commit -nm "fix: x"')).toContain('HOOK_BYPASS')
    expect(categories('git commit -an "fix: x"')).toContain('HOOK_BYPASS')
    expect(categories('git commit -anm "fix: x"')).toContain('HOOK_BYPASS')
  })

  it('does not flag -n on a non-commit git verb (log / rev-list / push dry-run)', () => {
    expect(categories('git log -n 5')).not.toContain('HOOK_BYPASS')
    expect(categories('git rev-list -n 1 HEAD')).not.toContain('HOOK_BYPASS')
    // `commit` appearing as an OPTION VALUE is not the verb.
    expect(categories('git log --grep commit -n 5')).not.toContain(
      'HOOK_BYPASS'
    )
    // For push, -n is --dry-run, not --no-verify.
    expect(categories('git push -n origin lumo/LUM-744-x')).not.toContain(
      'HOOK_BYPASS'
    )
  })

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

  it('still locates git behind a path prefix, an env prefix, or a subshell paren', () => {
    expect(categories('/usr/bin/git commit -n -m x')).toContain('HOOK_BYPASS')
    expect(categories('GIT_AUTHOR_NAME=x git commit -nm x')).toContain(
      'HOOK_BYPASS'
    )
    expect(categories('(git commit --no-verify -m x)')).toContain('HOOK_BYPASS')
  })

  it('coalesces on the matched segment, not the whole line', () => {
    const [hit] = detectCrossings(
      bashEvent('npm test && git commit -nm "x" && echo done')
    ).filter(c => c.category === 'HOOK_BYPASS')
    expect(hit?.severity).toBe('MEDIUM')
    expect(hit?.target).toBe('git commit -nm "x"')
  })
})

describe('HOOK_BYPASS core.hooksPath — -c core.hooksPath=… before commit/push (LUM-744)', () => {
  it('flags git -c core.hooksPath=/dev/null commit', () => {
    expect(
      categories('git -c core.hooksPath=/dev/null commit -m "fix: x"')
    ).toContain('HOOK_BYPASS')
  })

  it('flags any hooksPath override on push, and the folded -c<key>=<val> form', () => {
    expect(
      categories('git -c core.hooksPath=/tmp/empty push origin lumo/LUM-744-x')
    ).toContain('HOOK_BYPASS')
    expect(categories('git -ccore.hooksPath=/dev/null commit -m x')).toContain(
      'HOOK_BYPASS'
    )
    // Config keys are case-insensitive in git.
    expect(categories('git -c core.hookspath= commit -m x')).toContain(
      'HOOK_BYPASS'
    )
  })

  it('still finds the verb behind other global options', () => {
    expect(
      categories('git -C /srv/repo -c core.hooksPath=/dev/null commit -m x')
    ).toContain('HOOK_BYPASS')
  })

  it('does not flag a sibling segment that merely mentions hooksPath', () => {
    expect(
      categories('grep -rn hooksPath .husky && git commit -m "fix: x"')
    ).not.toContain('HOOK_BYPASS')
    expect(
      categories(
        'echo core.hooksPath=/dev/null; git push origin lumo/LUM-744-x'
      )
    ).not.toContain('HOOK_BYPASS')
  })

  it('does not flag a hooksPath that is not a commit/push override', () => {
    // `git config` verb — pointing hooks at the real husky dir.
    expect(categories('git config core.hooksPath .husky')).not.toContain(
      'HOOK_BYPASS'
    )
    // Mentioned after the verb, inside the message → not a global option.
    expect(
      categories('git commit -m "core.hooksPath=/dev/null is banned"')
    ).not.toContain('HOOK_BYPASS')
  })

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

  it('coalesces on the matched segment', () => {
    const [hit] = detectCrossings(
      bashEvent('npm test && git -c core.hooksPath=/dev/null commit -m "x"')
    ).filter(c => c.category === 'HOOK_BYPASS')
    expect(hit?.target).toBe('git -c core.hooksPath=/dev/null commit -m "x"')
  })
})

// --- HOOK_BYPASS (LUM-744 follow-up): shell-wrapper-quoted git ---------------

describe('HOOK_BYPASS shell wrapper — bash -c / sh -c quoted git (LUM-744 follow-up)', () => {
  const realActionJudge: ActionConfirmJudge = jest.fn(async () => 'REAL_ACTION')

  it("still finds git behind an opening double / single / $' quote", () => {
    // The three steward probes that hit on the LUM-736 \bgit regex but missed
    // once the token parser required a bare `git` token.
    expect(categories('bash -c "git commit --no-verify -m x"')).toContain(
      'HOOK_BYPASS'
    )
    expect(categories("sh -c 'git commit -n -m x'")).toContain('HOOK_BYPASS')
    expect(categories('bash -c "git push --no-verify origin HEAD"')).toContain(
      'HOOK_BYPASS'
    )
    expect(categories("bash -c $'git commit -nm x'")).toContain('HOOK_BYPASS')
  })

  it("reads the flag / verb that carries the wrapper's closing quote", () => {
    expect(categories("sh -c 'git commit -m x --no-verify'")).toContain(
      'HOOK_BYPASS'
    )
    expect(categories('bash -c "git commit -n"')).toContain('HOOK_BYPASS')
    expect(
      categories('bash -c "git -c core.hooksPath=/dev/null push"')
    ).toContain('HOOK_BYPASS')
  })

  it('keeps the segment / verb / glued-quote rules inside the wrapper', () => {
    expect(categories("bash -c 'git log -n 5'")).not.toContain('HOOK_BYPASS')
    expect(categories('sh -c "git push -n origin HEAD"')).not.toContain(
      'HOOK_BYPASS'
    )
    expect(categories("bash -c 'echo --no-verify'")).not.toContain(
      'HOOK_BYPASS'
    )
    // A `-n` closing an inner (escaped or other-quoted) message is still text.
    expect(categories('bash -c "git commit -m \\"use -n\\""')).not.toContain(
      'HOOK_BYPASS'
    )
    expect(categories('sh -c \'git commit -m "use -n"\'')).not.toContain(
      'HOOK_BYPASS'
    )
  })

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

  it('coalesces on the wrapper segment, not the whole line', () => {
    const [hit] = detectCrossings(
      bashEvent('npm test && bash -c "git commit -n -m x" && echo done')
    ).filter(c => c.category === 'HOOK_BYPASS')
    expect(hit?.severity).toBe('MEDIUM')
    expect(hit?.target).toBe('bash -c "git commit -n -m x"')
  })
})

// --- TEST_FILE_DELETED ---------------------------------------------------------

describe('TEST_FILE_DELETED — rm / git rm of a test file (LUM-736)', () => {
  it('flags rm of a *.test.* file', () => {
    expect(categories('rm __tests__/foo.test.ts')).toContain(
      'TEST_FILE_DELETED'
    )
  })

  it('flags git rm of a *.spec.* file', () => {
    expect(categories('git rm lib/bar.spec.tsx')).toContain('TEST_FILE_DELETED')
  })

  it('flags rm -rf of a __tests__/ directory', () => {
    expect(categories('rm -rf __tests__/fixtures')).toContain(
      'TEST_FILE_DELETED'
    )
  })

  it('is MEDIUM severity and coalesces on the rm segment', () => {
    const [hit] = detectCrossings(
      bashEvent('ls; rm __tests__/foo.test.ts; npm test')
    ).filter(c => c.category === 'TEST_FILE_DELETED')
    expect(hit?.severity).toBe('MEDIUM')
    expect(hit?.target).toBe('rm __tests__/foo.test.ts')
  })

  it('does not flag when a sibling segment merely references a test path', () => {
    expect(
      categories('npx jest __tests__/x.test.ts && rm tmp.txt')
    ).not.toContain('TEST_FILE_DELETED')
    expect(categories('rm -f tmp.txt; ls __tests__/')).not.toContain(
      'TEST_FILE_DELETED'
    )
  })

  it('does not flag a delete of a non-test file', () => {
    expect(categories('rm -rf .next coverage')).toEqual([])
    expect(categories('git rm lib/services/old.service.ts')).toEqual([])
  })

  it('is emitted from the Bash path only — an Edit/Write to a test file is never TEST_FILE_DELETED', () => {
    expect(
      detectCrossings({
        toolName: 'Edit',
        filePath: '/repo/__tests__/foo.test.ts',
        payload: {
          tool_input: {
            file_path: '/repo/__tests__/foo.test.ts',
            old_string: 'a',
            new_string: 'b',
          },
        },
      }).map(c => c.category)
    ).not.toContain('TEST_FILE_DELETED')
  })

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

describe('SENSITIVE_PATH_EDIT — Edit/Write on a sensitive path (LUM-736)', () => {
  const edit = (filePath: string, toolName = 'Edit') =>
    detectSensitivePathEdit({ toolName, filePath })

  it.each([
    '/repo/lib/auth/session.ts',
    '/repo/middleware.ts',
    '/repo/proxy.ts',
    '/repo/.github/workflows/ci.yml',
    '/repo/package-lock.json',
    '/repo/pnpm-lock.yaml',
    '/repo/yarn.lock',
    '/repo/prisma/schema.prisma',
  ])('flags an Edit on default sensitive path %s', p => {
    const hit = edit(p)
    expect(hit?.category).toBe('SENSITIVE_PATH_EDIT')
    expect(hit?.severity).toBe('MEDIUM')
  })

  it('flags a Write as well as an Edit', () => {
    expect(edit('/repo/lib/auth/token.ts', 'Write')?.category).toBe(
      'SENSITIVE_PATH_EDIT'
    )
  })

  it('coalesces on the normalized file path and names the matched rule', () => {
    const hit = edit('./lib/auth/session.ts')
    expect(hit?.target).toBe('lib/auth/session.ts')
    expect(hit?.detail).toContain('lib/auth/session.ts')
    expect(hit?.detail).toContain('auth/')
  })

  it('does not flag a read-only tool or a Bash event on a sensitive path', () => {
    expect(edit('/repo/lib/auth/session.ts', 'Read')).toBeNull()
    expect(edit('/repo/lib/auth/session.ts', 'Bash')).toBeNull()
    expect(
      detectSensitivePathEdit({ toolName: 'Edit', filePath: null })
    ).toBeNull()
  })

  it('does not flag a non-sensitive path (auth must be a whole path segment)', () => {
    expect(edit('/repo/lib/services/task.service.ts')).toBeNull()
    expect(edit('/repo/lib/author/bio.ts')).toBeNull()
    expect(edit('/repo/lib/authz-helpers.ts')).toBeNull()
    expect(edit('/repo/docs/middleware.md')).toBeNull()
  })

  it('a ProjectPolicy path-glob rule mapped to SENSITIVE_PATH_EDIT replaces the default path set', () => {
    const rules: PolicyRule[] = [
      {
        id: 'r1',
        text: 'Billing code is sensitive',
        kind: 'action',
        tier: 'deterministic',
        mappedCategory: 'SENSITIVE_PATH_EDIT',
        predicate: { type: 'path-glob', value: 'lib/billing/**' },
        severity: 'MEDIUM',
        blocking: true,
      },
      {
        id: 'r2',
        text: 'never run flush-prod',
        kind: 'action',
        tier: 'deterministic',
        predicate: { type: 'cmd-substr', value: 'flush-prod' },
        severity: 'HIGH',
        blocking: false,
      },
    ]
    const globs = sensitivePathGlobsFromRules(rules)
    expect(globs).toEqual(['lib/billing/**'])
    expect(
      detectSensitivePathEdit({
        toolName: 'Edit',
        filePath: '/repo/lib/billing/charge.ts',
        sensitivePathGlobs: globs,
      })?.category
    ).toBe('SENSITIVE_PATH_EDIT')
    // Overridden: the built-in auth/ rule no longer applies for this project.
    expect(
      detectSensitivePathEdit({
        toolName: 'Edit',
        filePath: '/repo/lib/auth/session.ts',
        sensitivePathGlobs: globs,
      })
    ).toBeNull()
  })

  it('a policy with no SENSITIVE_PATH_EDIT path-glob rule leaves the defaults in force', () => {
    const rules: PolicyRule[] = [
      {
        id: 'r2',
        text: 'never run flush-prod',
        kind: 'action',
        tier: 'deterministic',
        predicate: { type: 'cmd-substr', value: 'flush-prod' },
        severity: 'HIGH',
        blocking: false,
      },
    ]
    expect(sensitivePathGlobsFromRules(rules)).toEqual([])
    expect(
      detectSensitivePathEdit({
        toolName: 'Edit',
        filePath: '/repo/lib/auth/session.ts',
        sensitivePathGlobs: [],
      })?.category
    ).toBe('SENSITIVE_PATH_EDIT')
  })

  it('SENSITIVE_PATH_EDIT flows through detectAndRecord as a reversible MEDIUM crossing', async () => {
    await boundaryDetectorService.detectAndRecord({
      taskId: 't-1',
      hookEventId: 'evt-1',
      toolName: 'Edit',
      filePath: '/repo/lib/auth/session.ts',
      payload: {
        tool_input: {
          file_path: '/repo/lib/auth/session.ts',
          old_string: 'a',
          new_string: 'b',
        },
      },
    })
    expect(createCrossing).toHaveBeenCalledTimes(1)
    expect(createCrossing).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't-1',
        hookEventId: 'evt-1',
        category: 'SENSITIVE_PATH_EDIT',
        severity: 'MEDIUM',
        reversible: true,
        // Coalesces on the normalized event path (absolute).
        target: '/repo/lib/auth/session.ts',
      })
    )
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'BOUNDARY_CROSSING_DETECTED',
        payload: expect.objectContaining({ category: 'SENSITIVE_PATH_EDIT' }),
      })
    )
  })
})

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
describe('TEST_FILE_DELETED — net deletion, not command text (LUM-779)', () => {
  const bashWithState = (command: string, deleted: string[] | undefined) => ({
    toolName: 'Bash',
    filePath: null,
    payload: {
      tool_input: { command },
      ...(deleted !== undefined ? { _lumo_deleted_test_files: deleted } : {}),
    },
  })
  const testFileDeleted = (command: string, deleted: string[] | undefined) =>
    detectCrossings(bashWithState(command, deleted)).filter(
      c => c.category === 'TEST_FILE_DELETED'
    )

  it('LUM-779 no-net-deletion: rm of an untracked scratch probe (state lists nothing missing) is recorded advisory', () => {
    const [hit] = testFileDeleted(
      'rm -f __tests__/security-scan/hunt/zz-probe.test.ts; git status --porcelain',
      []
    )
    expect(hit).toBeDefined()
    expect(hit?.advisory).toBe(true)
    expect(hit?.severity).toBe('MEDIUM')
    expect(hit?.detail).toContain('No tracked test file is missing')
  })

  it('LUM-779 no-net-deletion: a restore-then-rm round trip that leaves the tracked file in place is advisory', () => {
    const [hit] = testFileDeleted(
      'rm __tests__/workflows/security-hunt.workflow.test.ts && git checkout -- __tests__/workflows/security-hunt.workflow.test.ts',
      []
    )
    expect(hit?.advisory).toBe(true)
  })

  it('LUM-779 tracked-deletion: a tracked test file that is really missing after the command stays blocking (non-advisory MEDIUM)', () => {
    const [hit] = testFileDeleted('rm __tests__/foo.test.ts', [
      '__tests__/foo.test.ts',
    ])
    expect(hit).toBeDefined()
    expect(hit?.advisory).toBeFalsy()
    expect(hit?.severity).toBe('MEDIUM')
    expect(hit?.detail).toContain('__tests__/foo.test.ts')
  })

  it('LUM-779 tracked-deletion: git rm of a whole __tests__ tree with tracked files missing stays blocking', () => {
    const [hit] = testFileDeleted('git rm -r __tests__/fixtures', [
      '__tests__/fixtures/a.json',
      '__tests__/fixtures/b.test.ts',
    ])
    expect(hit?.advisory).toBeFalsy()
  })

  it('LUM-779 tracked-deletion: the path matcher is not loosened — a /tmp or probe-looking test path still trips the matcher', () => {
    expect(categories('rm -f /tmp/gate.test.ts')).toContain('TEST_FILE_DELETED')
    expect(categories('rm -f .superpowers/sdd/probe-cmd.test.ts')).toContain(
      'TEST_FILE_DELETED'
    )
    // …and with the state saying a tracked test IS missing, it blocks.
    const [hit] = testFileDeleted(
      'rm -f /tmp/gate.test.ts __tests__/x.test.ts',
      ['__tests__/x.test.ts']
    )
    expect(hit?.advisory).toBeFalsy()
  })

  it('LUM-779 fail-closed: without the git-state field (older CLI / git could not answer) the legacy blocking behaviour is kept', () => {
    const [hit] = testFileDeleted('rm __tests__/foo.test.ts', undefined)
    expect(hit).toBeDefined()
    expect(hit?.advisory).toBeFalsy()
    expect(hit?.severity).toBe('MEDIUM')
  })

  it('LUM-779 fail-closed: a malformed state field (not an array of strings) is treated as absent', () => {
    const malformed = detectCrossings({
      toolName: 'Bash',
      filePath: null,
      payload: {
        tool_input: { command: 'rm __tests__/foo.test.ts' },
        _lumo_deleted_test_files: 'nope',
      },
    }).filter(c => c.category === 'TEST_FILE_DELETED')
    expect(malformed[0]?.advisory).toBeFalsy()
    // An array with non-string entries is malformed too: absent, not a verdict.
    const nonStrings = detectCrossings({
      toolName: 'Bash',
      filePath: null,
      payload: {
        tool_input: { command: 'rm __tests__/foo.test.ts' },
        _lumo_deleted_test_files: [42, null],
      },
    }).filter(c => c.category === 'TEST_FILE_DELETED')
    expect(nonStrings[0]?.advisory).toBeFalsy()
    expect(nonStrings[0]?.detail).toBe('rm __tests__/foo.test.ts')
  })

  it('LUM-779 fail-closed: an evasion-decoded delete is never downgraded, even with an empty state list', () => {
    const encoded = Buffer.from('rm __tests__/foo.test.ts').toString('base64')
    const [hit] = testFileDeleted(`echo ${encoded} | base64 -d | sh`, [])
    expect(hit).toBeDefined()
    expect(hit?.severity).toBe('HIGH')
    expect(hit?.advisory).toBeFalsy()
  })

  it('LUM-779: the state field only ever touches TEST_FILE_DELETED — a sibling category on the same line is untouched', () => {
    const all = detectCrossings(
      bashWithState('rm __tests__/foo.test.ts && git push origin main', [])
    )
    const push = all.find(c => c.category === 'PUSH_TO_PROTECTED_BRANCH')
    expect(push).toBeDefined()
    expect(push?.advisory).toBeFalsy()
  })
})

describe('TEST_FILE_DELETED — recorder keys the coalesce on the advisory side (LUM-779)', () => {
  const coalesce = boundaryCrossingRepository.coalesceRecurrence as jest.Mock

  beforeEach(() => {
    createCrossing.mockReset()
    createCrossing.mockResolvedValue({ id: 'bc-1' })
    createActivity.mockReset()
    coalesce.mockReset()
    coalesce.mockResolvedValue(0)
  })

  const record = (deleted: string[] | undefined) =>
    boundaryDetectorService.detectAndRecord({
      taskId: 'task-1',
      hookEventId: 'evt-1',
      toolName: 'Bash',
      filePath: null,
      payload: {
        tool_input: { command: 'rm __tests__/x.test.ts' },
        ...(deleted !== undefined ? { _lumo_deleted_test_files: deleted } : {}),
      },
    })

  it('LUM-779: an advisory TEST_FILE_DELETED coalesces only with advisory rows and is persisted advisory', async () => {
    await record([])
    expect(coalesce).toHaveBeenCalledWith(
      'task-1',
      'TEST_FILE_DELETED',
      'rm __tests__/x.test.ts',
      expect.any(Date),
      true
    )
    expect(createCrossing).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'TEST_FILE_DELETED', advisory: true })
    )
  })

  it('LUM-779: a blocking TEST_FILE_DELETED coalesces only with blocking rows', async () => {
    await record(['__tests__/x.test.ts'])
    expect(coalesce).toHaveBeenCalledWith(
      'task-1',
      'TEST_FILE_DELETED',
      'rm __tests__/x.test.ts',
      expect.any(Date),
      false
    )
    const created = createCrossing.mock.calls[0]![0]
    expect(created.category).toBe('TEST_FILE_DELETED')
    expect(created.advisory ?? false).toBe(false)
  })
})

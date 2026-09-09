/**
 * @jest-environment node
 *
 * LUM-736 — L4 Session Guard: three new BoundaryCrossingCategory values on the
 * existing detector chain (no LLM, no finding table).
 *
 *  - HOOK_BYPASS        — a Bash segment runs `git commit`/`git push --no-verify`
 *                         or prefixes `HUSKY=0`. Segment-scoped + prose-confirmed
 *                         so a commit message / PR body quoting the flag never
 *                         self-trips (the LUM-640/722 lesson).
 *  - TEST_FILE_DELETED  — an `rm` / `git rm` segment whose delete targets are
 *                         test files (`*.test.*`, `*.spec.*`, `__tests__/`).
 *                         Distinct from TEST_TAMPERING (an Edit/Write to a
 *                         checkpointer-referenced file).
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
// An Edit/Write event runs the test-tampering check, which reads the task's
// criteria; with none it short-circuits before any judge call.
jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: {
    listByTask: jest.fn().mockResolvedValue([]),
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
        // Coalesces on the normalized event path (absolute, like TEST_TAMPERING).
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

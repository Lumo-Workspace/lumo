/**
 * @jest-environment node
 *
 * LUM-590 — Policy compiler service tests.
 *
 * Architecture note on mock strategy:
 * - `@/lib/integrations/github/contents` and `@/lib/llm/policy-compiler-client`
 *   are jest.mocked at module scope (intercepts dynamic imports too because jest
 *   rewrites the module registry before tests run).
 * - `@/lib/repositories/project-policy.repository` is jest.mocked with STATEFUL
 *   implementations so that the "cached" test can assert classifyRules is NOT
 *   called a second time when the source hash is unchanged — the mock actually
 *   writes/reads the stored row, making the cache hit non-vacuous (trap 3 from
 *   the task brief).
 * - `@/lib/repositories/boundary-crossing.repository` is only spied on, since
 *   boundaryCrossingRepository is imported by the service at module level and we
 *   only need to spy on `.create`.
 */
import {
  policyCompilerService,
  __resetSourceCache,
} from '@/lib/services/policy/policy-compiler.service'
import * as contents from '@/lib/integrations/github/contents'
import * as client from '@/lib/llm/policy-compiler-client'
import { projectPolicyRepository } from '@/lib/repositories/project-policy.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'

// ── Module-level mocks ────────────────────────────────────────────────────────

// Mock github/auth first to prevent @octokit/auth-app ESM parse error.
jest.mock('@/lib/integrations/github/auth', () => ({
  getGithubInstallationToken: jest.fn().mockResolvedValue('test-token'),
}))
jest.mock('@/lib/integrations/github/contents')
jest.mock('@/lib/llm/policy-compiler-client')

// Stateful mock store for projectPolicyRepository.
// Each projectId maps to the last-written policy row so latestForProject
// returns what create() stored — this is what makes the "cached" test
// non-vacuous (the cache hit is a REAL lookup against the just-written row).
const policyStore: Map<
  string,
  {
    sourceHash: string
    rules: import('@/lib/services/policy/types').PolicyRule[]
  }
> = new Map()

jest.mock('@/lib/repositories/project-policy.repository', () => ({
  projectPolicyRepository: {
    latestForProject: jest.fn(async (projectId: string) => {
      return policyStore.get(projectId) ?? null
    }),
    create: jest.fn(
      async (input: {
        projectId: string
        sourceHash: string
        rules: import('@/lib/services/policy/types').PolicyRule[]
      }) => {
        policyStore.set(input.projectId, {
          sourceHash: input.sourceHash,
          rules: input.rules,
        })
      }
    ),
  },
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FORBIDDEN_MD =
  '## Forbidden\n- Never push to main\n- Use named exports\n- Never touch legacy/**'

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  policyStore.clear()
  __resetSourceCache()
  jest.clearAllMocks()
  // Re-install stateful implementations after clearAllMocks resets them.
  ;(projectPolicyRepository.latestForProject as jest.Mock).mockImplementation(
    async (projectId: string) => policyStore.get(projectId) ?? null
  )
  ;(projectPolicyRepository.create as jest.Mock).mockImplementation(
    async (input: {
      projectId: string
      sourceHash: string
      rules: import('@/lib/services/policy/types').PolicyRule[]
    }) => {
      policyStore.set(input.projectId, {
        sourceHash: input.sourceHash,
        rules: input.rules,
      })
    }
  )
})

test('compiler classifies rules into action or code and deterministic or semantic', async () => {
  ;(contents.readRepoFile as jest.Mock).mockResolvedValue(FORBIDDEN_MD)
  ;(client.classifyRules as jest.Mock).mockResolvedValue({
    rules: [
      {
        text: 'Never push to main',
        kind: 'action',
        tier: 'deterministic',
        mappedCategory: 'PUSH_TO_PROTECTED_BRANCH',
        severity: 'MEDIUM',
        blocking: true,
      },
      {
        text: 'Use named exports',
        kind: 'code',
        tier: 'semantic',
        assertion: 'use named exports',
        severity: 'LOW',
        blocking: false,
      },
      {
        text: 'Never touch legacy/**',
        kind: 'action',
        tier: 'deterministic',
        predicate: { type: 'path-glob', value: 'legacy/**' },
        severity: 'MEDIUM',
        blocking: false,
      },
    ],
  })
  const policy = await policyCompilerService.ensureCompiled({
    projectId: 'p1',
    workspaceId: 'w1',
    fullName: 'o/r',
  })
  expect(policy!.rules.map(r => `${r.kind}:${r.tier}`)).toEqual([
    'action:deterministic',
    'code:semantic',
    'action:deterministic',
  ])
  // safe-shape invariant: deterministic rules carry mappedCategory OR a safe predicate
  for (const r of policy!.rules.filter(r => r.tier === 'deterministic')) {
    expect(Boolean(r.mappedCategory) || Boolean(r.predicate)).toBe(true)
  }
})

test('compiler reuses cached policy when source hash unchanged', async () => {
  ;(contents.readRepoFile as jest.Mock).mockResolvedValue(FORBIDDEN_MD)
  ;(client.classifyRules as jest.Mock).mockResolvedValue({
    rules: [
      {
        text: 'Never push to main',
        kind: 'action',
        tier: 'deterministic',
        mappedCategory: 'PUSH_TO_PROTECTED_BRANCH',
        severity: 'MEDIUM',
        blocking: true,
      },
    ],
  })

  await policyCompilerService.ensureCompiled({
    projectId: 'p2',
    workspaceId: 'w1',
    fullName: 'o/r',
  }) // compiles once — writes to policyStore['p2']
  ;(client.classifyRules as jest.Mock).mockClear()

  await policyCompilerService.ensureCompiled({
    projectId: 'p2',
    workspaceId: 'w1',
    fullName: 'o/r',
  }) // same hash — latestForProject returns the stored row

  expect(client.classifyRules).not.toHaveBeenCalled()
})

test('removing a Forbidden rule emits POLICY_WEAKENING with no agent disposition path', async () => {
  const createSpy = jest
    .spyOn(boundaryCrossingRepository, 'create')
    .mockResolvedValue(undefined as never)

  jest.spyOn(projectPolicyRepository, 'latestForProject').mockResolvedValue({
    sourceHash: 'old',
    rules: [
      {
        id: 'r1',
        text: 'Never push to main',
        kind: 'action',
        tier: 'deterministic',
        mappedCategory: 'PUSH_TO_PROTECTED_BRANCH',
        severity: 'MEDIUM',
        blocking: true,
      },
    ],
  })
  ;(contents.readRepoFile as jest.Mock).mockResolvedValue(
    '## Forbidden\n- Use named exports'
  ) // push rule removed
  ;(client.classifyRules as jest.Mock).mockResolvedValue({
    rules: [
      {
        text: 'Use named exports',
        kind: 'code',
        tier: 'semantic',
        assertion: 'x',
        severity: 'LOW',
        blocking: false,
      },
    ],
  })

  await policyCompilerService.ensureCompiled({
    projectId: 'p3',
    workspaceId: 'w1',
    fullName: 'o/r',
    taskId: 't1',
  })

  expect(createSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      category: 'POLICY_WEAKENING',
      taskId: 't1',
      advisory: false,
      // LUM-630: a committed CLAUDE.md edit is repo state — reversible, and
      // the create site must say so explicitly (no repository default).
      reversible: true,
    })
  )
})

test('downgrading a deterministic+blocking rule to semantic emits POLICY_WEAKENING with same policyRuleRef', async () => {
  // The rule text is IDENTICAL in both prev and next — same id (sha256 of text).
  // Only the LLM reclassification changes tier from deterministic to semantic,
  // and blocking from true to false. This verifies the downgrade path is caught.
  const createSpy = jest
    .spyOn(boundaryCrossingRepository, 'create')
    .mockResolvedValue(undefined as never)

  const ruleText = 'Never delete files in prisma/migrations/'
  // Compute the same id the service would compute: sha256(text).slice(0,16)
  const { createHash } = await import('crypto')
  const expectedRuleId = createHash('sha256')
    .update(ruleText)
    .digest('hex')
    .slice(0, 16)

  jest.spyOn(projectPolicyRepository, 'latestForProject').mockResolvedValue({
    sourceHash: 'old-hash',
    rules: [
      {
        id: expectedRuleId,
        text: ruleText,
        kind: 'action',
        tier: 'deterministic',
        mappedCategory: 'MIGRATION_FILE_DELETED',
        severity: 'HIGH',
        blocking: true,
      },
    ],
  })

  // Source still contains the same rule text — so the new compilation will
  // produce the same id. But classifyRules now returns tier:'semantic'.
  ;(contents.readRepoFile as jest.Mock).mockResolvedValue(
    `## Forbidden\n- ${ruleText}`
  )
  ;(client.classifyRules as jest.Mock).mockResolvedValue({
    rules: [
      {
        text: ruleText,
        kind: 'action',
        tier: 'semantic', // downgraded — same text, weaker classification
        assertion: 'do not delete migration files',
        severity: 'HIGH',
        blocking: false,
      },
    ],
  })

  await policyCompilerService.ensureCompiled({
    projectId: 'p4',
    workspaceId: 'w1',
    fullName: 'o/r',
    taskId: 't2',
  })

  // Must fire exactly once for the downgraded rule.
  expect(createSpy).toHaveBeenCalledTimes(1)
  expect(createSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      category: 'POLICY_WEAKENING',
      taskId: 't2',
      advisory: false,
      policyRuleRef: expectedRuleId,
    })
  )
  // The detail must mention "downgraded", not "removed" — non-vacuous check.
  const callArg = createSpy.mock.calls[0]?.[0] as { detail: string }
  expect(callArg.detail).toMatch(/downgraded/)
})

// ── LUM-770: obligations must never become cmd-substr prohibitions ───────────
//
// The detector treats every deterministic cmd-substr action rule as "running a
// command containing this substring is a violation". GLM compiled the PR
// Checklist line ("tests + `npx tsc --noEmit` pass" — a MUST-DO) into exactly
// such a rule, so every real `npx tsc --noEmit` was recorded as a
// PROJECT_RULE_VIOLATION (LUM-766 crossing). Test names below are literal
// MACHINE checkpointers — do not rename.

import { detectProjectActionCrossings } from '@/lib/services/boundary-detector.service'

const CHECKLIST_MD =
  '## PR Checklist\n\nBefore opening a PR: tests + `npx tsc --noEmit` pass, no `console.log`; branch/PR-title follow the **Git** conventions.'

/** The exact LUM-766 command: a read-only cat, then tsc piped into grep. */
const LUM_766_COMMAND =
  'cd "/Users/x/lumo" && cat tmp/plan.log && npx tsc --noEmit 2>&1 | grep -E "error TS" | head -20'

const bashEvent = (command: string) => ({
  toolName: 'Bash',
  payload: { tool_input: { command } },
})

test('LUM-770: an obligation with a cmd-substr predicate compiles to semantic and the LUM-766 tsc command raises no PROJECT_RULE_VIOLATION', async () => {
  ;(contents.readRepoFile as jest.Mock).mockResolvedValue(CHECKLIST_MD)
  ;(client.classifyRules as jest.Mock).mockResolvedValue({
    rules: [
      // What GLM actually emitted for the checklist line, with the model
      // correctly reporting the rule as an obligation.
      {
        text: 'Run `npx tsc --noEmit` and the tests prior to a PR',
        kind: 'action',
        tier: 'deterministic',
        predicate: { type: 'cmd-substr', value: 'tsc --noEmit' },
        severity: 'MEDIUM',
        blocking: false,
        polarity: 'require',
      },
      // The model mislabels the polarity — the wording itself is a checklist
      // item with no prohibition in it, so the text guard must still catch it.
      {
        text: 'Before opening a PR: tests + `npx tsc --noEmit` pass',
        kind: 'action',
        tier: 'deterministic',
        predicate: { type: 'cmd-substr', value: 'npx tsc' },
        severity: 'MEDIUM',
        blocking: false,
        polarity: 'forbid',
      },
      // The "tests" half of the same line, from a model that reports no
      // polarity at all.
      {
        text: 'Tests must pass before opening a PR',
        kind: 'action',
        tier: 'deterministic',
        predicate: { type: 'cmd-substr', value: 'npm test' },
        severity: 'MEDIUM',
        blocking: false,
      },
    ],
  })
  const policy = await policyCompilerService.ensureCompiled({
    projectId: 'p770',
    workspaceId: 'w1',
    fullName: 'o/r',
  })
  expect(policy!.rules).toHaveLength(3)
  for (const r of policy!.rules) {
    expect(r.tier).toBe('semantic')
    expect(r.predicate).toBeUndefined()
    expect(r.assertion).toBe(r.text)
  }
  expect(
    detectProjectActionCrossings(bashEvent(LUM_766_COMMAND), policy!.rules)
  ).toEqual([])
  expect(
    detectProjectActionCrossings(bashEvent('npm test'), policy!.rules)
  ).toEqual([])
})

test('LUM-770: prohibitions keep their cmd-substr predicate and still raise', async () => {
  ;(contents.readRepoFile as jest.Mock).mockResolvedValue(
    '## Forbidden\n- Never push to main\n- never run flush-prod\n- You must never apply prod migrations by hand\n- Migrations must only be applied by CI'
  )
  ;(client.classifyRules as jest.Mock).mockResolvedValue({
    rules: [
      {
        text: 'Never push to main',
        kind: 'action',
        tier: 'deterministic',
        predicate: { type: 'cmd-substr', value: 'git push origin main' },
        severity: 'MEDIUM',
        blocking: false,
        polarity: 'forbid',
      },
      {
        text: 'never run flush-prod',
        kind: 'action',
        tier: 'deterministic',
        predicate: { type: 'cmd-substr', value: 'flush-prod' },
        severity: 'HIGH',
        blocking: false,
      },
      // "must" + "never": a prohibition phrased with an obligation verb.
      {
        text: 'You must never apply prod migrations by hand (prisma migrate deploy)',
        kind: 'action',
        tier: 'deterministic',
        predicate: { type: 'cmd-substr', value: 'prisma migrate deploy' },
        severity: 'HIGH',
        blocking: false,
        polarity: 'forbid',
      },
      // "must only": an exclusivity rule is a prohibition on everyone else.
      {
        text: 'Migrations must only be applied by CI (prisma migrate reset is forbidden locally)',
        kind: 'action',
        tier: 'deterministic',
        predicate: { type: 'cmd-substr', value: 'prisma migrate reset' },
        severity: 'HIGH',
        blocking: false,
        polarity: 'forbid',
      },
    ],
  })
  const policy = await policyCompilerService.ensureCompiled({
    projectId: 'p770b',
    workspaceId: 'w1',
    fullName: 'o/r',
  })
  expect(policy!.rules.map(r => r.tier)).toEqual([
    'deterministic',
    'deterministic',
    'deterministic',
    'deterministic',
  ])
  expect(policy!.rules.every(r => r.predicate?.type === 'cmd-substr')).toBe(
    true
  )
  const refs = (command: string) =>
    detectProjectActionCrossings(bashEvent(command), policy!.rules).map(
      c => c.policyRuleText
    )
  expect(refs('git push origin main')).toEqual(['Never push to main'])
  expect(refs('node scripts/flush-prod.js')).toEqual(['never run flush-prod'])
  expect(refs('npx prisma migrate deploy')).toEqual([
    'You must never apply prod migrations by hand (prisma migrate deploy)',
  ])
  expect(refs('npx prisma migrate reset --force')).toEqual([
    'Migrations must only be applied by CI (prisma migrate reset is forbidden locally)',
  ])
})

test('LUM-770: the compiler version is part of the source hash so an unchanged CLAUDE.md recompiles once', async () => {
  const { createHash } = await import('crypto')
  // The stored row was compiled by the pre-LUM-770 compiler: keyed on the bare
  // sha256 of the source, carrying the bad tsc rule.
  // readSource concatenates CLAUDE.md + AGENTS.md (absent → '') with '\n\n'.
  ;(contents.readRepoFile as jest.Mock).mockImplementation(
    async (input: { path: string }) =>
      input.path === 'CLAUDE.md' ? CHECKLIST_MD : null
  )
  const plainHash = createHash('sha256')
    .update([CHECKLIST_MD, ''].join('\n\n'))
    .digest('hex')
  policyStore.set('p770c', {
    sourceHash: plainHash,
    rules: [
      {
        id: 'stale-tsc',
        text: 'Before opening a PR: tests + `npx tsc --noEmit` pass',
        kind: 'action',
        tier: 'deterministic',
        predicate: { type: 'cmd-substr', value: 'tsc --noEmit' },
        severity: 'MEDIUM',
        blocking: false,
      },
    ],
  })
  ;(client.classifyRules as jest.Mock).mockResolvedValue({
    rules: [
      {
        text: 'Before opening a PR: tests + `npx tsc --noEmit` pass',
        kind: 'action',
        tier: 'semantic',
        assertion: 'tsc and tests pass before a PR',
        severity: 'MEDIUM',
        blocking: false,
        polarity: 'require',
      },
    ],
  })

  const first = await policyCompilerService.ensureCompiled({
    projectId: 'p770c',
    workspaceId: 'w1',
    fullName: 'o/r',
  })
  // Recompiled despite the unchanged source — the stale rule is gone.
  expect(client.classifyRules).toHaveBeenCalledTimes(1)
  expect(first!.sourceHash).not.toBe(plainHash)
  expect(first!.rules.map(r => r.tier)).toEqual(['semantic'])

  // …and only once: the second call hits the new key.
  ;(client.classifyRules as jest.Mock).mockClear()
  const second = await policyCompilerService.ensureCompiled({
    projectId: 'p770c',
    workspaceId: 'w1',
    fullName: 'o/r',
  })
  expect(client.classifyRules).not.toHaveBeenCalled()
  expect(second!.sourceHash).toBe(first!.sourceHash)
})

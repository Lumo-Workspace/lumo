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
      // The text really is gone from the file — a person deleted it. This is
      // the only shape that blocks a DONE, and it must keep blocking: the fix
      // for the false positives must not quietly disarm the true positive.
      advisory: false,
      severity: 'HIGH',
      // LUM-630: a committed CLAUDE.md edit is repo state — reversible, and
      // the create site must say so explicitly (no repository default).
      reversible: true,
    })
  )
})

test('a same-text reclassification is the COMPILER changing its mind, not a person weakening the policy', async () => {
  // The id IS sha256(text), so an identical id means identical text means
  // nobody edited that rule. Reporting it as a HIGH, DONE-blocking "policy
  // weakening" was how LUM-770's own safety net — which deliberately downgrades
  // an obligation carrying a cmd-substr predicate — came to report ITSELF as an
  // attack on the policy, four times in a day, against an untouched CLAUDE.md.
  // Still recorded: a classifier that quietly stops treating a Forbidden line
  // as deterministic does leave the project less protected. But advisory, and
  // attributed to the compiler.
  const createSpy = jest
    .spyOn(boundaryCrossingRepository, 'create')
    .mockResolvedValue(undefined as never)

  const ruleText = 'Never delete files in prisma/migrations/'
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
  ;(contents.readRepoFile as jest.Mock).mockResolvedValue(
    `## Forbidden\n- ${ruleText}`
  )
  ;(client.classifyRules as jest.Mock).mockResolvedValue({
    rules: [
      {
        text: ruleText,
        kind: 'action',
        tier: 'semantic',
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

  expect(createSpy).toHaveBeenCalledTimes(1)
  const arg = createSpy.mock.calls[0]?.[0] as {
    detail: string
    advisory: boolean
    severity: string
    policyRuleRef: string
  }
  expect(arg.policyRuleRef).toBe(expectedRuleId)
  // Does not block anyone's DONE, and does not read as a human action.
  expect(arg.advisory).toBe(true)
  expect(arg.severity).toBe('MEDIUM')
  expect(arg.detail).toContain('UNCHANGED')
  expect(arg.detail).not.toMatch(/removed from/)
})

test('a rule the compiler simply stopped emitting is not a removal while its text is still in the file', async () => {
  // The other half of the same defect: rule identity is sha256 of LLM-extracted
  // text, so a classifier that paraphrases by one character mints a new id and
  // the old one reads as "removed" — from a file nobody touched.
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
  // The line is STILL THERE — the classifier just phrased it differently.
  ;(contents.readRepoFile as jest.Mock).mockResolvedValue(
    '## Forbidden\n- Never push to main'
  )
  ;(client.classifyRules as jest.Mock).mockResolvedValue({
    rules: [
      {
        text: 'Never push directly to main',
        kind: 'action',
        tier: 'deterministic',
        mappedCategory: 'PUSH_TO_PROTECTED_BRANCH',
        severity: 'MEDIUM',
      },
    ],
  })

  await policyCompilerService.ensureCompiled({
    projectId: 'p5',
    workspaceId: 'w1',
    fullName: 'o/r',
    taskId: 't3',
  })

  expect(createSpy).toHaveBeenCalledTimes(1)
  const arg = createSpy.mock.calls[0]?.[0] as {
    advisory: boolean
    severity: string
  }
  expect(arg.advisory).toBe(true)
  expect(arg.severity).toBe('MEDIUM')
})

test('markdown emphasis and code spans do not make a present rule look removed', async () => {
  // The production shape. CLAUDE.md writes the rule inside a long bullet with
  // bold markers and code spans; the classifier hands back the stripped text.
  // A raw `source.includes(rule.text)` is false for every such rule, which
  // would turn this fix into the very false positive it removes.
  const createSpy = jest
    .spyOn(boundaryCrossingRepository, 'create')
    .mockResolvedValue(undefined as never)

  const stripped =
    'Never prisma migrate reset or direct-UPDATE _prisma_migrations without explicit user approval'

  jest.spyOn(projectPolicyRepository, 'latestForProject').mockResolvedValue({
    sourceHash: 'old',
    rules: [
      {
        id: 'r9',
        text: stripped,
        kind: 'action',
        tier: 'deterministic',
        mappedCategory: 'MIGRATION_FILE_DELETED',
        severity: 'HIGH',
        blocking: true,
      },
    ],
  })
  ;(contents.readRepoFile as jest.Mock).mockResolvedValue(
    '- **Dev**: schema changes are applied locally. **NEVER** `prisma migrate reset`\n  or Direct-Update `_prisma_migrations` without Explicit User Approval.'
  )
  ;(client.classifyRules as jest.Mock).mockResolvedValue({ rules: [] })

  await policyCompilerService.ensureCompiled({
    projectId: 'p6',
    workspaceId: 'w1',
    fullName: 'o/r',
    taskId: 't4',
  })

  expect(createSpy).toHaveBeenCalledTimes(1)
  const arg = createSpy.mock.calls[0]?.[0] as { advisory: boolean }
  expect(arg.advisory).toBe(true)
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
  // LUM-772: the push prohibition is judged on the push destination now
  // (`push-target`), the other three keep their cmd-substr predicates.
  expect(policy!.rules.map(r => r.predicate?.type)).toEqual([
    'push-target',
    'cmd-substr',
    'cmd-substr',
    'cmd-substr',
  ])
  const refs = (command: string) =>
    detectProjectActionCrossings(bashEvent(command), policy!.rules).map(
      c => c.policyRuleText
    )
  expect(refs('git push origin main')).toEqual(['Never push to main'])
  expect(refs('git push origin feature/x')).toEqual([])
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

// ── LUM-772: push prohibitions are judged on the push destination ────────────
//
// GLM compiled "Never push to main or develop directly" (mapped to the
// built-in PUSH_TO_PROTECTED_BRANCH) with a `cmd-substr: "git push"`
// predicate — target-blind, so every feature-branch push was a HIGH
// PROJECT_RULE_VIOLATION (LUM-771: three in one session). Test names below are
// literal MACHINE checkpointers — do not rename.

const LUM_772_FEATURE_PUSH =
  'git push -u origin lumo/LUM-771-crossing-fixes 2>&1 | tail -3'
const LUM_772_PUSH_AND_PR =
  'git push -q origin lumo/LUM-771-cli-bump && gh pr create --base main --head lumo/LUM-771-cli-bump --title "chore: bump cli [LUM-771]" --body "x"'

test('LUM-772 compiler rewrites push rules to target-aware predicates', async () => {
  ;(contents.readRepoFile as jest.Mock).mockResolvedValue(
    '## Forbidden\n- Never push to main or develop directly\n- Never push directly to main or release\n- Never push to main, develop or release\n- Never force-push (git push --force)\n- Never push to main\n'
  )
  ;(client.classifyRules as jest.Mock).mockResolvedValue({
    rules: [
      // 1. The prod rule exactly as compiled: mapped + target-blind substring
      //    → deduped onto the built-in (no predicate), still deterministic +
      //    blocking so no POLICY_WEAKENING is ever emitted for it.
      {
        text: 'Never push to main or develop directly',
        kind: 'action',
        tier: 'deterministic',
        mappedCategory: 'PUSH_TO_PROTECTED_BRANCH',
        predicate: { type: 'cmd-substr', value: 'git push' },
        severity: 'HIGH',
        blocking: true,
        polarity: 'forbid',
      },
      // 2. Unmapped, names a branch the built-in does not guard → push-target
      //    over exactly the named branches (advisory project rule).
      {
        text: 'Never push directly to main or release',
        kind: 'action',
        tier: 'deterministic',
        predicate: { type: 'cmd-substr', value: 'git push' },
        severity: 'HIGH',
        blocking: false,
      },
      // 3. Mapped but names an extra branch → the built-in does not cover it,
      //    so the push-target predicate is kept alongside the mapping.
      {
        text: 'Never push to main, develop or release',
        kind: 'action',
        tier: 'deterministic',
        mappedCategory: 'PUSH_TO_PROTECTED_BRANCH',
        predicate: { type: 'cmd-substr', value: 'git push origin main' },
        severity: 'HIGH',
        blocking: true,
      },
      // 4. A push rule that names no branch is not a push-TARGET rule: its own
      //    predicate is left alone.
      {
        text: 'Never force-push (git push --force)',
        kind: 'action',
        tier: 'deterministic',
        predicate: { type: 'cmd-substr', value: '--force' },
        severity: 'MEDIUM',
        blocking: false,
        polarity: 'forbid',
      },
      // 5. Mapped with no predicate at all: unchanged (the built-in covers it).
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
  const policy = await policyCompilerService.ensureCompiled({
    projectId: 'p772',
    workspaceId: 'w1',
    fullName: 'o/r',
  })
  const [prod, unmapped, mappedExtra, force, mappedBare] = policy!.rules
  expect(prod).toMatchObject({
    tier: 'deterministic',
    blocking: true,
    mappedCategory: 'PUSH_TO_PROTECTED_BRANCH',
  })
  expect(prod!.predicate).toBeUndefined()
  expect(unmapped).toMatchObject({
    tier: 'deterministic',
    blocking: false,
    predicate: { type: 'push-target', value: 'main,release' },
  })
  expect(mappedExtra).toMatchObject({
    tier: 'deterministic',
    blocking: true,
    predicate: { type: 'push-target', value: 'main,develop,release' },
  })
  expect(force!.predicate).toEqual({ type: 'cmd-substr', value: '--force' })
  expect(mappedBare!.predicate).toBeUndefined()
  expect(mappedBare!.tier).toBe('deterministic')
  // No rule in the set is target-blind any more.
  expect(
    policy!.rules.some(
      r => r.predicate?.type === 'cmd-substr' && /push/.test(r.predicate.value)
    )
  ).toBe(false)

  const refs = (command: string) =>
    detectProjectActionCrossings(bashEvent(command), policy!.rules).map(
      r => r.policyRuleText
    )
  // The LUM-771 false positives raise nothing under any of the rules.
  expect(refs(LUM_772_FEATURE_PUSH)).toEqual([])
  expect(refs(LUM_772_PUSH_AND_PR)).toEqual([])
  expect(
    refs(
      'lumo crossing explain abc --note "the command was git push -q origin lumo/x + gh pr create --base main"'
    )
  ).toEqual([])
  // Real protected pushes still cite the rules that carry a predicate (the
  // deduped prod rule is the built-in detector's job, not a project rule).
  expect(refs('git push origin main')).toEqual([
    'Never push directly to main or release',
    'Never push to main, develop or release',
  ])
  expect(refs('git push -f origin feature:develop')).toEqual([
    'Never push to main, develop or release',
  ])
  expect(refs('git push origin HEAD:release')).toEqual([
    'Never push directly to main or release',
    'Never push to main, develop or release',
  ])
  expect(refs('git push --force origin feat')).toEqual([
    'Never force-push (git push --force)',
  ])
})

test('LUM-772: a policy stored by the pre-772 compiler recompiles once via the version hash', async () => {
  const { createHash } = await import('crypto')
  const source = '## Forbidden\n- Never push to main or develop directly'
  ;(contents.readRepoFile as jest.Mock).mockImplementation(
    async (input: { path: string }) =>
      input.path === 'CLAUDE.md' ? source : null
  )
  const staleHash = createHash('sha256')
    .update([source, ''].join('\n\n'))
    .update('\n compiler:lum770')
    .digest('hex')
  policyStore.set('p772b', {
    sourceHash: staleHash,
    rules: [
      {
        id: 'b7cb287dd363426e',
        text: 'Never push to main or develop directly',
        kind: 'action',
        tier: 'deterministic',
        mappedCategory: 'PUSH_TO_PROTECTED_BRANCH',
        predicate: { type: 'cmd-substr', value: 'git push' },
        severity: 'HIGH',
        blocking: true,
      },
    ],
  })
  ;(client.classifyRules as jest.Mock).mockResolvedValue({
    rules: [
      {
        text: 'Never push to main or develop directly',
        kind: 'action',
        tier: 'deterministic',
        mappedCategory: 'PUSH_TO_PROTECTED_BRANCH',
        predicate: { type: 'cmd-substr', value: 'git push' },
        severity: 'HIGH',
        blocking: true,
      },
    ],
  })

  const first = await policyCompilerService.ensureCompiled({
    projectId: 'p772b',
    workspaceId: 'w1',
    fullName: 'o/r',
    taskId: 't1',
  })
  expect(client.classifyRules).toHaveBeenCalledTimes(1)
  expect(first!.sourceHash).not.toBe(staleHash)
  expect(first!.rules[0]!.predicate).toBeUndefined()
  // Same id, still deterministic + blocking → no POLICY_WEAKENING crossing.
  expect(first!.rules[0]!.id).toBe('b7cb287dd363426e')
  expect(boundaryCrossingRepository.create).not.toHaveBeenCalled()
  ;(client.classifyRules as jest.Mock).mockClear()
  const second = await policyCompilerService.ensureCompiled({
    projectId: 'p772b',
    workspaceId: 'w1',
    fullName: 'o/r',
  })
  expect(client.classifyRules).not.toHaveBeenCalled()
  expect(second!.sourceHash).toBe(first!.sourceHash)
})

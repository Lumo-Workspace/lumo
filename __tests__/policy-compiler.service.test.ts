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
  __resetInflight,
} from '@/lib/services/policy/policy-compiler.service'
import * as contents from '@/lib/integrations/github/contents'
import * as client from '@/lib/llm/policy-compiler-client'
import { projectPolicyRepository } from '@/lib/repositories/project-policy.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'

// ── Module-level mocks ────────────────────────────────────────────────────────

// Mock github/auth first to prevent @octokit/auth-app ESM parse error.
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('test-token'),
}))
jest.mock('@/lib/integrations/github/contents')
// LUM-780: the compile triggers a POLICY_WEAKENING re-judge on the project —
// mocked so the trigger is asserted, not the re-judge itself.
const rejudgeForProject = jest.fn(async (_i: unknown) => ({ judged: 0 }))
jest.mock('@/lib/services/boundary-crossing-rejudge.service', () => ({
  boundaryCrossingRejudgeService: {
    rejudgePolicyWeakeningForProject: (i: unknown) => rejudgeForProject(i),
  },
}))
jest.mock('@/lib/llm/policy-compiler-client')

// Stateful mock store for projectPolicyRepository.
// LUM-774: the store is a list of rows keyed by (projectId, sourceHash), with a
// monotonic compiledAt — so `latestForProject` is a REAL newest-row lookup,
// `findByHash` a REAL unique-key lookup, `createIfAbsent` REALLY refuses a
// second row for the same key, and `activateIfUnchanged` is a REAL
// compare-and-swap on compiledAt. That is what makes the cache-hit, the
// single-flight and the lost-race tests non-vacuous (trap 3 from the task
// brief): every assertion is against what the mock actually stored.
type StoredPolicy = {
  id: string
  projectId: string
  sourceHash: string
  rules: import('@/lib/services/policy/types').PolicyRule[]
  compiledAt: Date
}
const policyStore: StoredPolicy[] = []
let policySeq = 0
const POLICY_EPOCH = 1_700_000_000_000

const policyView = (r: StoredPolicy) => ({
  id: r.id,
  sourceHash: r.sourceHash,
  rules: r.rules,
  compiledAt: r.compiledAt,
})
const latestRowOf = (projectId: string): StoredPolicy | null =>
  policyStore
    .filter(r => r.projectId === projectId)
    .sort((a, b) => b.compiledAt.getTime() - a.compiledAt.getTime())[0] ?? null
const rowByHash = (projectId: string, sourceHash: string) =>
  policyStore.find(
    r => r.projectId === projectId && r.sourceHash === sourceHash
  ) ?? null
/** Rows stored for a project — what the "only one row lands" assertions read. */
const rowsFor = (projectId: string) =>
  policyStore.filter(r => r.projectId === projectId)

function installPolicyRepositoryMock() {
  ;(projectPolicyRepository.latestForProject as jest.Mock).mockImplementation(
    async (projectId: string) => {
      const r = latestRowOf(projectId)
      return r ? policyView(r) : null
    }
  )
  ;(projectPolicyRepository.findByHash as jest.Mock).mockImplementation(
    async (projectId: string, sourceHash: string) => {
      const r = rowByHash(projectId, sourceHash)
      return r ? policyView(r) : null
    }
  )
  ;(projectPolicyRepository.createIfAbsent as jest.Mock).mockImplementation(
    async (input: {
      projectId: string
      sourceHash: string
      rules: import('@/lib/services/policy/types').PolicyRule[]
    }) => {
      if (rowByHash(input.projectId, input.sourceHash)) return false
      policyStore.push({
        id: `row-${policySeq}`,
        projectId: input.projectId,
        sourceHash: input.sourceHash,
        rules: input.rules,
        compiledAt: new Date(POLICY_EPOCH + policySeq * 1000),
      })
      policySeq++
      return true
    }
  )
  ;(
    projectPolicyRepository.activateIfUnchanged as jest.Mock
  ).mockImplementation(async (id: string, seenCompiledAt: Date, now: Date) => {
    const r = policyStore.find(row => row.id === id)
    if (!r || r.compiledAt.getTime() !== seenCompiledAt.getTime()) return false
    r.compiledAt = now
    return true
  })
}

jest.mock('@/lib/repositories/project-policy.repository', () => ({
  projectPolicyRepository: {
    latestForProject: jest.fn(),
    findByHash: jest.fn(),
    createIfAbsent: jest.fn(),
    activateIfUnchanged: jest.fn(),
  },
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FORBIDDEN_MD =
  '## Forbidden\n- Never push to main\n- Use named exports\n- Never touch legacy/**'

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  policyStore.length = 0
  policySeq = 0
  __resetSourceCache()
  __resetInflight()
  jest.clearAllMocks()
  // Re-install stateful implementations after clearAllMocks resets them.
  installPolicyRepositoryMock()
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

  seedPolicy('p3', 'old', [
    {
      id: 'r1',
      text: 'Never push to main',
      kind: 'action',
      tier: 'deterministic',
      mappedCategory: 'PUSH_TO_PROTECTED_BRANCH',
      severity: 'MEDIUM',
      blocking: true,
    },
  ])
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

  seedPolicy('p4', 'old-hash', [
    {
      id: expectedRuleId,
      text: ruleText,
      kind: 'action',
      tier: 'deterministic',
      mappedCategory: 'MIGRATION_FILE_DELETED',
      severity: 'HIGH',
      blocking: true,
    },
  ])
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

  seedPolicy('p5', 'old', [
    {
      id: 'r1',
      text: 'Never push to main',
      kind: 'action',
      tier: 'deterministic',
      mappedCategory: 'PUSH_TO_PROTECTED_BRANCH',
      severity: 'MEDIUM',
      blocking: true,
    },
  ])
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

  seedPolicy('p6', 'old', [
    {
      id: 'r9',
      text: stripped,
      kind: 'action',
      tier: 'deterministic',
      mappedCategory: 'MIGRATION_FILE_DELETED',
      severity: 'HIGH',
      blocking: true,
    },
  ])
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
  seedPolicy('p770c', plainHash, [
    {
      id: 'stale-tsc',
      text: 'Before opening a PR: tests + `npx tsc --noEmit` pass',
      kind: 'action',
      tier: 'deterministic',
      predicate: { type: 'cmd-substr', value: 'tsc --noEmit' },
      severity: 'MEDIUM',
      blocking: false,
    },
  ])
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
    .update('\n\u0000compiler:lum770')
    .digest('hex')
  seedPolicy('p772b', staleHash, [
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
  ])
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

// ── LUM-774: recompiles are single-flight per (projectId, sourceHash) ─────────
//
// Prod, 2026-09-14: LUM-772 bumped COMPILER_VERSION and parallel Claude Code
// sessions' PostToolUse hooks (every event calls ensureCompiled) recompiled the
// same unchanged CLAUDE.md three times in 41 s — three project_policies rows
// with an identical sourceHash (14 / 28 / 23 rules, model nondeterminism), and
// three POLICY_WEAKENING crossings each diffing against the same pre-bump row.
// Test names below are literal MACHINE checkpointers — do not rename.

/** A push prohibition the pre-bump policy carried as deterministic+blocking. */
const PRE_BUMP_PUSH_RULE = {
  id: 'r-push',
  text: 'Never push to main',
  kind: 'action' as const,
  tier: 'deterministic' as const,
  mappedCategory: 'PUSH_TO_PROTECTED_BRANCH',
  severity: 'MEDIUM' as const,
  blocking: true,
}

/** What the classifier returns once the push line is gone from the file. */
const NAMED_EXPORTS_ONLY = {
  rules: [
    {
      text: 'Use named exports',
      kind: 'code',
      tier: 'semantic',
      assertion: 'use named exports',
      severity: 'LOW',
      blocking: false,
    },
  ],
}

/** Seed a stored policy row so the next compile has a `prev` to diff against. */
function seedPolicy(
  projectId: string,
  sourceHash: string,
  rules: import('@/lib/services/policy/types').PolicyRule[]
) {
  policyStore.push({
    id: `seed-${policySeq}`,
    projectId,
    sourceHash,
    rules,
    compiledAt: new Date(POLICY_EPOCH + policySeq * 1000),
  })
  policySeq++
}

/** A promise the test resolves by hand — parks a call inside the model step. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

/** Let every pending microtask / immediate settle. */
const settle = () => new Promise<void>(r => setImmediate(r))

test('LUM-774: concurrent ensureCompiled calls for the same (projectId, sourceHash) persist one row and emit POLICY_WEAKENING once', async () => {
  const createSpy = jest
    .spyOn(boundaryCrossingRepository, 'create')
    .mockResolvedValue(undefined as never)
  seedPolicy('p774a', 'pre-bump', [PRE_BUMP_PUSH_RULE])
  ;(contents.readRepoFile as jest.Mock).mockResolvedValue(
    '## Forbidden\n- Use named exports'
  )
  // Park every caller inside the model call so they overlap for real.
  const model = deferred<typeof NAMED_EXPORTS_ONLY>()
  ;(client.classifyRules as jest.Mock).mockReturnValue(model.promise)

  const input = {
    projectId: 'p774a',
    workspaceId: 'w1',
    fullName: 'o/r',
    taskId: 't1',
  }
  const calls = [
    policyCompilerService.ensureCompiled(input),
    policyCompilerService.ensureCompiled(input),
    policyCompilerService.ensureCompiled(input),
  ]
  await settle()
  model.resolve(NAMED_EXPORTS_ONLY)
  const results = await Promise.all(calls)

  // One model call, one insert, one row for the new hash.
  expect(client.classifyRules).toHaveBeenCalledTimes(1)
  expect(projectPolicyRepository.createIfAbsent).toHaveBeenCalledTimes(1)
  const newRows = rowsFor('p774a').filter(r => r.sourceHash !== 'pre-bump')
  expect(newRows).toHaveLength(1)
  // The push line really left the file → one HIGH, blocking weakening — not
  // one per caller.
  expect(createSpy).toHaveBeenCalledTimes(1)
  expect(createSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      category: 'POLICY_WEAKENING',
      policyRuleRef: 'r-push',
      advisory: false,
      severity: 'HIGH',
    })
  )
  // Every caller got the same policy back.
  for (const r of results) {
    expect(r!.sourceHash).toBe(newRows[0]!.sourceHash)
    expect(r!.rules).toEqual(newRows[0]!.rules)
  }
})

test('LUM-774: a compile that loses the insert race to another instance reuses the winner row and emits no weakening', async () => {
  // The in-process promise map only covers one serverless instance. Across
  // instances the guarantee is the (projectId, sourceHash) unique key: the
  // second insert is refused, and the loser must serve the winner's rules —
  // not its own (different) model output — and must not diff against `prev`
  // a second time.
  const createSpy = jest
    .spyOn(boundaryCrossingRepository, 'create')
    .mockResolvedValue(undefined as never)
  seedPolicy('p774b', 'pre-bump', [PRE_BUMP_PUSH_RULE])
  ;(contents.readRepoFile as jest.Mock).mockResolvedValue(
    '## Forbidden\n- Use named exports'
  )
  const winnerModel = deferred<typeof NAMED_EXPORTS_ONLY>()
  const loserModel = deferred<{ rules: unknown[] }>()
  ;(client.classifyRules as jest.Mock)
    .mockReturnValueOnce(winnerModel.promise)
    .mockReturnValueOnce(loserModel.promise)

  const winner = policyCompilerService.ensureCompiled({
    projectId: 'p774b',
    workspaceId: 'w1',
    fullName: 'o/r',
    taskId: 't-winner',
  })
  await settle() // parked in the model call, `prev` already read
  __resetInflight() // ← a second instance: no shared promise map
  const loser = policyCompilerService.ensureCompiled({
    projectId: 'p774b',
    workspaceId: 'w1',
    fullName: 'o/r',
    taskId: 't-loser',
  })
  await settle()
  expect(client.classifyRules).toHaveBeenCalledTimes(2)

  winnerModel.resolve(NAMED_EXPORTS_ONLY)
  const winnerResult = await winner
  // The loser's model run came back with a DIFFERENT rule set (nondeterminism).
  loserModel.resolve({
    rules: [
      ...NAMED_EXPORTS_ONLY.rules,
      {
        text: 'Use async/await, not .then()',
        kind: 'code',
        tier: 'semantic',
        assertion: 'async/await',
        severity: 'LOW',
        blocking: false,
      },
    ],
  })
  const loserResult = await loser

  // Both tried to persist; exactly one row exists for the hash.
  expect(projectPolicyRepository.createIfAbsent).toHaveBeenCalledTimes(2)
  expect(
    rowsFor('p774b').filter(r => r.sourceHash !== 'pre-bump')
  ).toHaveLength(1)
  // The loser serves the winner's row, not its own output.
  expect(loserResult!.rules).toEqual(winnerResult!.rules)
  expect(loserResult!.rules).toHaveLength(1)
  // One weakening, attributed to the compile that actually persisted.
  expect(createSpy).toHaveBeenCalledTimes(1)
  expect(createSpy).toHaveBeenCalledWith(
    expect.objectContaining({ taskId: 't-winner', policyRuleRef: 'r-push' })
  )
})

test('LUM-774: reverting the source to a previously compiled hash re-activates that row without a model call and emits weakening once', async () => {
  // With a unique key the revert A → B → A cannot insert a second A row. The
  // stored A row is re-activated instead (compare-and-swap on compiledAt, so
  // two concurrent reverters diff B → A exactly once) and no model call is
  // spent on a policy that is already known.
  const createSpy = jest
    .spyOn(boundaryCrossingRepository, 'create')
    .mockResolvedValue(undefined as never)
  const SOURCE_A = '## Forbidden\n- Use named exports'
  const SOURCE_B = '## Forbidden\n- Never push to main\n- Use named exports'
  const base = { projectId: 'p774c', workspaceId: 'w1', fullName: 'o/r' }

  // A: compiled once.
  ;(contents.readRepoFile as jest.Mock).mockResolvedValue(SOURCE_A)
  ;(client.classifyRules as jest.Mock).mockResolvedValueOnce(NAMED_EXPORTS_ONLY)
  const a = await policyCompilerService.ensureCompiled(base)
  // B: the push rule is added and compiled — now the latest row.
  __resetSourceCache()
  ;(contents.readRepoFile as jest.Mock).mockResolvedValue(SOURCE_B)
  ;(client.classifyRules as jest.Mock).mockResolvedValueOnce({
    rules: [
      {
        text: 'Never push to main',
        kind: 'action',
        tier: 'deterministic',
        mappedCategory: 'PUSH_TO_PROTECTED_BRANCH',
        severity: 'MEDIUM',
        blocking: true,
      },
      ...NAMED_EXPORTS_ONLY.rules,
    ],
  })
  const b = await policyCompilerService.ensureCompiled(base)
  expect(b!.rules).toHaveLength(2)
  expect(rowsFor('p774c')).toHaveLength(2)
  ;(client.classifyRules as jest.Mock).mockClear()
  createSpy.mockClear()

  // Revert to A, from two sessions at once.
  __resetSourceCache()
  ;(contents.readRepoFile as jest.Mock).mockResolvedValue(SOURCE_A)
  const [r1, r2] = await Promise.all([
    policyCompilerService.ensureCompiled({ ...base, taskId: 't1' }),
    policyCompilerService.ensureCompiled({ ...base, taskId: 't2' }),
  ])

  expect(client.classifyRules).not.toHaveBeenCalled()
  expect(rowsFor('p774c')).toHaveLength(2) // still two rows, no third
  expect(r1!.sourceHash).toBe(a!.sourceHash)
  expect(r2!.rules).toEqual(a!.rules)
  // B → A removed the push line for real → exactly one HIGH weakening.
  expect(createSpy).toHaveBeenCalledTimes(1)
  expect(createSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      category: 'POLICY_WEAKENING',
      advisory: false,
      severity: 'HIGH',
    })
  )
  // A is the active (newest) row again, so the next event is a plain cache hit.
  const latest = await projectPolicyRepository.latestForProject('p774c')
  expect(latest!.sourceHash).toBe(a!.sourceHash)
  const again = await policyCompilerService.ensureCompiled(base)
  expect(again!.rules).toEqual(a!.rules)
  expect(client.classifyRules).not.toHaveBeenCalled()
})

// ── LUM-780: re-judge trigger ────────────────────────────────────────────────

describe("LUM-780: a policy change re-judges the project's POLICY_WEAKENING rows", () => {
  const RULE = {
    text: 'Never push to main',
    kind: 'action' as const,
    tier: 'deterministic' as const,
    mappedCategory: 'PUSH_TO_PROTECTED_BRANCH',
    severity: 'MEDIUM' as const,
    blocking: true,
  }
  const base = { projectId: 'p780', workspaceId: 'w1', fullName: 'o/r' }

  it('fires after a fresh compile with the source just read, and not on a cache hit', async () => {
    ;(contents.readRepoFile as jest.Mock).mockResolvedValue(FORBIDDEN_MD)
    ;(client.classifyRules as jest.Mock).mockResolvedValue({ rules: [RULE] })
    await policyCompilerService.ensureCompiled(base)
    expect(rejudgeForProject).toHaveBeenCalledTimes(1)
    expect(rejudgeForProject).toHaveBeenCalledWith({
      projectId: 'p780',
      source: expect.stringContaining('Never push to main'),
    })
    rejudgeForProject.mockClear()
    await policyCompilerService.ensureCompiled(base) // same hash — cache hit
    expect(rejudgeForProject).not.toHaveBeenCalled()
  })

  it('fires on a re-activation (revert to an earlier source)', async () => {
    ;(contents.readRepoFile as jest.Mock).mockResolvedValue(FORBIDDEN_MD)
    ;(client.classifyRules as jest.Mock).mockResolvedValue({ rules: [RULE] })
    await policyCompilerService.ensureCompiled(base) // A
    __resetSourceCache()
    ;(contents.readRepoFile as jest.Mock).mockResolvedValue(
      FORBIDDEN_MD + '\n- extra'
    )
    await policyCompilerService.ensureCompiled(base) // B
    rejudgeForProject.mockClear()
    __resetSourceCache()
    ;(contents.readRepoFile as jest.Mock).mockResolvedValue(FORBIDDEN_MD)
    await policyCompilerService.ensureCompiled(base) // back to A: reactivate, no model call
    expect(rejudgeForProject).toHaveBeenCalledTimes(1)
    // The source handed over is the reverted one (CLAUDE.md + AGENTS.md
    // concatenated by the reader), not the superseded B.
    const arg = rejudgeForProject.mock.calls[0]?.[0] as { source: string }
    expect(arg.source).toContain('Never push to main')
    expect(arg.source).not.toContain('- extra')
  })

  it('a failing re-judge never fails the compile', async () => {
    ;(contents.readRepoFile as jest.Mock).mockResolvedValue(FORBIDDEN_MD)
    ;(client.classifyRules as jest.Mock).mockResolvedValue({ rules: [RULE] })
    rejudgeForProject.mockRejectedValueOnce(new Error('db down'))
    const policy = await policyCompilerService.ensureCompiled(base)
    expect(policy!.rules).toHaveLength(1)
  })

  it('stamps the rule text on an emitted POLICY_WEAKENING so a later re-judge never has to recover it', async () => {
    ;(contents.readRepoFile as jest.Mock).mockResolvedValue(FORBIDDEN_MD)
    ;(client.classifyRules as jest.Mock).mockResolvedValue({ rules: [RULE] })
    await policyCompilerService.ensureCompiled({ ...base, taskId: 't1' })
    __resetSourceCache()
    ;(contents.readRepoFile as jest.Mock).mockResolvedValue(
      '## Forbidden\n- Use named exports'
    )
    ;(client.classifyRules as jest.Mock).mockResolvedValue({ rules: [] })
    const createSpy = jest
      .spyOn(boundaryCrossingRepository, 'create')
      .mockResolvedValue({} as never)
    await policyCompilerService.ensureCompiled({ ...base, taskId: 't1' })
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'POLICY_WEAKENING',
        policyRuleRef: expect.any(String),
        policyRuleText: 'Never push to main',
      })
    )
  })
})

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
import { policyCompilerService } from '@/lib/services/policy/policy-compiler.service'
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
    })
  )
})

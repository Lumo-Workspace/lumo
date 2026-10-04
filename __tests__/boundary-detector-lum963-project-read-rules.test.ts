/**
 * @jest-environment node
 *
 * LUM-963 multi-tenant: a project's own sensitive-read paths. The policy
 * compiler maps "never read X" in the customer's CLAUDE.md / AGENTS.md to a
 * deterministic path-glob rule with mappedCategory SENSITIVE_PATH_READ; the
 * detector ADDS those paths to the built-in credential stores (never replaces
 * them) and records each hit LOW + advisory with the rule's ref and text.
 * Only string samples — nothing reads a real file.
 */
import {
  detectCrossings,
  detectProjectSensitiveReadCrossings,
  sensitiveReadRulesFromRules,
  boundaryDetectorService,
} from '@/lib/services/boundary-detector.service'
import {
  matchesReadGlob,
  detectProjectSensitiveReads,
} from '@/lib/boundary-crossing/sensitive-read'
import {
  compileRuleSet,
  COMPILER_VERSION,
} from '@/lib/services/policy/policy-compiler.service'
import type { PolicyRule } from '@/lib/services/policy/types'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'

const mockEnsureCompiled = jest.fn()
jest.mock('@/lib/services/policy/policy-compiler.service', () => {
  const actual = jest.requireActual(
    '@/lib/services/policy/policy-compiler.service'
  )
  return {
    ...actual,
    policyCompilerService: {
      ensureCompiled: (...a: unknown[]) => mockEnsureCompiled(...a),
    },
  }
})
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    create: jest.fn().mockResolvedValue({ id: 'bc-1' }),
    coalesceRecurrence: jest.fn().mockResolvedValue(0),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    isTrashed: jest.fn().mockResolvedValue(false),
    findWithProjectWorkspaceId: jest.fn().mockResolvedValue({
      projectId: 'p-1',
      project: { workspaceId: 'w-1' },
    }),
  },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findDefaultRepository: jest
      .fn()
      .mockResolvedValue({ fullName: 'acme/app' }),
  },
}))
jest.mock('@/lib/repositories/crossing-suppression-rule.repository', () => ({
  crossingSuppressionRuleRepository: {
    findActiveForProject: jest.fn().mockResolvedValue([]),
  },
}))

const createCrossing = boundaryCrossingRepository.create as jest.Mock

const readRule = (
  glob: string,
  over: Partial<PolicyRule> = {}
): PolicyRule => ({
  id: `r-${glob}`,
  text: `Never read ${glob}`,
  kind: 'action',
  tier: 'deterministic',
  mappedCategory: 'SENSITIVE_PATH_READ',
  predicate: { type: 'path-glob', value: glob },
  severity: 'MEDIUM',
  blocking: false,
  ...over,
})
const readEvent = (file_path: string) => ({
  toolName: 'Read',
  filePath: file_path,
  payload: { tool_input: { file_path } },
})
const bashEvent = (command: string) => ({
  toolName: 'Bash',
  filePath: null,
  payload: { tool_input: { command } },
})

beforeEach(() => {
  jest.clearAllMocks()
  mockEnsureCompiled.mockResolvedValue({ sourceHash: 'h', rules: [] })
})

describe('matchesReadGlob', () => {
  it('matches absolute, ~ and relative globs against every spelling of the path', () => {
    expect(
      matchesReadGlob('/opt/configs/*.json', '/opt/configs/api_tokens.json')
    ).toBe(true)
    expect(
      matchesReadGlob('~/.config/acme/**', '/Users/dev/.config/acme/a/token')
    ).toBe(true)
    expect(
      matchesReadGlob('~/.config/acme/**', '/home/ci/.config/acme/token')
    ).toBe(true)
    // relative glob = any depth
    expect(
      matchesReadGlob('secrets/*.pem', '/srv/app/secrets/server.pem')
    ).toBe(true)
    expect(
      matchesReadGlob('/opt/configs/*.json', '/opt/configs/sub/x.json')
    ).toBe(false)
    expect(matchesReadGlob('/opt/configs/*.json', '/opt/other/x.json')).toBe(
      false
    )
  })
})

describe('sensitiveReadRulesFromRules', () => {
  it('keeps only deterministic path-glob rules mapped to SENSITIVE_PATH_READ', () => {
    const rules: PolicyRule[] = [
      readRule('/opt/configs/*.json'),
      readRule('  '),
      readRule('/x', { tier: 'semantic' }),
      readRule('/y', { mappedCategory: 'SENSITIVE_PATH_EDIT' }),
      readRule('/z', { predicate: { type: 'cmd-substr', value: 'cat /z' } }),
    ]
    expect(sensitiveReadRulesFromRules(rules)).toEqual([
      {
        glob: '/opt/configs/*.json',
        ruleId: 'r-/opt/configs/*.json',
        ruleText: 'Never read /opt/configs/*.json',
      },
    ])
  })
})

describe('project read rules ADD to the built-in list', () => {
  const rules = [readRule('/opt/configs/*.json')]

  it('a project path is recorded advisory, with the rule ref and text', () => {
    const out = detectProjectSensitiveReadCrossings(
      readEvent('/opt/configs/api_tokens.json'),
      rules
    )
    expect(out).toEqual([
      expect.objectContaining({
        category: 'SENSITIVE_PATH_READ',
        severity: 'LOW',
        advisory: true,
        target: '/opt/configs/api_tokens.json',
        policyRuleRef: 'r-/opt/configs/*.json',
        policyRuleText: 'Never read /opt/configs/*.json',
      }),
    ])
    expect(out[0]!.detail).toMatch(/project rule \/opt\/configs\/\*\.json/)
  })

  it('works on the Bash surface with the same verb scoping', () => {
    expect(
      detectProjectSensitiveReadCrossings(
        bashEvent('cat /opt/configs/api_tokens.json | jq .'),
        rules
      ).map(c => c.target)
    ).toEqual(['/opt/configs/api_tokens.json'])
    // text only / write target → nothing
    expect(
      detectProjectSensitiveReadCrossings(
        bashEvent('echo "/opt/configs/api_tokens.json" > /tmp/note'),
        rules
      )
    ).toEqual([])
  })

  it('built-in stores stay covered and are never double-counted', () => {
    // ~/.ssh is caught by detectCrossings (built-in); the project pass skips it
    const ev = bashEvent('cat ~/.ssh/id_rsa /opt/configs/api_tokens.json')
    expect(detectCrossings(ev).map(c => c.target)).toEqual(['~/.ssh/id_rsa'])
    expect(
      detectProjectSensitiveReadCrossings(ev, rules).map(c => c.target)
    ).toEqual(['/opt/configs/api_tokens.json'])
    // a project glob that also covers a built-in path adds nothing for it
    expect(
      detectProjectSensitiveReads(
        { toolName: 'Read', filePath: '/Users/d/.ssh/id_rsa', command: null },
        [{ glob: '~/.ssh/**', ruleId: 'r', ruleText: 't' }]
      )
    ).toEqual([])
  })

  it('no project rules → no extra crossings, and the pure detector ignores policy', () => {
    expect(
      detectProjectSensitiveReadCrossings(
        readEvent('/opt/configs/api_tokens.json'),
        []
      )
    ).toEqual([])
    expect(detectCrossings(readEvent('/opt/configs/api_tokens.json'))).toEqual(
      []
    )
  })
})

describe('detectAndRecord loads the project policy', () => {
  it('records the project read as an advisory crossing carrying the rule', async () => {
    mockEnsureCompiled.mockResolvedValue({
      sourceHash: 'h',
      rules: [readRule('/opt/configs/*.json')],
    })
    await boundaryDetectorService.detectAndRecord({
      taskId: 't-1',
      hookEventId: 'evt-1',
      ...readEvent('/opt/configs/api_tokens.json'),
    })
    expect(createCrossing).toHaveBeenCalledTimes(1)
    expect(createCrossing).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't-1',
        category: 'SENSITIVE_PATH_READ',
        severity: 'LOW',
        advisory: true,
        target: '/opt/configs/api_tokens.json',
        policyRuleRef: 'r-/opt/configs/*.json',
        policyRuleText: 'Never read /opt/configs/*.json',
      })
    )
  })

  it('another project without the rule records nothing for the same read', async () => {
    await boundaryDetectorService.detectAndRecord({
      taskId: 't-2',
      hookEventId: 'evt-2',
      ...readEvent('/opt/configs/api_tokens.json'),
    })
    expect(createCrossing).not.toHaveBeenCalled()
  })
})

describe('policy compiler', () => {
  it('maps a read rule as a non-blocking built-in with its path-glob kept', () => {
    const [rule] = compileRuleSet([
      {
        text: 'Never read /opt/configs/*.json',
        kind: 'action',
        tier: 'deterministic',
        mappedCategory: 'SENSITIVE_PATH_READ',
        predicate: { type: 'path-glob', value: '/opt/configs/*.json' },
        severity: 'HIGH',
        blocking: true,
        polarity: 'forbid',
      },
    ])
    expect(rule).toMatchObject({
      tier: 'deterministic',
      mappedCategory: 'SENSITIVE_PATH_READ',
      predicate: { type: 'path-glob', value: '/opt/configs/*.json' },
      // advisory-only category: never blocking, so removing it later cannot
      // raise a blocking POLICY_WEAKENING either
      blocking: false,
    })
    expect(sensitiveReadRulesFromRules([rule!])).toHaveLength(1)
  })

  it('other built-ins keep their blocking flag', () => {
    const [rule] = compileRuleSet([
      {
        text: 'Never touch auth/',
        kind: 'action',
        tier: 'deterministic',
        mappedCategory: 'SENSITIVE_PATH_EDIT',
        predicate: { type: 'path-glob', value: 'auth/**' },
        severity: 'MEDIUM',
        blocking: true,
      },
    ])
    expect(rule!.blocking).toBe(true)
  })

  it('the compiler version is bumped so every project recompiles once', () => {
    expect(COMPILER_VERSION).toBe('lum963')
  })
})

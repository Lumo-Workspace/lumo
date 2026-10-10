/**
 * @jest-environment node
 *
 * LUM-1063 — the boundary-crossing extension points with NO plugin installed
 * (the open-source snapshot's `INSTALLED_SERVER_PLUGINS = []`), as RFC
 * LUM-1058 §2.2 / §3.4 and decisions Q1 / Q2 say:
 *   - the baseline categories are detected and recorded exactly as with the
 *     plugin (same rows as the origin/main fixture of the equivalence test);
 *   - the action classes are recorded WITHOUT the LLM prose confirmation;
 *   - the advanced detectors (destructive-fs, untrusted code, sensitive
 *     reads) and the compiled project rules do not run;
 *   - the POLICY_WEAKENING judge (deterministic on rule text) and the
 *     re-judge are core and work;
 *   - a system explanation is refused 501; the memory write gate has no
 *     policy rules; an IN_REVIEW status change starts nothing.
 *
 * LUM-1064: core copy — runs with no plugin module mocked at all (the OSS
 * snapshot ships none). The plugin half, __tests__/ee/security/lib/plugins/
 * no-plugins-crossings-lum1063.test.ts, additionally mocks every plugin
 * module with functions that throw and asserts none was called.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

jest.mock('@/lib/plugins/installed', () => ({ INSTALLED_SERVER_PLUGINS: [] }))

// --- core repositories ---------------------------------------------------------
const created: Array<Record<string, unknown>> = []
const findOpen = jest.fn()
const downgrade = jest.fn()
const findForExplanation = jest.fn()
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {},
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    isTrashed: jest.fn(async () => false),
    findWithProjectWorkspaceId: jest.fn(async () => ({
      id: 't-1',
      projectId: 'p-1',
      project: { workspaceId: 'w-1' },
    })),
  },
}))
const findDefaultRepository = jest.fn<Promise<{ fullName: string }>, unknown[]>(
  async () => ({ fullName: 'o/r' })
)
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findDefaultRepository: (...a: unknown[]) => findDefaultRepository(...a),
  },
}))
jest.mock('@/lib/repositories/crossing-suppression-rule.repository', () => ({
  crossingSuppressionRuleRepository: {
    findActiveForProject: jest.fn(async () => []),
  },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    coalesceRecurrence: jest.fn(async () => 0),
    coalesceSuppressedRecurrence: jest.fn(async () => 0),
    create: jest.fn(async (row: Record<string, unknown>) => {
      created.push(row)
      return { id: `bc-${created.length}` }
    }),
    findOpenBlockingRejudgeable: (...a: unknown[]) => findOpen(...a),
    downgradeToAdvisory: (...a: unknown[]) => downgrade(...a),
    findForExplanation: (...a: unknown[]) => findForExplanation(...a),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn(async () => ({})) },
}))
const listPrs = jest.fn()
const fetchPrFiles = jest.fn()
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    listRepoAndNumberByTask: (...a: unknown[]) => listPrs(...a),
  },
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrFiles: (...a: unknown[]) => fetchPrFiles(...a),
}))

import { CORPUS } from '@/test-utils/crossing-corpus-lum1063'
import {
  boundaryDetectorService,
  commandMatcherCategories,
  confirmActionCandidates,
  detectCrossings,
  detectProjectActionCrossings,
  detectProjectSensitiveReadCrossings,
} from '@/lib/services/boundary-detector.service'
import { recordPolicyWeakening } from '@/lib/services/boundary-crossing-policy-weakening.service'
import { boundaryCrossingRejudgeService } from '@/lib/services/boundary-crossing-rejudge.service'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'
import { loadPolicyRulesForProject } from '@/lib/services/memory/write-gate'
import { emitCoreEvent } from '@/lib/plugins/events'
import { getPluginRegistry } from '@/lib/plugins/registry'
import type { PolicyRule } from '@/lib/policy/types'
import { rejudgeRow } from '@/lib/boundary-crossing/rejudge'

const FIXTURE = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures', 'crossing-equivalence-lum1063.json'),
    'utf8'
  )
) as {
  events: Record<string, { recorded: Array<Record<string, unknown>> }>
}

/** RFC §2.2: the plugin's categories, never produced without it. */
const PLUGIN_ONLY = new Set([
  'DESTRUCTIVE_FS_COMMAND',
  'UNTRUSTED_CODE_EXECUTION',
  'SENSITIVE_PATH_READ',
  'PROJECT_RULE_VIOLATION',
])

async function record(e: (typeof CORPUS)[number]) {
  created.length = 0
  await boundaryDetectorService.detectAndRecord({
    taskId: 't-1',
    hookEventId: `he-${e.name}`,
    toolName: e.toolName,
    filePath: e.filePath,
    payload: e.payload,
  })
  return [...created]
}

beforeEach(() => {
  findOpen.mockReset().mockResolvedValue([])
  downgrade.mockReset().mockResolvedValue(1)
  listPrs.mockReset().mockResolvedValue([])
  fetchPrFiles.mockReset().mockResolvedValue([])
  findForExplanation.mockReset()
  findDefaultRepository.mockClear()
})

describe('LUM-1063 crossings without a plugin', () => {
  it('registers no crossing detector, explainer or policy rule source', () => {
    const r = getPluginRegistry()
    expect(r.plugins).toEqual([])
    expect(r.crossingDetectors).toEqual([])
    expect(r.crossingExplainers).toEqual([])
    expect(r.policyRuleSources).toEqual([])
    expect(commandMatcherCategories()).toEqual([
      'PUSH_TO_PROTECTED_BRANCH',
      'MIGRATION_FILE_DELETED',
      'DESTRUCTIVE_DB_COMMAND',
      'NEW_NPM_DEPENDENCY',
      'EXFILTRATION_PUBLIC',
      'CLOUD_DATA_DELETION',
      'INFRA_TERMINATION',
      'HOOK_BYPASS',
      'TEST_FILE_DELETED',
    ])
  })

  it('records the baseline categories exactly as the plugin-installed origin/main did, and nothing of the plugin', async () => {
    // Events whose plugin-installed output depends on the plugin itself: the
    // prose confirmation (dropped there, kept here) and the project rules
    // (the billing glob override; without it the built-in auth/ rule applies).
    const differs: Record<string, string[]> = {
      'prose-only-candidate': ['HOOK_BYPASS'],
      'sensitive-edit-glob': [],
      'sensitive-edit-builtin-overridden': ['SENSITIVE_PATH_EDIT'],
      'apply-patch-delete': ['TEST_FILE_DELETED'],
    }
    for (const e of CORPUS) {
      const rows = await record(e)
      for (const r of rows)
        expect({
          event: e.name,
          plugin: PLUGIN_ONLY.has(String(r.category)),
        }).toEqual({ event: e.name, plugin: false })
      if (e.name in differs) {
        expect({ event: e.name, cats: rows.map(r => r.category) }).toEqual({
          event: e.name,
          cats: differs[e.name],
        })
        continue
      }
      const expected = FIXTURE.events[e.name]!.recorded.filter(
        r => !PLUGIN_ONLY.has(String(r.category))
      )
      expect({ event: e.name, rows }).toEqual({ event: e.name, rows: expected })
    }
    // No policy rule source → the project's default repository is never
    // even looked up (the compile context is the plugin's).
    expect(findDefaultRepository).not.toHaveBeenCalled()
  })

  it('records the action classes without the LLM prose confirmation', async () => {
    const prose = CORPUS.find(e => e.name === 'prose-only-candidate')!
    const detected = detectCrossings(prose)
    expect(detected.map(c => c.category)).toEqual(['HOOK_BYPASS'])
    // Even a judge that would drop it is never consulted.
    const judge = jest.fn(async () => 'PROSE_ONLY' as const)
    await expect(
      confirmActionCandidates(prose, detected, judge)
    ).resolves.toEqual(detected)
    expect(judge).not.toHaveBeenCalled()
    for (const name of ['exfiltration', 'cloud-delete', 'infra-termination']) {
      const rows = await record(CORPUS.find(e => e.name === name)!)
      expect(rows.map(r => [r.category, r.severity])).toEqual([
        [
          {
            exfiltration: 'EXFILTRATION_PUBLIC',
            'cloud-delete': 'CLOUD_DATA_DELETION',
            'infra-termination': 'INFRA_TERMINATION',
          }[name],
          'HIGH',
        ],
      ])
    }
  })

  it('keeps the base64 evasion pass in the core', () => {
    const e = CORPUS.find(c => c.name === 'evasion-base64')!
    expect(
      detectCrossings(e).map(c => [c.category, c.severity, c.detail])
    ).toEqual([
      [
        'PUSH_TO_PROTECTED_BRANCH',
        'HIGH',
        expect.stringMatching(/^\[base64-decoded\] /),
      ],
    ])
  })

  it('runs no advanced detector and no project rule', () => {
    for (const name of [
      'destructive-fs',
      'untrusted-code',
      'sensitive-read-bash',
      'sensitive-read-tool',
    ])
      expect(detectCrossings(CORPUS.find(e => e.name === name)!)).toEqual([])
    const rule: PolicyRule = {
      id: 'r1',
      text: 'Never run vercel deploy --prod',
      kind: 'action',
      tier: 'deterministic',
      severity: 'HIGH',
      blocking: false,
      predicate: { type: 'cmd-substr', value: 'vercel deploy --prod' },
    }
    const ev = CORPUS.find(e => e.name === 'project-action-rule')!
    expect(detectProjectActionCrossings(ev, [rule])).toEqual([])
    expect(
      detectProjectSensitiveReadCrossings(
        CORPUS.find(e => e.name === 'project-read-rule')!,
        [rule]
      )
    ).toEqual([])
  })

  it('judges POLICY_WEAKENING on rule text in the core: removed → HIGH blocking, still present → MEDIUM advisory', async () => {
    const rule = (id: string, text: string): PolicyRule => ({
      id,
      text,
      kind: 'action',
      tier: 'deterministic',
      severity: 'HIGH',
      blocking: true,
      mappedCategory: 'MIGRATION_FILE_DELETED',
    })
    const removed = rule('a', 'Never delete files in prisma/migrations/')
    const kept = rule('b', 'Never push to main or develop directly')
    created.length = 0
    await recordPolicyWeakening({
      prevRules: [removed, kept],
      nextRules: [{ ...kept, tier: 'semantic', blocking: false }],
      taskId: 't-1',
      source: '## Forbidden\n- Never push to main or develop directly\n',
    })
    expect(created).toEqual([
      {
        taskId: 't-1',
        category: 'POLICY_WEAKENING',
        severity: 'HIGH',
        advisory: false,
        detail: `A deterministic Forbidden rule was removed from CLAUDE.md: "${removed.text}"`,
        target: 'weakening:a',
        reversible: true,
        policyRuleRef: 'a',
        policyRuleText: removed.text,
      },
      expect.objectContaining({
        category: 'POLICY_WEAKENING',
        severity: 'MEDIUM',
        advisory: true,
        target: 'weakening:b',
        policyRuleText: kept.text,
      }),
    ])
  })

  it('re-judges in the core: TEST_FILE_DELETED against the PR files, POLICY_WEAKENING with an injected reader', async () => {
    const task = { projectId: 'p1', project: { workspaceId: 'w1' } }
    findOpen.mockResolvedValue([
      {
        id: 'tf1',
        taskId: 't1',
        category: 'TEST_FILE_DELETED',
        severity: 'MEDIUM',
        detail: 'rm -f __tests__/zz-probe.test.ts; git status',
        policyRuleRef: null,
        policyRuleText: null,
        task,
      },
    ])
    listPrs.mockResolvedValue([
      { workspaceId: 'w1', repo: 'o/r', number: 990, state: 'merged' },
    ])
    fetchPrFiles.mockResolvedValue([
      { filename: '__tests__/a.test.ts', status: 'added' },
    ])
    const tf =
      await boundaryCrossingRejudgeService.rejudgeTestFileDeletedForTask('t1')
    expect(tf).toMatchObject({ judged: 1, downgraded: 1 })

    const text = 'Never delete files in prisma/migrations/'
    const pw = {
      id: 'pw1',
      taskId: 't1',
      category: 'POLICY_WEAKENING',
      severity: 'HIGH',
      detail: `A deterministic Forbidden rule was removed from CLAUDE.md: "${text}"`,
      policyRuleRef: 'abcd',
      policyRuleText: text,
      task,
    }
    // No policy rule source: the source cannot be read → UNDECIDABLE, no write.
    findOpen.mockResolvedValue([pw])
    downgrade.mockClear()
    const none = await boundaryCrossingRejudgeService.sweep({
      categories: ['POLICY_WEAKENING'],
    })
    expect(none).toMatchObject({ judged: 1, undecidable: 1, downgraded: 0 })
    expect(downgrade).not.toHaveBeenCalled()
    // The script path injects its own reader: the judge itself is core.
    const injected = await boundaryCrossingRejudgeService.sweep({
      categories: ['POLICY_WEAKENING'],
      readSource: async () => `## Forbidden\n- ${text}\n`,
    })
    expect(injected).toMatchObject({ judged: 1, downgraded: 1 })
  })

  it('the LUM-772 PRV backfill decides nothing without a rule detector (never "no longer matches")', () => {
    const rule: PolicyRule = {
      id: 'r1',
      text: 'Never run vercel deploy --prod',
      kind: 'action',
      tier: 'deterministic',
      severity: 'HIGH',
      blocking: false,
      predicate: { type: 'cmd-substr', value: 'vercel deploy --prod' },
    }
    expect(
      rejudgeRow(
        {
          id: 'x',
          taskId: 't1',
          projectId: 'p1',
          policyRuleRef: 'r1',
          policyRuleText: rule.text,
          detail: 'npx vercel deploy --prod',
          command: 'npx vercel deploy --prod',
        },
        [rule]
      )
    ).toMatchObject({ verdict: 'NO_POLICY' })
  })

  it('refuses a system explanation with 501 and persists nothing', async () => {
    findForExplanation.mockResolvedValue({
      id: 'c1',
      taskId: 't1',
      rawPurgedAt: null,
      systemExplanation: null,
      detail: 'git push origin main',
      category: 'PUSH_TO_PROTECTED_BRANCH',
      severity: 'MEDIUM',
      policyRuleText: null,
    })
    await expect(
      boundaryCrossingService.explainCrossing('t1', 'c1')
    ).rejects.toMatchObject({ status: 501 })
  })

  it('gives the memory write gate no policy rules', async () => {
    await expect(loadPolicyRulesForProject('p1')).resolves.toEqual([])
  })

  it('starts nothing on an IN_REVIEW status change', () => {
    expect(getPluginRegistry().handlersFor('task.statusChanged')).toEqual([])
    expect(() =>
      emitCoreEvent('task.statusChanged', { taskId: 't1', status: 'IN_REVIEW' })
    ).not.toThrow()
  })
})

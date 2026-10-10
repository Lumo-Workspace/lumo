/**
 * @jest-environment node
 *
 * LUM-1068 — with the security plugin INSTALLED, the plugin's LLM-compiled
 * policy and the core's `## Forbidden` parser both see a deleted rule. One
 * deletion must still be ONE POLICY_WEAKENING row, whichever source sees it
 * first:
 *   - same hook event: the plugin compiles (and records) first, the core
 *     observer then finds the plugin's open row and records nothing;
 *   - the plugin's model call fails on that event: the core records, and the
 *     plugin's later successful compile finds the core's open row and skips.
 *
 * Real: the installed plugin registration, the policy compiler service, the
 * hook detector, both recording paths. Faked: the model (`classifyRules`), the
 * repository files (`readRepoFile`), and stateful in-memory stores for the
 * two policy tables and the crossings. The repository's own CLAUDE.md is
 * never written.
 */
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {},
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('test-token'),
}))

const repoFiles = new Map<string, string>()
jest.mock('@/lib/integrations/github/contents', () => ({
  readRepoFile: jest.fn(
    async (opts: { path: string }) => repoFiles.get(opts.path) ?? null
  ),
}))

// The model: every `## Forbidden` line it knows becomes a deterministic,
// blocking rule — worded the LLM's way (markdown dropped, a trailing gloss).
let modelDown = false
const KNOWN: Array<{ line: string; text: string; category: string }> = [
  {
    line: 'Never delete files in `prisma/migrations/`',
    text: 'Never delete files in prisma/migrations/ [migration history]',
    category: 'MIGRATION_FILE_DELETED',
  },
  {
    line: 'Never hardcode API keys or secrets',
    text: 'Never hardcode API keys or secrets',
    category: 'HARDCODED_SECRET',
  },
]
const classifyRules = jest.fn(async (input: { sourceText: string }) => {
  if (modelDown) throw new Error('gateway 503')
  return {
    rules: KNOWN.filter(k => input.sourceText.includes(k.line)).map(k => ({
      text: k.text,
      kind: 'action' as const,
      tier: 'deterministic' as const,
      mappedCategory: k.category,
      severity: 'HIGH' as const,
      blocking: true,
    })),
  }
})
jest.mock('@/ee/security/llm/policy-compiler-client', () => ({
  classifyRules: (input: { sourceText: string }) => classifyRules(input),
}))

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    isTrashed: jest.fn(async () => false),
    findWithProjectWorkspaceId: jest.fn(async (id: string) => ({
      id,
      projectId: 'p-1',
      project: { workspaceId: 'w-1' },
    })),
  },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findDefaultRepository: jest.fn(async () => ({ fullName: 'acme/app' })),
  },
}))
jest.mock('@/lib/repositories/crossing-suppression-rule.repository', () => ({
  crossingSuppressionRuleRepository: {
    findActiveForProject: jest.fn(async () => []),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn(async () => ({})) },
}))

// ProjectPolicy (plugin table), stateful.
type Policy = {
  id: string
  projectId: string
  sourceHash: string
  rules: unknown[]
  compiledAt: Date
}
const policies: Policy[] = []
jest.mock('@/ee/security/repositories/project-policy.repository', () => {
  const view = (p: Policy) => ({
    id: p.id,
    sourceHash: p.sourceHash,
    rules: p.rules,
    compiledAt: p.compiledAt,
  })
  return {
    projectPolicyRepository: {
      latestForProject: jest.fn(async (projectId: string) => {
        const p = policies
          .filter(x => x.projectId === projectId)
          .sort((a, b) => b.compiledAt.getTime() - a.compiledAt.getTime())[0]
        return p ? view(p) : null
      }),
      findByHash: jest.fn(async (projectId: string, sourceHash: string) => {
        const p = policies.find(
          x => x.projectId === projectId && x.sourceHash === sourceHash
        )
        return p ? view(p) : null
      }),
      createIfAbsent: jest.fn(
        async (i: {
          projectId: string
          sourceHash: string
          rules: unknown[]
        }) => {
          if (
            policies.some(
              x => x.projectId === i.projectId && x.sourceHash === i.sourceHash
            )
          )
            return false
          policies.push({
            id: `pol-${policies.length}`,
            ...i,
            compiledAt: new Date(1_700_000_000_000 + policies.length * 1000),
          })
          return true
        }
      ),
      activateIfUnchanged: jest.fn(async () => false),
      findRuleTextByRef: jest.fn(async () => null),
    },
  }
})

// ForbiddenRuleSnapshot (core table), stateful.
const snapshots = new Map<string, Record<string, unknown>>()
jest.mock('@/lib/repositories/forbidden-rule-snapshot.repository', () => ({
  forbiddenRuleSnapshotRepository: {
    findByProject: jest.fn(async (projectId: string) => {
      const s = snapshots.get(projectId)
      return s ? { ...s } : null
    }),
    createIfAbsent: jest.fn(
      async (i: {
        projectId: string
        sourceHash: string
        rules: unknown[]
      }) => {
        if (snapshots.has(i.projectId)) return false
        snapshots.set(i.projectId, {
          sourceHash: i.sourceHash,
          previousSourceHash: null,
          rules: i.rules,
          updatedAt: new Date(0),
        })
        return true
      }
    ),
    advance: jest.fn(
      async (i: {
        projectId: string
        fromSourceHash: string
        sourceHash: string
        rules: unknown[]
      }) => {
        const s = snapshots.get(i.projectId)
        if (!s || s.sourceHash !== i.fromSourceHash) return false
        snapshots.set(i.projectId, {
          sourceHash: i.sourceHash,
          previousSourceHash: i.fromSourceHash,
          rules: i.rules,
          updatedAt: new Date(0),
        })
        return true
      }
    ),
  },
}))

type Row = Record<string, unknown> & {
  id: string
  category: string
  advisory: boolean
  disposition: string | null
  policyRuleRef: string | null
  policyRuleText: string | null
}
const rows: Row[] = []
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    coalesceRecurrence: jest.fn(async () => 0),
    coalesceSuppressedRecurrence: jest.fn(async () => 0),
    create: jest.fn(async (input: Record<string, unknown>) => {
      const row = {
        advisory: false,
        disposition: null,
        policyRuleRef: null,
        policyRuleText: null,
        ...input,
        id: `bc-${rows.length + 1}`,
      } as Row
      rows.push(row)
      return { id: row.id }
    }),
    findOpenPolicyWeakeningRules: jest.fn(
      async (i: { advisory: boolean; ruleRefPrefix?: string }) =>
        rows
          .filter(
            r =>
              r.category === 'POLICY_WEAKENING' &&
              r.disposition == null &&
              r.advisory === i.advisory &&
              (i.ruleRefPrefix == null ||
                (r.policyRuleRef ?? '').startsWith(i.ruleRefPrefix))
          )
          .map(r => ({
            id: r.id,
            policyRuleRef: r.policyRuleRef,
            policyRuleText: r.policyRuleText,
          }))
    ),
    findOpenBlockingRejudgeable: jest.fn(async () => []),
    downgradeToAdvisory: jest.fn(async () => 0),
  },
}))

import { boundaryDetectorService } from '@/lib/services/boundary-detector.service'
import { __resetForbiddenRuleSourceCache } from '@/lib/services/forbidden-rule-source.service'
import {
  __resetInflight,
  __resetSourceCache,
} from '@/ee/security/services/policy/policy-compiler.service'
import { getPluginRegistry } from '@/lib/plugins/registry'

const CLAUDE_MD = `# CLAUDE.md

## Forbidden

- Never delete files in \`prisma/migrations/\`
- Never hardcode API keys or secrets
`
const DELETED = CLAUDE_MD.replace(
  '- Never delete files in `prisma/migrations/`\n',
  ''
)

async function hookEvent(taskId = 't-1') {
  await boundaryDetectorService.detectAndRecord({
    taskId,
    hookEventId: null,
    toolName: 'Read',
    filePath: 'README.md',
    payload: { tool_input: { file_path: 'README.md' } },
  })
}

function edit(content: string) {
  repoFiles.set('CLAUDE.md', content)
  __resetSourceCache()
  __resetForbiddenRuleSourceCache()
}

const weakening = () => rows.filter(r => r.category === 'POLICY_WEAKENING')

beforeEach(() => {
  repoFiles.clear()
  policies.length = 0
  snapshots.clear()
  rows.length = 0
  modelDown = false
  classifyRules.mockClear()
  __resetInflight()
  edit(CLAUDE_MD)
})

describe('LUM-1068 — plugin installed: one deletion, one POLICY_WEAKENING row', () => {
  it('the plugin rule source is installed (and the core observer runs anyway)', async () => {
    expect(getPluginRegistry().policyRuleSources.map(s => s.id)).toEqual([
      'security.compiled-policy',
    ])
    await hookEvent()
    expect(policies).toHaveLength(1)
    expect(snapshots.has('p-1')).toBe(true)
    expect(weakening()).toEqual([])
  })

  it('same event: the plugin records, the core dedupes', async () => {
    await hookEvent()
    edit(DELETED)
    await hookEvent('t-2')
    expect(classifyRules).toHaveBeenCalledTimes(2)
    expect(weakening()).toEqual([
      expect.objectContaining({
        taskId: 't-2',
        severity: 'HIGH',
        advisory: false,
        // The plugin's row (LLM rule id + LLM wording), not a core one.
        policyRuleText:
          'Never delete files in prisma/migrations/ [migration history]',
      }),
    ])
    expect(String(weakening()[0]!.policyRuleRef)).not.toMatch(/^forbidden:/)
    // Nothing more on later events.
    await hookEvent('t-3')
    expect(weakening()).toHaveLength(1)
  })

  it("model down on that event: the core records; the plugin's later compile dedupes", async () => {
    await hookEvent()
    modelDown = true
    edit(DELETED)
    await hookEvent('t-2')
    expect(weakening()).toEqual([
      expect.objectContaining({
        taskId: 't-2',
        severity: 'HIGH',
        policyRuleRef: expect.stringMatching(/^forbidden:/),
        policyRuleText: 'Never delete files in `prisma/migrations/`',
      }),
    ])
    modelDown = false
    __resetSourceCache()
    await hookEvent('t-3')
    // The plugin compiled the new source (a new policy row) …
    expect(policies).toHaveLength(2)
    // … and found the core's open row for the same rule: still one row.
    expect(weakening()).toHaveLength(1)
  })

  it('a different rule deleted later is its own row', async () => {
    await hookEvent()
    edit(DELETED)
    await hookEvent()
    edit(DELETED.replace('- Never hardcode API keys or secrets\n', ''))
    await hookEvent()
    expect(weakening().map(r => r.policyRuleText)).toEqual([
      'Never delete files in prisma/migrations/ [migration history]',
      'Never hardcode API keys or secrets',
    ])
  })
})

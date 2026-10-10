/**
 * @jest-environment node
 *
 * LUM-1068 — the core Forbidden rule source with NO plugin installed
 * (`INSTALLED_SERVER_PLUGINS = []`, the open-source snapshot): removing or
 * downgrading a `## Forbidden` rule of CLAUDE.md produces a POLICY_WEAKENING
 * row through the hook detector, HIGH/blocking or MEDIUM/advisory on the
 * existing judge's line, exactly once per removal.
 *
 * The repository files are an in-memory map behind a mocked `readRepoFile`;
 * the repository's real CLAUDE.md is never written. The snapshot and crossing
 * repositories are stateful in-memory fakes (real compare-and-swap, real
 * "open row" filter), so the once-only assertions are not vacuous.
 */
jest.mock('@/lib/plugins/installed', () => ({ INSTALLED_SERVER_PLUGINS: [] }))
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {},
}))

// --- the repository's files --------------------------------------------------
const repoFiles = new Map<string, string>()
let readError: Error | null = null
const readRepoFile = jest.fn(
  async (opts: { workspaceId: string; fullName: string; path: string }) => {
    if (readError) throw readError
    return repoFiles.get(opts.path) ?? null
  }
)
jest.mock('@/lib/integrations/github/contents', () => ({
  readRepoFile: (opts: {
    workspaceId: string
    fullName: string
    path: string
  }) => readRepoFile(opts),
}))

// --- task / project ----------------------------------------------------------
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
let defaultRepo: { fullName: string } | null = { fullName: 'acme/app' }
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findDefaultRepository: jest.fn(async () => defaultRepo),
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

// --- the snapshot table (real compare-and-swap) ------------------------------
type Snap = {
  sourceHash: string
  previousSourceHash: string | null
  rules: unknown[]
  updatedAt: Date
}
const snapshots = new Map<string, Snap>()
jest.mock('@/lib/repositories/forbidden-rule-snapshot.repository', () => ({
  forbiddenRuleSnapshotRepository: {
    findByProject: jest.fn(async (projectId: string) => {
      const s = snapshots.get(projectId)
      return s ? { ...s, rules: [...s.rules] } : null
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
          rules: [...i.rules],
          updatedAt: new Date(Date.now()),
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
        // Yield first so two concurrent observers both reach the swap.
        await Promise.resolve()
        const s = snapshots.get(i.projectId)
        if (!s || s.sourceHash !== i.fromSourceHash) return false
        snapshots.set(i.projectId, {
          sourceHash: i.sourceHash,
          previousSourceHash: i.fromSourceHash,
          rules: [...i.rules],
          updatedAt: new Date(Date.now()),
        })
        return true
      }
    ),
  },
}))

// --- crossings ---------------------------------------------------------------
type Row = Record<string, unknown> & {
  id: string
  taskId: string
  category: string
  severity: string
  advisory: boolean
  detail: string
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
      async (i: {
        projectId: string
        advisory: boolean
        ruleRefPrefix?: string
      }) =>
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
    findOpenBlockingRejudgeable: jest.fn(async () =>
      rows
        .filter(
          r =>
            r.category === 'POLICY_WEAKENING' &&
            r.disposition == null &&
            !r.advisory
        )
        .map(r => ({
          id: r.id,
          taskId: r.taskId,
          category: r.category,
          severity: r.severity,
          detail: r.detail,
          policyRuleRef: r.policyRuleRef,
          policyRuleText: r.policyRuleText,
          task: { projectId: 'p-1', project: { workspaceId: 'w-1' } },
        }))
    ),
    downgradeToAdvisory: jest.fn(
      async (id: string, i: { severity: string; detail: string }) => {
        const r = rows.find(
          x => x.id === id && x.disposition == null && !x.advisory
        )
        if (!r) return 0
        Object.assign(r, {
          advisory: true,
          severity: i.severity,
          detail: i.detail,
        })
        return 1
      }
    ),
  },
}))

import { boundaryDetectorService } from '@/lib/services/boundary-detector.service'
import {
  __resetForbiddenRuleSourceCache,
  forbiddenRuleSourceService,
} from '@/lib/services/forbidden-rule-source.service'
import { boundaryCrossingRejudgeService } from '@/lib/services/boundary-crossing-rejudge.service'
import { forbiddenRuleId } from '@/lib/boundary-crossing/forbidden-rules'
import { getPluginRegistry } from '@/lib/plugins/registry'

const CLAUDE_MD = `# CLAUDE.md

## Testing

- Every new function needs at least one test

## Forbidden

- Never delete files in prisma/migrations/
- Never install new npm packages without noting it in PR description
- Never hardcode API keys or secrets
- Never push to main or develop directly

## PR Checklist

- honor the Forbidden list
`

/** One harmless hook event of task `t-1` (records no crossing of its own). */
async function hookEvent(taskId = 't-1') {
  await boundaryDetectorService.detectAndRecord({
    taskId,
    hookEventId: null,
    toolName: 'Read',
    filePath: 'README.md',
    payload: { tool_input: { file_path: 'README.md' } },
  })
}

/** The application clock (the 60 s cache and the stale-flip window). */
let clock = 1_800_000_000_000
jest.spyOn(Date, 'now').mockImplementation(() => clock)
/** Time passes: past the 60 s file cache and the 2 min stale-flip window. */
function later() {
  clock += 5 * 60_000
}

/** The repository changed: the next read sees it (the 60 s cache dropped). */
function edit(path: string, content: string | null) {
  if (content == null) repoFiles.delete(path)
  else repoFiles.set(path, content)
  __resetForbiddenRuleSourceCache()
}

const weakening = () => rows.filter(r => r.category === 'POLICY_WEAKENING')

beforeEach(() => {
  repoFiles.clear()
  snapshots.clear()
  rows.length = 0
  readError = null
  defaultRepo = { fullName: 'acme/app' }
  readRepoFile.mockClear()
  __resetForbiddenRuleSourceCache()
  repoFiles.set('CLAUDE.md', CLAUDE_MD)
})

describe('no plugin installed', () => {
  it('has no policy rule source and no plugin detector', () => {
    const reg = getPluginRegistry()
    expect(reg.policyRuleSources).toHaveLength(0)
    expect(reg.crossingDetectors).toHaveLength(0)
  })

  it('the first event is a baseline: stored, nothing recorded', async () => {
    await hookEvent()
    expect(snapshots.get('p-1')!.rules).toHaveLength(4)
    expect(weakening()).toEqual([])
  })

  it('deleting a Forbidden rule → one HIGH blocking POLICY_WEAKENING on the observing task', async () => {
    await hookEvent()
    edit(
      'CLAUDE.md',
      CLAUDE_MD.replace('- Never hardcode API keys or secrets\n', '')
    )
    await hookEvent('t-2')
    const text = 'Never hardcode API keys or secrets'
    const id = forbiddenRuleId(text)
    expect(weakening()).toEqual([
      expect.objectContaining({
        taskId: 't-2',
        category: 'POLICY_WEAKENING',
        severity: 'HIGH',
        advisory: false,
        detail: `A Forbidden rule was removed from CLAUDE.md: "${text}"`,
        target: `weakening:forbidden:${id}`,
        reversible: true,
        policyRuleRef: `forbidden:${id}`,
        policyRuleText: text,
      }),
    ])
    // Later events of any task see the same text: nothing more.
    await hookEvent('t-3')
    __resetForbiddenRuleSourceCache()
    await hookEvent('t-3')
    expect(weakening()).toHaveLength(1)
  })

  it('moving a rule out of the section → MEDIUM advisory (text still in the file)', async () => {
    await hookEvent()
    edit(
      'CLAUDE.md',
      CLAUDE_MD.replace(
        '- Never push to main or develop directly\n',
        ''
      ).replace(
        '- honor the Forbidden list\n',
        '- honor the Forbidden list\n- Never push to main or develop directly\n'
      )
    )
    await hookEvent()
    expect(weakening()).toEqual([
      expect.objectContaining({
        severity: 'MEDIUM',
        advisory: true,
        policyRuleText: 'Never push to main or develop directly',
      }),
    ])
  })

  it('removing the whole section → one row per rule; deleting CLAUDE.md with AGENTS.md present too', async () => {
    edit('AGENTS.md', '# AGENTS\n')
    await hookEvent()
    edit('CLAUDE.md', null)
    await hookEvent()
    expect(weakening().map(r => [r.severity, r.policyRuleText])).toEqual([
      ['HIGH', 'Never delete files in prisma/migrations/'],
      [
        'HIGH',
        'Never install new npm packages without noting it in PR description',
      ],
      ['HIGH', 'Never hardcode API keys or secrets'],
      ['HIGH', 'Never push to main or develop directly'],
    ])
  })

  it('edits that remove no rule record nothing (other sections, reformatting, additions)', async () => {
    await hookEvent()
    edit(
      'CLAUDE.md',
      CLAUDE_MD.replace(
        '## Testing\n\n- Every new function needs at least one test\n',
        ''
      )
        .replace(
          '- Never delete files in prisma/migrations/',
          '* Never delete files in `prisma/migrations/`.'
        )
        .replace('## PR Checklist', '- Never force-push\n\n## PR Checklist')
    )
    await hookEvent()
    expect(weakening()).toEqual([])
    expect(snapshots.get('p-1')!.rules).toHaveLength(5)
  })

  it('a read error, both files missing, or no repository decides nothing and keeps the snapshot', async () => {
    await hookEvent()
    const before = snapshots.get('p-1')
    readError = new Error('GitHub API error 502')
    __resetForbiddenRuleSourceCache()
    await hookEvent()
    readError = null
    edit('CLAUDE.md', null)
    await hookEvent()
    defaultRepo = null
    __resetForbiddenRuleSourceCache()
    await hookEvent()
    expect(weakening()).toEqual([])
    expect(snapshots.get('p-1')).toEqual(before)
    expect(
      await forbiddenRuleSourceService.observe({
        taskId: 't-1',
        projectId: 'p-1',
        workspaceId: 'w-1',
      })
    ).toEqual({ outcome: 'NO_REPOSITORY', recorded: 0 })
  })

  it('two instances observing the same edit record it once (compare-and-swap)', async () => {
    await hookEvent()
    edit(
      'CLAUDE.md',
      CLAUDE_MD.replace('- Never delete files in prisma/migrations/\n', '')
    )
    const input = { taskId: 't-1', projectId: 'p-1', workspaceId: 'w-1' }
    const outcomes = await Promise.all([
      forbiddenRuleSourceService.observe(input),
      forbiddenRuleSourceService.observe(input),
    ])
    expect(outcomes.map(o => o.outcome).sort()).toEqual([
      'CHANGED',
      'LOST_RACE',
    ])
    expect(weakening()).toHaveLength(1)
  })

  it('an instance still serving the text from before the change cannot flip the snapshot back (one row, still HIGH)', async () => {
    await hookEvent()
    const deleted = CLAUDE_MD.replace(
      '- Never delete files in prisma/migrations/\n',
      ''
    )
    edit('CLAUDE.md', deleted)
    await hookEvent()
    // Within the window another instance's 60 s cache still returns the old
    // text, then a fresh read returns the new one again.
    edit('CLAUDE.md', CLAUDE_MD)
    expect(
      await forbiddenRuleSourceService.observe({
        taskId: 't-1',
        projectId: 'p-1',
        workspaceId: 'w-1',
      })
    ).toEqual({ outcome: 'STALE', recorded: 0 })
    edit('CLAUDE.md', deleted)
    await hookEvent()
    expect(weakening()).toEqual([
      expect.objectContaining({ severity: 'HIGH', advisory: false }),
    ])
  })

  it('an OPEN row already naming the rule on the same side is not duplicated; the other side is', async () => {
    // e.g. the plugin's row for the same deletion, LLM-extracted text.
    rows.push({
      id: 'bc-plugin',
      taskId: 't-9',
      category: 'POLICY_WEAKENING',
      severity: 'HIGH',
      advisory: false,
      detail: 'A deterministic Forbidden rule was removed from CLAUDE.md: "…"',
      disposition: null,
      policyRuleRef: 'a1b2c3d4e5f60718',
      policyRuleText: 'Never delete files in prisma/migrations/',
    })
    await hookEvent()
    edit(
      'CLAUDE.md',
      CLAUDE_MD.replace(
        '- Never delete files in prisma/migrations/\n',
        ''
      ).replace('- Never hardcode API keys or secrets\n', '')
    )
    await hookEvent()
    expect(weakening().map(r => [r.id, r.policyRuleText])).toEqual([
      ['bc-plugin', 'Never delete files in prisma/migrations/'],
      ['bc-2', 'Never hardcode API keys or secrets'],
    ])
  })

  it('a removal after the earlier row was ruled on is recorded again', async () => {
    await hookEvent()
    const deleted = CLAUDE_MD.replace(
      '- Never delete files in prisma/migrations/\n',
      ''
    )
    edit('CLAUDE.md', deleted)
    await hookEvent()
    rows[0]!.disposition = 'CONFIRMED'
    later()
    edit('CLAUDE.md', CLAUDE_MD)
    await hookEvent()
    later()
    edit('CLAUDE.md', deleted)
    await hookEvent()
    expect(weakening().filter(r => !r.advisory)).toHaveLength(2)
  })

  it('restoring the rule re-judges the open HIGH row to advisory (core reader, no plugin)', async () => {
    await hookEvent()
    edit(
      'CLAUDE.md',
      CLAUDE_MD.replace('- Never hardcode API keys or secrets\n', '')
    )
    await hookEvent()
    expect(weakening()[0]).toMatchObject({ severity: 'HIGH', advisory: false })
    later()
    edit('CLAUDE.md', CLAUDE_MD)
    await hookEvent()
    expect(weakening()).toHaveLength(1)
    expect(weakening()[0]).toMatchObject({ severity: 'MEDIUM', advisory: true })
    expect(weakening()[0]!.detail).toContain(
      "This Forbidden rule's text is back in CLAUDE.md/AGENTS.md"
    )
  })

  it('the hourly sweep reads the source through the core reader without a plugin', async () => {
    await hookEvent()
    edit(
      'CLAUDE.md',
      CLAUDE_MD.replace('- Never hardcode API keys or secrets\n', '')
    )
    await hookEvent()
    // Restored on a branch nobody observed yet; only the sweep looks.
    repoFiles.set('CLAUDE.md', CLAUDE_MD)
    __resetForbiddenRuleSourceCache()
    const summary = await boundaryCrossingRejudgeService.sweep({
      categories: ['POLICY_WEAKENING'],
    })
    expect(summary).toMatchObject({ judged: 1, downgraded: 1 })
  })

  it('reads the two files at most once per minute per project', async () => {
    await hookEvent()
    await hookEvent()
    await hookEvent()
    expect(readRepoFile.mock.calls.map(c => c[0].path)).toEqual([
      'CLAUDE.md',
      'AGENTS.md',
    ])
  })
})

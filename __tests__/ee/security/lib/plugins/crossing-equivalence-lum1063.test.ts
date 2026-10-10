/**
 * @jest-environment node
 *
 * LUM-1063 — with the security plugin installed, the hook detector produces
 * exactly what it produced before its advanced detectors, the LLM prose
 * confirmation and the compiled-policy rules moved behind the plugin
 * registry. The expected outputs (`fixtures/crossing-equivalence-lum1063.json`)
 * were recorded from the same corpus on origin/main e60d5d0be, the commit
 * this PR starts from, with this very test (`LUM1063_WRITE_BASELINE=1`).
 *
 * Compared per event, in order: the pure taxonomy match, the prose
 * confirmation (a judge that answers PROSE_ONLY to everything, so every prose
 * candidate it is asked about is visibly dropped), the project action rules,
 * the project sensitive-read rules, the sensitive-path edit with the
 * project's glob override, and every row + timeline marker `detectAndRecord`
 * writes. Plus severity / reversibility for every enum value.
 */
import { writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { BoundaryCrossingCategory } from '@prisma/client'
import { CORPUS, CORPUS_RULES } from '@/test-utils/crossing-corpus-lum1063'

const created: unknown[] = []
const activities: unknown[] = []

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
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findDefaultRepository: jest.fn(async () => ({ fullName: 'o/r' })),
  },
}))
jest.mock('@/ee/security/services/policy/policy-compiler.service', () => ({
  policyCompilerService: {
    ensureCompiled: jest.fn(async () => ({
      sourceHash: 'h',
      rules: jest.requireActual('@/test-utils/crossing-corpus-lum1063')
        .CORPUS_RULES,
    })),
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
    create: jest.fn(async (row: unknown) => {
      created.push(row)
      return { id: `bc-${created.length}` }
    }),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {
    create: jest.fn(async (row: unknown) => {
      activities.push(row)
    }),
  },
}))
jest.mock('@/ee/security/llm/action-confirm-client', () => ({
  confirmActionExecuted: jest.fn(async () => 'PROSE_ONLY'),
}))

import {
  boundaryDetectorService,
  confirmActionCandidates,
  detectCrossings,
  detectProjectActionCrossings,
  detectProjectSensitiveReadCrossings,
  detectSensitivePathEdit,
  isReversible,
  sensitivePathGlobsFromRules,
  severityFor,
  writtenFilePaths,
} from '@/lib/services/boundary-detector.service'

const FIXTURE = join(
  __dirname,
  '../../../../lib/plugins/fixtures',
  'crossing-equivalence-lum1063.json'
)

const proseOnly = async () => 'PROSE_ONLY' as const

async function observe() {
  const events: Record<string, unknown> = {}
  for (const e of CORPUS) {
    const input = {
      toolName: e.toolName,
      filePath: e.filePath,
      payload: e.payload,
    }
    const detected = detectCrossings(input)
    const confirmed = await confirmActionCandidates(input, detected, proseOnly)
    const globs = sensitivePathGlobsFromRules(CORPUS_RULES)
    created.length = 0
    activities.length = 0
    await boundaryDetectorService.detectAndRecord({
      taskId: 't-1',
      hookEventId: `he-${e.name}`,
      ...input,
    })
    events[e.name] = {
      detected,
      confirmed,
      projectActions: detectProjectActionCrossings(input, CORPUS_RULES),
      projectReads: detectProjectSensitiveReadCrossings(input, CORPUS_RULES),
      sensitiveEdits: writtenFilePaths(input).map(filePath =>
        detectSensitivePathEdit({
          toolName: e.toolName,
          filePath,
          sensitivePathGlobs: globs,
        })
      ),
      recorded: [...created],
      timeline: [...activities],
    }
  }
  const taxonomy = Object.values(BoundaryCrossingCategory).map(c => ({
    category: c,
    severity: severityFor(c),
    reversible: isReversible(c),
    reversibleCodeRule: isReversible(c, 'coderule:x'),
  }))
  return { events, taxonomy }
}

describe('LUM-1063 crossing detectors: plugin installed = origin/main', () => {
  it('produces the outputs recorded on origin/main for every corpus event', async () => {
    const actual = JSON.parse(JSON.stringify(await observe()))
    if (process.env.LUM1063_WRITE_BASELINE === '1') {
      writeFileSync(
        FIXTURE,
        JSON.stringify({ recordedAt: 'e60d5d0be', ...actual }, null, 2) + '\n'
      )
    }
    const expected = JSON.parse(readFileSync(FIXTURE, 'utf8'))
    expect(expected.recordedAt).toBe('e60d5d0be')
    expect(actual.taxonomy).toEqual(expected.taxonomy)
    for (const name of Object.keys(expected.events)) {
      expect({ name, ...actual.events[name] }).toEqual({
        name,
        ...expected.events[name],
      })
    }
    expect(Object.keys(actual.events)).toEqual(Object.keys(expected.events))
  })

  it('the corpus covers every category the hook detector produces', () => {
    const expected = JSON.parse(readFileSync(FIXTURE, 'utf8'))
    const seen = new Set<string>()
    for (const ev of Object.values(expected.events) as Array<{
      recorded: Array<{ category: string }>
    }>)
      for (const r of ev.recorded) seen.add(r.category)
    expect([...seen].sort()).toEqual(
      [
        'CLOUD_DATA_DELETION',
        'DESTRUCTIVE_DB_COMMAND',
        'DESTRUCTIVE_FS_COMMAND',
        'EXFILTRATION_PUBLIC',
        'HARDCODED_SECRET',
        'HOOK_BYPASS',
        'INFRA_TERMINATION',
        'MIGRATION_FILE_DELETED',
        'NEW_NPM_DEPENDENCY',
        'PROJECT_RULE_VIOLATION',
        'PUSH_TO_PROTECTED_BRANCH',
        'SENSITIVE_PATH_EDIT',
        'SENSITIVE_PATH_READ',
        'TEST_FILE_DELETED',
        'UNTRUSTED_CODE_EXECUTION',
      ].sort()
    )
  })
})

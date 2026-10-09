/**
 * LUM-1051 — Codex writes files with `apply_patch`, whose `tool_input.command`
 * is patch text. Payload shapes follow the LUM-1050 probe (codex-cli 0.162.0).
 * Credential-shaped values are assembled at runtime (no literal).
 */
import {
  applyPatchDeletedPaths,
  applyPatchPrimaryPath,
  parseApplyPatch,
} from '../../shared/src/apply-patch'
import { extractFilePath } from '@/lib/services/hook-event.service'
import {
  detectCrossings,
  writtenFilePaths,
} from '@/lib/services/boundary-detector.service'
import { WRITE_TOOLS } from '@/lib/constants/hook-tools'
import {
  compactEvents,
  type RawEvent,
} from '@/lib/services/session-summary/compact-events'
import * as timeline from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/categorize'
import type { AgentRunHookEventItem } from '@/app/workspace/[workspaceUrl]/types'

jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))

const PROBE_PATCH =
  '*** Begin Patch\n*** Update File: /repo/a.txt\n@@\n-hi\n+hello\n*** End Patch'

const MULTI_PATCH = [
  '*** Begin Patch',
  '*** Add File: /repo/docs/new.md',
  '+# Title',
  '+run git push origin main to ship',
  '*** Update File: /repo/src/old.ts',
  '*** Move to: /repo/src/renamed.ts',
  '@@',
  '-const a = 1',
  '+const a = 2',
  '*** Delete File: /repo/__tests__/x.test.ts',
  '*** End Patch',
].join('\n')

const patchEvent = (patch: string, extra: Record<string, unknown> = {}) => ({
  session_id: '01a11e00-83c8-7ce3-b89d-eb1a44e13f3d',
  hook_event_name: 'PostToolUse',
  tool_name: 'apply_patch',
  tool_input: { command: patch },
  tool_response: 'Exit code: 0\nWall time: 0.1 seconds\n',
  tool_use_id: 'exec-783bf76d-c9d8-4d3e-bf91-64581dacd676',
  ...extra,
})

describe('parseApplyPatch', () => {
  it('reads files, rename targets and added/removed lines', () => {
    const p = parseApplyPatch(MULTI_PATCH)
    expect(p.files).toEqual([
      { op: 'add', path: '/repo/docs/new.md' },
      {
        op: 'update',
        path: '/repo/src/old.ts',
        moveTo: '/repo/src/renamed.ts',
      },
      { op: 'delete', path: '/repo/__tests__/x.test.ts' },
    ])
    expect(p.added).toBe(3)
    expect(p.removed).toBe(1)
    expect(p.addedText).toContain('const a = 2')
  })

  it('parses the probe patch and tolerates non-patch text', () => {
    expect(parseApplyPatch(PROBE_PATCH).files).toEqual([
      { op: 'update', path: '/repo/a.txt' },
    ])
    expect(parseApplyPatch('echo hi').files).toEqual([])
  })

  it('primary path = first written file (rename target), deletes listed apart', () => {
    expect(applyPatchPrimaryPath({ command: MULTI_PATCH })).toBe(
      '/repo/docs/new.md'
    )
    expect(
      applyPatchPrimaryPath({
        command: '*** Begin Patch\n*** Delete File: /repo/a.ts\n*** End Patch',
      })
    ).toBe('/repo/a.ts')
    expect(applyPatchPrimaryPath({})).toBeNull()
    expect(applyPatchDeletedPaths({ command: MULTI_PATCH })).toEqual([
      '/repo/__tests__/x.test.ts',
    ])
  })
})

describe('server reads apply_patch as a write', () => {
  it('apply_patch is a write tool', () => {
    expect(WRITE_TOOLS).toContain('apply_patch')
  })

  it('extractFilePath reads the patch header', () => {
    expect(extractFilePath(patchEvent(PROBE_PATCH))).toBe('/repo/a.txt')
  })

  it('writtenFilePaths lists every file the patch touches', () => {
    expect(
      writtenFilePaths({
        filePath: '/repo/docs/new.md',
        payload: patchEvent(MULTI_PATCH),
      })
    ).toEqual([
      '/repo/docs/new.md',
      '/repo/src/old.ts',
      '/repo/src/renamed.ts',
      '/repo/__tests__/x.test.ts',
    ])
  })
})

describe('boundary detector on apply_patch', () => {
  const detect = (patch: string, extra: Record<string, unknown> = {}) =>
    detectCrossings({
      toolName: 'apply_patch',
      filePath: applyPatchPrimaryPath({ command: patch }),
      payload: patchEvent(patch, extra),
    })

  it('patch text is not matched as a shell command', () => {
    const patch =
      '*** Begin Patch\n*** Add File: /repo/docs/ship.md\n+git push origin main --force\n*** End Patch'
    expect(detect(patch).map(c => c.category)).not.toContain(
      'PROTECTED_BRANCH_PUSH'
    )
    expect(detect(patch)).toEqual([])
  })

  it('a deleted test file is TEST_FILE_DELETED', () => {
    const cats = detect(MULTI_PATCH).map(c => c.category)
    expect(cats).toContain('TEST_FILE_DELETED')
  })

  it('the CLI probe answer downgrades a delete that left nothing missing', () => {
    const found = detect(MULTI_PATCH, { _lumo_deleted_test_files: [] }).find(
      c => c.category === 'TEST_FILE_DELETED'
    )
    expect(found?.advisory).toBe(true)
  })

  it('a hardcoded secret in added lines is HARDCODED_SECRET', () => {
    const key = 'sk_' + 'live_' + 'Qm7Tz4Lw9Kp2Xc8Vb5Nr3Hy6'
    const patch = `*** Begin Patch\n*** Add File: /repo/src/pay.ts\n+const key = '${key}'\n*** End Patch`
    const hit = detect(patch).find(c => c.category === 'HARDCODED_SECRET')
    expect(hit).toBeDefined()
    expect(hit?.advisory).not.toBe(true)
  })
})

describe('session summary + timeline on Codex tool events', () => {
  const ev = (
    id: string,
    type: string,
    toolName: string,
    payload: Record<string, unknown>
  ): RawEvent => ({
    id,
    type: type as RawEvent['type'],
    toolName,
    payload,
    createdAt: new Date('2026-10-09T00:00:00Z'),
  })

  it('compacts apply_patch with its files and a string Bash response as stdout', () => {
    const { text } = compactEvents([
      ev('p1', 'PRE_TOOL_USE', 'apply_patch', {
        tool_use_id: 'u1',
        tool_input: { command: MULTI_PATCH },
      }),
      ev(
        'q1',
        'POST_TOOL_USE',
        'apply_patch',
        patchEvent(MULTI_PATCH, { tool_use_id: 'u1' })
      ),
      ev('p2', 'PRE_TOOL_USE', 'Bash', {
        tool_use_id: 'u2',
        tool_input: { command: 'pwd' },
      }),
      ev('q2', 'POST_TOOL_USE', 'Bash', {
        tool_use_id: 'u2',
        tool_input: { command: 'pwd' },
        tool_response: '/repo\n',
      }),
    ])
    expect(text).toContain(
      'apply_patch add /repo/docs/new.md, /repo/src/renamed.ts, delete /repo/__tests__/x.test.ts +3 -1'
    )
    expect(text).toContain('stdout: /repo')
  })

  it('timeline: apply_patch is a write, spawn_agent an exec, INTERRUPT a turn failure', () => {
    const item = (
      type: string,
      toolName: string | null,
      payload: unknown = {}
    ): AgentRunHookEventItem => ({
      id: 'e',
      kind: 'hook',
      type: type as AgentRunHookEventItem['type'],
      toolName,
      payload,
      turnSummary: null,
      turnCost: null,
      createdAt: '2026-10-09T00:00:00Z',
    })
    expect(
      timeline.categorizeHookEvent(item('PRE_TOOL_USE', 'apply_patch'))
    ).toBe('tool_write')
    expect(
      timeline.categorizeHookEvent(
        item('PRE_TOOL_USE', 'collaborationspawn_agent')
      )
    ).toBe('tool_exec')
    expect(timeline.categorizeHookEvent(item('INTERRUPT', null))).toBe(
      'turn_failure'
    )
    expect(timeline.categorizeHookEvent(item('PRE_COMPACT', null))).toBe(
      'session_boundary'
    )
  })
})

/**
 * @jest-environment node
 *
 * LUM-932 acceptance #3: inside a subagent, lumo commands resolve to the
 * subagent's child session by matching its own pending PreToolUse event —
 * no command rewrite, so permission behavior is untouched.
 */
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { findRecentBashToolEventsInSessions: jest.fn() },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    findForMemberWithBinding: jest.fn(),
    listChildIds: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findMemberIdForHook: jest.fn(async () => 'wm_1') },
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { matchPendingLumoCommand } from '@/lib/session/resolve-caller'
import { sessionResolveService } from '@/lib/services/session-resolve.service'

const hooks = hookEventRepository as jest.Mocked<typeof hookEventRepository>
const sess = sessionRepository as jest.Mocked<typeof sessionRepository>
const identity = {
  user: { id: 'clerk_1', email: 'a@b.c', name: 'A' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'key_1', name: 'laptop', prefix: 'lum_abc' },
}
const P = 'd59fb7f9-1244-45c5-a9ae-35797dbcfc3b'
const A = `${P}:abeaba01ea909a7ee`
const B = `${P}:a548c414f786c5ff7`
const now = new Date('2026-10-02T10:00:00Z')
const pre = (sessionId: string, id: string, command: string, ago = 1) => ({
  sessionId,
  type: 'PRE_TOOL_USE' as const,
  createdAt: new Date(now.getTime() - ago * 1000),
  payload: { tool_use_id: id, tool_input: { command } },
})
const post = (sessionId: string, id: string) => ({
  sessionId,
  type: 'POST_TOOL_USE' as const,
  createdAt: now,
  payload: { tool_use_id: id },
})

beforeEach(() => {
  jest.clearAllMocks()
  sess.findForMemberWithBinding.mockResolvedValue({ id: P } as never)
  sess.listChildIds.mockResolvedValue([A, B])
})

describe('subagent lumo commands resolve to the child session without changing permissions', () => {
  it('matches the single pending lumo command by argv tokens in order', () => {
    const r = matchPendingLumoCommand(
      [
        pre(A, 't1', 'cd /repo && lumo verify LUM-12 --note "all green"'),
        pre(B, 't2', 'lumo task status LUM-13'),
      ],
      ['verify', 'LUM-12', '--note', 'all green']
    )
    expect(r).toEqual({ kind: 'one', sessionId: A })
  })

  it('ignores commands that already finished and non-lumo commands', () => {
    const r = matchPendingLumoCommand(
      [
        pre(A, 't1', 'lumo verify LUM-12'),
        post(A, 't1'),
        pre(B, 't2', 'echo verify LUM-12'),
      ],
      ['verify', 'LUM-12']
    )
    expect(r).toEqual({ kind: 'none' })
  })

  it('reports ambiguity when the same command is pending in two sessions', () => {
    const r = matchPendingLumoCommand(
      [pre(A, 't1', 'lumo task status'), pre(B, 't2', 'lumo task status')],
      ['task', 'status']
    )
    expect(r).toEqual({ kind: 'ambiguous', sessionIds: [B, A] })
  })

  it('a parent and a child running the same command is ambiguous, never silently the child', () => {
    const r = matchPendingLumoCommand(
      [pre(P, 't0', 'lumo verify'), pre(A, 't1', 'lumo verify')],
      ['verify']
    )
    expect(r.kind).toBe('ambiguous')
  })

  it('service: resolves to the child and only looks back two minutes', async () => {
    hooks.findRecentBashToolEventsInSessions.mockResolvedValue([
      pre(A, 't1', 'lumo verify LUM-12'),
    ])
    const r = await sessionResolveService.resolveCaller({
      identity,
      sessionId: P,
      argv: ['verify', 'LUM-12'],
      now,
    })
    expect(r).toEqual({ sessionId: A, resolution: 'child' })
    expect(hooks.findRecentBashToolEventsInSessions).toHaveBeenCalledWith(
      [P, A, B],
      new Date(now.getTime() - 120_000)
    )
  })

  it('service: fast path — no children means the parent, without reading events', async () => {
    sess.listChildIds.mockResolvedValue([])
    const r = await sessionResolveService.resolveCaller({
      identity,
      sessionId: P,
      argv: ['verify'],
      now,
    })
    expect(r).toEqual({ sessionId: P, resolution: 'parent' })
    expect(hooks.findRecentBashToolEventsInSessions).not.toHaveBeenCalled()
  })

  it('service: a session the caller does not own resolves to itself unchanged', async () => {
    sess.findForMemberWithBinding.mockResolvedValue(null as never)
    const r = await sessionResolveService.resolveCaller({
      identity,
      sessionId: P,
      argv: ['verify'],
      now,
    })
    expect(r).toEqual({ sessionId: P, resolution: 'parent' })
    expect(sess.listChildIds).not.toHaveBeenCalled()
  })

  it('service: ambiguity is surfaced, with the parent as the fallback id', async () => {
    hooks.findRecentBashToolEventsInSessions.mockResolvedValue([
      pre(A, 't1', 'lumo task status'),
      pre(B, 't2', 'lumo task status'),
    ])
    const r = await sessionResolveService.resolveCaller({
      identity,
      sessionId: P,
      argv: ['task', 'status'],
      now,
    })
    expect(r).toEqual({ sessionId: P, resolution: 'ambiguous' })
  })

  it('the pre-tool-use hook output never carries updatedInput or permissionDecision', () => {
    const src = readFileSync(
      join(process.cwd(), 'cli/src/lib/hook-runner.ts'),
      'utf8'
    )
    expect(src).not.toMatch(/updatedInput|permissionDecision/)
  })
})

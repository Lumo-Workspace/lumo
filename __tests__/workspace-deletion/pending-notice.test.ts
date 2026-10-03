/**
 * @jest-environment node
 *
 * LUM-923 — while a workspace deletion is pending, the CLI / agent sees it:
 * the session-start hook and `lumo task context` both carry a section naming
 * the scheduled deletion time, and the CLI renders it ahead of everything.
 */
jest.mock('@/lib/services/auth.service', () => ({
  authService: { verifyApiKey: jest.fn() },
}))
jest.mock('@/lib/services/hook-event.service', () => ({
  hookEventService: { recordHookEvent: jest.fn() },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    findTaskBinding: jest.fn(),
    findStewardBinding: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/workspace-deletion.repository', () => ({
  workspaceDeletionRepository: { findPending: jest.fn() },
}))
jest.mock('@/lib/auth/identity', () => ({
  requireIdentity: jest.fn(),
}))
jest.mock('@/lib/services/task-context.service', () => ({
  taskContextService: { getContextForIdentifier: jest.fn() },
}))
jest.mock('@/lib/services/next-steps.service', () => ({
  nextStepsService: { forExistingTask: jest.fn() },
}))
jest.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => p,
}))
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { authService } from '@/lib/services/auth.service'
import { hookEventService } from '@/lib/services/hook-event.service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { workspaceDeletionRepository } from '@/lib/repositories/workspace-deletion.repository'
import { requireIdentity } from '@/lib/auth/identity'
import { taskContextService } from '@/lib/services/task-context.service'
import { nextStepsService } from '@/lib/services/next-steps.service'
import {
  renderPendingDeletionSection,
  workspaceDeletionService,
} from '@/lib/services/workspace-deletion.service'
import { POST as sessionStart } from '@/app/api/hooks/session-start/route'
import { GET as taskContext } from '@/app/api/tasks/context/[identifier]/route'
import { formatHookStdoutLines } from '@/cli/src/lib/hook-runner'
import { formatTaskContextMarkdown } from '@/cli/src/commands/task-context'

const m = <T>(fn: T) => fn as unknown as jest.Mock

const EXECUTE_AT = new Date('2026-10-03T08:00:00.000Z')
const PENDING = {
  requestedAt: new Date('2026-10-01T08:00:00.000Z'),
  executeAt: EXECUTE_AT,
  requestedByClerkId: 'user_owner',
}

beforeEach(() => {
  jest.resetAllMocks()
  m(authService.verifyApiKey).mockResolvedValue({
    user: { id: 'clerk_1', email: 'a@b', name: 'A' },
    workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
    apiKey: { id: 'k_1', name: 'laptop', prefix: 'lum_abc' },
  })
  m(hookEventService.recordHookEvent).mockResolvedValue({
    id: 'he_1',
    sessionId: 's-1',
    taskId: null,
  })
  m(sessionRepository.findTaskBinding).mockResolvedValue({ bound: false })
  m(sessionRepository.findStewardBinding).mockResolvedValue(null)
  m(requireIdentity).mockResolvedValue({
    clerkId: 'clerk_1',
    memberId: 'member_1',
    workspaceId: 'ws_1',
    workspaceSlug: 'ws',
    workspaceName: 'WS',
    source: 'bearer',
  })
  m(taskContextService.getContextForIdentifier).mockResolvedValue({
    task: { id: 't1', identifier: 'LUM-1', status: 'TODO' },
    sessions: [],
  })
  m(nextStepsService.forExistingTask).mockResolvedValue([])
})

function postSessionStart() {
  return sessionStart(
    new Request('http://x/api/hooks/session-start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer lum_ok',
      },
      body: JSON.stringify({ sessionId: 's-1' }),
    })
  )
}

function getTaskContext() {
  return taskContext(
    new Request('http://x/api/tasks/context/LUM-1', {
      headers: { Authorization: 'Bearer good' },
    }),
    { params: Promise.resolve({ identifier: 'LUM-1' }) }
  )
}

describe('LUM-923 pending deletion notice', () => {
  it('LUM-923 pending deletion notice: the section names the scheduled deletion time, and is empty when none is pending', () => {
    const section = renderPendingDeletionSection(PENDING)
    expect(section).toContain('## Workspace scheduled for deletion')
    expect(section).toContain('2026-10-03T08:00:00.000Z')
    expect(renderPendingDeletionSection(null)).toBe('')
  })

  it('LUM-923 pending deletion notice: a failed lookup yields no section instead of breaking context', async () => {
    m(workspaceDeletionRepository.findPending).mockRejectedValue(
      new Error('db down')
    )
    await expect(
      workspaceDeletionService.buildPendingNoticeSection('ws_1')
    ).resolves.toBe('')
  })

  it('LUM-923 pending deletion notice: session start carries it, even for an unbound session', async () => {
    m(workspaceDeletionRepository.findPending).mockResolvedValue(PENDING)

    const body = await (await postSessionStart()).json()

    expect(workspaceDeletionRepository.findPending).toHaveBeenCalledWith('ws_1')
    expect(body.workspaceNoticeSection).toContain('2026-10-03T08:00:00.000Z')
  })

  it('LUM-923 pending deletion notice: session start carries an empty section when nothing is pending', async () => {
    m(workspaceDeletionRepository.findPending).mockResolvedValue(null)

    const body = await (await postSessionStart()).json()

    expect(body.workspaceNoticeSection).toBe('')
  })

  it('LUM-923 pending deletion notice: task context carries it', async () => {
    m(workspaceDeletionRepository.findPending).mockResolvedValue(PENDING)

    const res = await getTaskContext()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.workspaceNoticeSection).toContain('2026-10-03T08:00:00.000Z')
  })

  it('LUM-923 pending deletion notice: the CLI injects it first at session start and in task context', () => {
    const notice = renderPendingDeletionSection(PENDING)

    const lines = formatHookStdoutLines('session-start', {
      sessionId: 's-1',
      taskBinding: { bound: true, taskIdentifier: 'LUM-1', taskTitle: 't' },
      workspaceNoticeSection: notice,
      blockerWarningSection: '## Blocked',
      testCaseSection: '## Test cases',
    })
    const envelope = JSON.parse(lines.find(l => l.startsWith('{'))!) as {
      hookSpecificOutput: { additionalContext: string }
    }
    const ctx = envelope.hookSpecificOutput.additionalContext
    expect(ctx).toContain('2026-10-03T08:00:00.000Z')
    expect(ctx.indexOf('Workspace scheduled for deletion')).toBeLessThan(
      ctx.indexOf('## Blocked')
    )

    const md = formatTaskContextMarkdown(
      {
        task: {
          identifier: 'LUM-1',
          title: 't',
          status: 'TODO',
          description: null,
        },
        workspaceNoticeSection: notice,
        testCaseSection: '## Test cases',
        sessions: [],
      },
      new Date('2026-10-01T09:00:00.000Z')
    )
    expect(md).toContain('2026-10-03T08:00:00.000Z')
    expect(md.indexOf('Workspace scheduled for deletion')).toBeLessThan(
      md.indexOf('## Test cases')
    )
  })
})

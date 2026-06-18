/**
 * @jest-environment node
 *
 * LUM-544 §3 — server-side blocked-tag automation. Crossing the same-tool
 * failure threshold auto-applies the shared `blocked` tag (idempotent, with
 * attribution); the next progress auto-removes it — but only the tag Lumo
 * applied, never a human-applied one.
 */
jest.mock('@/lib/repositories/auto-block.repository', () => ({
  autoBlockRepository: {
    insertIfAbsent: jest.fn(),
    resolveActiveByTask: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { findTaskAndAttribution: jest.fn() },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { findFailuresBySession: jest.fn() },
}))
jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: {
    findOrCreateMany: jest.fn(),
    addTaskTags: jest.fn(),
    removeTaskTags: jest.fn(),
    findByName: jest.fn(),
  },
}))

import { autoBlockService } from '@/lib/services/auto-block.service'
import { autoBlockRepository } from '@/lib/repositories/auto-block.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { tagRepository } from '@/lib/repositories/tag.repository'

const findSession = sessionRepository.findTaskAndAttribution as jest.Mock
const findFailures = hookEventRepository.findFailuresBySession as jest.Mock
const insertIfAbsent = autoBlockRepository.insertIfAbsent as jest.Mock
const resolveActive = autoBlockRepository.resolveActiveByTask as jest.Mock
const findOrCreate = tagRepository.findOrCreateMany as jest.Mock
const addTaskTags = tagRepository.addTaskTags as jest.Mock
const removeTaskTags = tagRepository.removeTaskTags as jest.Mock
const findByName = tagRepository.findByName as jest.Mock

const boundSession = {
  taskId: 't1',
  workspaceId: 'w1',
  agent: 'CLAUDE_CODE',
  usageByModel: { 'anthropic/claude-opus-4-8': { input: 10 } },
}

function bashFails(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    type: 'POST_TOOL_USE_FAILURE' as const,
    toolName: 'Bash',
    turnSummary: null,
    payload: { tool_response: { stderr: `err ${i}` } },
    createdAt: new Date(`2026-06-01T10:0${i}:00.000Z`),
  }))
}

beforeEach(() => {
  jest.clearAllMocks()
  findOrCreate.mockResolvedValue([{ id: 'tagB', name: 'blocked' }])
  findByName.mockResolvedValue({ id: 'tagB', name: 'blocked' })
})

it('blocked tag auto-applied once at failure threshold then auto-removed on progress with attribution', async () => {
  findSession.mockResolvedValue(boundSession)

  // --- crossing the threshold tags the bound task once, with attribution ---
  findFailures.mockResolvedValue(bashFails(3))
  insertIfAbsent.mockResolvedValue(true) // first crossing → row created

  await autoBlockService.onFailureRecorded('sess1')

  expect(insertIfAbsent).toHaveBeenCalledTimes(1)
  // Attribution: triggering session + best-effort model + the failure group.
  expect(insertIfAbsent).toHaveBeenCalledWith({
    taskId: 't1',
    triggeringSessionId: 'sess1',
    model: 'anthropic/claude-opus-4-8',
    topFailureLabel: 'Bash ×3',
    failureCount: 3,
  })
  expect(addTaskTags).toHaveBeenCalledWith('t1', ['tagB'])

  // --- idempotent: a re-crossing inserts nothing and does NOT re-tag ---
  jest.clearAllMocks()
  findSession.mockResolvedValue(boundSession)
  findFailures.mockResolvedValue(bashFails(5))
  insertIfAbsent.mockResolvedValue(false) // active row already exists → no-op

  await autoBlockService.onFailureRecorded('sess1')

  expect(insertIfAbsent).toHaveBeenCalledTimes(1)
  expect(addTaskTags).not.toHaveBeenCalled()

  // --- progress auto-removes the tag Lumo applied ---
  jest.clearAllMocks()
  findSession.mockResolvedValue(boundSession)
  findByName.mockResolvedValue({ id: 'tagB', name: 'blocked' })
  resolveActive.mockResolvedValue(1) // an ACTIVE auto-block existed → resolved

  await autoBlockService.onProgressRecorded('sess1')

  expect(resolveActive).toHaveBeenCalledWith('t1')
  expect(removeTaskTags).toHaveBeenCalledWith('t1', ['tagB'])
})

it('does not auto-apply below the threshold', async () => {
  findSession.mockResolvedValue(boundSession)
  findFailures.mockResolvedValue(bashFails(2))

  await autoBlockService.onFailureRecorded('sess1')

  expect(insertIfAbsent).not.toHaveBeenCalled()
  expect(addTaskTags).not.toHaveBeenCalled()
})

it('progress does not remove a human-applied blocked tag (no active auto-block)', async () => {
  findSession.mockResolvedValue(boundSession)
  resolveActive.mockResolvedValue(0) // nothing Lumo applied

  await autoBlockService.onProgressRecorded('sess1')

  expect(removeTaskTags).not.toHaveBeenCalled()
})

it('unbound session is a no-op on both paths', async () => {
  findSession.mockResolvedValue({ ...boundSession, taskId: null })

  await autoBlockService.onFailureRecorded('sess1')
  await autoBlockService.onProgressRecorded('sess1')

  expect(findFailures).not.toHaveBeenCalled()
  expect(insertIfAbsent).not.toHaveBeenCalled()
  expect(resolveActive).not.toHaveBeenCalled()
})

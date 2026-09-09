/**
 * @jest-environment node
 */

import { formatHookStdoutLines } from '@/cli/src/lib/hook-runner'

describe('formatHookStdoutLines (session-start stdout)', () => {
  it('returns bound message when taskBinding.bound is true', () => {
    const body = {
      sessionId: 'sess_abc',
      taskBinding: {
        bound: true,
        taskIdentifier: 'LUM-12',
        taskTitle: 'Add OAuth',
      },
    }
    const lines = formatHookStdoutLines('session-start', body)
    expect(lines.length).toBeGreaterThanOrEqual(1)
    expect(lines[0]).toBe(
      '[Lumo] session_id=sess_abc | Current task: LUM-12 - Add OAuth'
    )
  })

  it('returns unbound message when taskBinding.bound is false', () => {
    const body = {
      sessionId: 'sess_abc',
      taskBinding: { bound: false },
    }
    const lines = formatHookStdoutLines('session-start', body)
    expect(lines.length).toBeGreaterThanOrEqual(1)
    expect(lines[0]).toBe(
      '[Lumo] session_id=sess_abc | No task bound. Tell me the task you want to work on (e.g. LUM-42), or say "skip".'
    )
  })

  it('returns [] when body has no taskBinding', () => {
    expect(formatHookStdoutLines('session-start', { ok: true })).toHaveLength(0)
  })

  it('returns [] when body has no sessionId', () => {
    const body = { taskBinding: { bound: false } }
    expect(formatHookStdoutLines('session-start', body)).toHaveLength(0)
  })

  it('returns [] for null/undefined body', () => {
    expect(formatHookStdoutLines('session-start', null)).toHaveLength(0)
    expect(formatHookStdoutLines('session-start', undefined)).toHaveLength(0)
  })

  it('includes linkedResourcesSection in the additionalContext envelope, after memory (LUM-147)', () => {
    const body = {
      sessionId: 'sess_abc',
      taskBinding: { bound: true, taskIdentifier: 'LUM-12', taskTitle: 'X' },
      memorySection: 'MEM',
      linkedResourcesSection: 'LINKED',
      reviewTodosSection: 'TODOS',
    }
    const lines = formatHookStdoutLines('session-start', body)
    const envelope = lines.find(l => l.includes('additionalContext'))
    expect(envelope).toBeDefined()
    const parsed = JSON.parse(envelope as string)
    const ctx = parsed.hookSpecificOutput.additionalContext
    expect(ctx).toBe('MEM\n\nLINKED\n\nTODOS')
  })

  it('omits linkedResourcesSection when empty (LUM-147)', () => {
    const body = {
      sessionId: 'sess_abc',
      taskBinding: { bound: true, taskIdentifier: 'LUM-12', taskTitle: 'X' },
      memorySection: 'MEM',
      linkedResourcesSection: '',
      reviewTodosSection: '',
    }
    const lines = formatHookStdoutLines('session-start', body)
    const envelope = lines.find(l => l.includes('additionalContext'))
    const parsed = JSON.parse(envelope as string)
    expect(parsed.hookSpecificOutput.additionalContext).toBe('MEM')
  })

  it('injects securityFindingsSection after the blocker warning and before the contract (LUM-737)', () => {
    const body = {
      sessionId: 'sess_abc',
      taskBinding: { bound: true, taskIdentifier: 'LUM-12', taskTitle: 'X' },
      blockerWarningSection: 'BLOCKER',
      securityFindingsSection: 'SECURITY',
      criteriaSection: 'CONTRACT',
      memorySection: 'MEM',
    }
    const lines = formatHookStdoutLines('session-start', body)
    const envelope = lines.find(l => l.includes('additionalContext'))
    const parsed = JSON.parse(envelope as string)
    expect(parsed.hookSpecificOutput.additionalContext).toBe(
      'BLOCKER\n\nSECURITY\n\nCONTRACT\n\nMEM'
    )
  })

  it('omits securityFindingsSection when empty (LUM-737)', () => {
    const body = {
      sessionId: 'sess_abc',
      taskBinding: { bound: true, taskIdentifier: 'LUM-12', taskTitle: 'X' },
      securityFindingsSection: '',
      criteriaSection: 'CONTRACT',
    }
    const lines = formatHookStdoutLines('session-start', body)
    const envelope = lines.find(l => l.includes('additionalContext'))
    const parsed = JSON.parse(envelope as string)
    expect(parsed.hookSpecificOutput.additionalContext).toBe('CONTRACT')
  })
})

/** @jest-environment jsdom */
/**
 * LUM-613: useTaskStatus.optimisticallyPass flips the targeted criteria to a
 * HUMAN PASS in the shared status cache the instant a reviewer clicks Pass —
 * the in-browser responsiveness fix — and hands back a rollback closure for a
 * failed POST. Exercised at the hook level (the only place that needs a real
 * QueryClient); the Acceptance tab itself mocks this hook.
 */
import { renderHook } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useTaskStatus } from '@/app/workspace/[workspaceUrl]/hooks/useTaskStatus'
import type {
  TaskAcceptanceStatusView,
  TaskStatusCriterionView,
} from '@/app/workspace/[workspaceUrl]/types'

jest.mock('@/lib/api-client', () => ({
  tasksClient: { getStatus: jest.fn().mockResolvedValue(undefined) },
}))

function human(
  over: Partial<TaskStatusCriterionView> = {}
): TaskStatusCriterionView {
  return {
    id: 'h1',
    statement: 'looks good in the running app',
    verifierType: 'HUMAN',
    checkpointer: null,
    evidenceRequired: false,
    judgeSteps: null,
    source: 'AGENT_DRAFT',
    addedAtRound: 0,
    latestVerdict: null,
    machinePassed: false,
    verdictStale: false,
    checkMismatch: false,
    changeState: null,
    changedAtRound: null,
    lastEdit: null,
    confirmedAt: null,
    ...over,
  }
}

function view(): TaskAcceptanceStatusView {
  return {
    version: 1,
    task: { id: 't1', identifier: 'LUM-1', title: 'x', status: 'IN_REVIEW' },
    currentRound: 1,
    maxRounds: 3,
    escalated: false,
    criteria: [human(), human({ id: 'h2' })],
    machineVerification: { total: 0, machineVerified: 0, humanOverridden: 0 },
    removedCriteria: [],
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
  }
}

function setup() {
  const client = new QueryClient()
  const key = queryKeys.taskStatus('LUM-1')
  client.setQueryData(key, view())
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(
    () => useTaskStatus({ identifier: 'LUM-1', enabled: false }),
    { wrapper }
  )
  const read = () =>
    client.getQueryData<TaskAcceptanceStatusView>(
      key
    ) as TaskAcceptanceStatusView
  return { result, read }
}

describe('useTaskStatus.optimisticallyPass', () => {
  it('flips only the targeted criterion to a HUMAN PASS', () => {
    const { result, read } = setup()
    result.current.optimisticallyPass(['h1'])
    const after = read()
    expect(
      after.criteria.find(c => c.id === 'h1')?.latestVerdict
    ).toMatchObject({ verdict: 'PASS', verifierType: 'HUMAN' })
    // The untargeted criterion is left exactly as it was (still unjudged).
    expect(after.criteria.find(c => c.id === 'h2')?.latestVerdict).toBeNull()
  })

  it('rollback restores the pre-click snapshot exactly', () => {
    const { result, read } = setup()
    const before = read()
    const rollback = result.current.optimisticallyPass(['h1'])
    expect(read().criteria[0]?.latestVerdict?.verdict).toBe('PASS')
    rollback()
    expect(read()).toEqual(before)
  })

  it('is a no-op (empty rollback) when nothing is cached yet', () => {
    const client = new QueryClient()
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(
      () => useTaskStatus({ identifier: 'LUM-9', enabled: false }),
      { wrapper }
    )
    const rollback = result.current.optimisticallyPass(['h1'])
    expect(rollback).toBeInstanceOf(Function)
    expect(client.getQueryData(queryKeys.taskStatus('LUM-9'))).toBeUndefined()
    // Calling the empty rollback is safe.
    expect(() => rollback()).not.toThrow()
  })
})

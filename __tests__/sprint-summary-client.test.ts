/**
 * @jest-environment node
 */
import {
  buildSprintPrompt,
  SPRINT_RETRO_SYSTEM_PROMPT,
  type SprintSummaryInput,
} from '@/lib/llm/sprint-summary-client'
import type { RetroStruggleAggregate } from '@/lib/services/retro-struggle'

const CLEAN_STRUGGLE: RetroStruggleAggregate = {
  tasksConsidered: 3,
  tasksWithStruggle: 0,
  reworkRounds: 0,
  failedVerdicts: 0,
  openSendBacks: 0,
  resolvedSendBacks: 0,
  reopens: 0,
  followUps: 0,
  extraPrCycles: 0,
  machineVerified: 4,
  humanOverridden: 0,
  machineTotal: 4,
  hardTasks: [],
}

const ROUGH_STRUGGLE: RetroStruggleAggregate = {
  tasksConsidered: 3,
  tasksWithStruggle: 1,
  reworkRounds: 2,
  failedVerdicts: 5,
  openSendBacks: 1,
  resolvedSendBacks: 2,
  reopens: 1,
  followUps: 1,
  extraPrCycles: 3,
  machineVerified: 2,
  humanOverridden: 2,
  machineTotal: 4,
  hardTasks: [
    {
      identifier: 'LUM-88',
      title: 'the rough one',
      reworkRounds: 2,
      openSendBacks: 1,
      reopens: 1,
      extraPrCycles: 3,
      humanOverridden: 2,
    },
  ],
}

function input(
  struggle: RetroStruggleAggregate,
  tasks: SprintSummaryInput['tasks']
): SprintSummaryInput {
  return {
    subject: 'Sprint 4',
    window: { start: new Date('2026-05-01'), end: new Date('2026-05-14') },
    stats: {
      totalTasks: tasks.length,
      done: tasks.filter(t => t.status === 'DONE').length,
      spillover: tasks.filter(t => t.status !== 'DONE').length,
      byPriority: {},
      byAssignee: {},
    },
    tasks,
    struggle,
  }
}

describe('SPRINT_RETRO_SYSTEM_PROMPT', () => {
  it('forces a mandatory risk/rework section and drops bare all-clear fallbacks', () => {
    expect(SPRINT_RETRO_SYSTEM_PROMPT).not.toContain('No spillover')
    expect(SPRINT_RETRO_SYSTEM_PROMPT).not.toContain('Nothing outstanding')
    expect(SPRINT_RETRO_SYSTEM_PROMPT).toMatch(/## Risks/i)
    expect(SPRINT_RETRO_SYSTEM_PROMPT.toLowerCase()).toContain('basis')
  })
})

describe('buildSprintPrompt', () => {
  it('feeds the negative-class aggregate numbers into the prompt', () => {
    const tasks = [
      {
        id: 't1',
        status: 'DONE',
        priority: 'HIGH',
        assigneeActorId: null,
        title: 'shipped',
      },
    ]
    const prompt = buildSprintPrompt(input(ROUGH_STRUGGLE, tasks))
    expect(prompt).toContain('Rework rounds')
    expect(prompt).toContain('Failed verdicts')
    expect(prompt).toContain('Open send-backs')
    expect(prompt).toContain('Human-overridden')
    expect(prompt).toMatch(/Rework rounds[^\n]*\b2\b/)
    expect(prompt).toMatch(/Human-overridden[^\n]*\b2\b/)
    expect(prompt).toContain('LUM-88')
  })

  it('always states a verification basis, even when every signal is zero', () => {
    const tasks = [
      {
        id: 't1',
        status: 'DONE',
        priority: 'HIGH',
        assigneeActorId: null,
        title: 'shipped',
      },
    ]
    const prompt = buildSprintPrompt(input(CLEAN_STRUGGLE, tasks))
    expect(prompt.toLowerCase()).toContain('basis')
    expect(prompt).toMatch(/0 FAIL|0 send-back|0 reopen/i)
  })

  it('labels non-DONE/spillover tasks with provenance and tags done tasks with priority', () => {
    const tasks = [
      {
        id: 't1',
        status: 'DONE',
        priority: 'HIGH',
        assigneeActorId: null,
        title: 'finished work',
      },
      {
        id: 't2',
        status: 'TODO',
        priority: 'LOW',
        assigneeActorId: null,
        title: 'carried work',
      },
    ]
    const prompt = buildSprintPrompt(input(CLEAN_STRUGGLE, tasks))
    expect(prompt).toMatch(/HIGH[^\n]*finished work/)
    expect(prompt).toMatch(/TODO[^\n]*carried work/)
  })
})

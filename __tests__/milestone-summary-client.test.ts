/**
 * @jest-environment node
 */
import {
  buildMilestonePrompt,
  MILESTONE_RETRO_SYSTEM_PROMPT,
  type MilestoneSummaryInput,
} from '@/lib/llm/milestone-summary-client'
import type { RetroStruggleAggregate } from '@/lib/services/retro-struggle'

const CLEAN_STRUGGLE: RetroStruggleAggregate = {
  tasksConsidered: 3,
  tasksWithStruggle: 0,
  reopens: 0,
  extraPrCycles: 0,
  hardTasks: [],
}

const ROUGH_STRUGGLE: RetroStruggleAggregate = {
  tasksConsidered: 3,
  tasksWithStruggle: 1,
  reopens: 1,
  extraPrCycles: 3,
  hardTasks: [
    {
      identifier: 'LUM-77',
      title: 'the hard one',
      reopens: 1,
      extraPrCycles: 3,
    },
  ],
}

function input(
  struggle: RetroStruggleAggregate,
  tasks: MilestoneSummaryInput['tasks']
): MilestoneSummaryInput {
  return {
    subject: 'Context Lineage',
    window: { start: new Date('2026-05-01'), target: new Date('2026-05-20') },
    stats: {
      totalTasks: tasks.length,
      done: tasks.filter(t => t.status === 'DONE').length,
      inProgress: tasks.filter(t => t.status === 'IN_PROGRESS').length,
      byPriority: {},
      byAssignee: {},
    },
    tasks,
    struggle,
  }
}

describe('MILESTONE_RETRO_SYSTEM_PROMPT', () => {
  it('forces a mandatory risk/rework section and drops the optimistic all-clear fallback', () => {
    expect(MILESTONE_RETRO_SYSTEM_PROMPT).not.toContain('Nothing outstanding')
    // A mandatory risk/rework section that must always render.
    expect(MILESTONE_RETRO_SYSTEM_PROMPT).toMatch(/## Risks/i)
    expect(MILESTONE_RETRO_SYSTEM_PROMPT.toLowerCase()).toContain('basis')
    // Incomplete work is provenance-labelled, not blended into Delivered.
    expect(MILESTONE_RETRO_SYSTEM_PROMPT).toMatch(/## (Incomplete|Deferred)/i)
  })
})

describe('buildMilestonePrompt', () => {
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
    const prompt = buildMilestonePrompt(input(ROUGH_STRUGGLE, tasks))
    expect(prompt).toContain('Reopens')
    expect(prompt).toContain('Extra PR cycles')
    // The actual figures must appear so the LLM can't soften them.
    expect(prompt).toMatch(/Extra PR cycles[^\n]*\b3\b/)
    // Hard tasks are named so the report can point at where it was hard.
    expect(prompt).toContain('LUM-77')
  })

  it('always states a basis, even when every signal is zero', () => {
    const tasks = [
      {
        id: 't1',
        status: 'DONE',
        priority: 'HIGH',
        assigneeActorId: null,
        title: 'shipped',
      },
    ]
    const prompt = buildMilestonePrompt(input(CLEAN_STRUGGLE, tasks))
    expect(prompt.toLowerCase()).toContain('basis')
    // The basis spells out the clean state instead of dropping the section.
    expect(prompt).toMatch(/0 reopen/i)
  })

  it('separates non-DONE tasks under a provenance bucket and tags delivered tasks with priority', () => {
    const tasks = [
      {
        id: 't1',
        status: 'DONE',
        priority: 'HIGH',
        assigneeActorId: null,
        title: 'delivered work',
      },
      {
        id: 't2',
        status: 'IN_PROGRESS',
        priority: 'LOW',
        assigneeActorId: null,
        title: 'unfinished work',
      },
    ]
    const prompt = buildMilestonePrompt(input(CLEAN_STRUGGLE, tasks))
    const deliveredIdx = prompt.indexOf('delivered work')
    const incompleteIdx = prompt.indexOf('unfinished work')
    expect(deliveredIdx).toBeGreaterThan(-1)
    expect(incompleteIdx).toBeGreaterThan(-1)
    // Delivered tasks carry their priority for theme grouping / load-bearing call-out.
    expect(prompt).toMatch(/HIGH[^\n]*delivered work/)
    // The unfinished task is tagged with its status as provenance.
    expect(prompt).toMatch(/IN_PROGRESS[^\n]*unfinished work/)
  })
})

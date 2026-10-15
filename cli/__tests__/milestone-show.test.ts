import {
  formatMilestoneShow,
  type MilestoneShowData,
} from '../src/commands/milestone-show'

const base: MilestoneShowData = {
  id: 'm-1',
  name: 'Q3 Launch',
  completedAt: null,
  startDate: null,
  targetDate: null,
  archivedAt: null,
  description: null,
  projectName: 'Web',
  taskCounts: { TODO: 2, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 4 },
  health: 'on-track',
  sprintCoverage: {
    sprints: [
      {
        sprintId: 's3',
        number: 3,
        name: 'Sprint 3',
        status: 'ACTIVE' as const,
        taskCount: 6,
        doneCount: 4,
      },
      {
        sprintId: 's4',
        number: 4,
        name: 'Sprint 4',
        status: 'DRAFT',
        taskCount: 2,
        doneCount: 0,
      },
    ],
    unsprinted: 1,
  },
}

describe('formatMilestoneShow — sprint coverage', () => {
  it('renders a coverage row per sprint with done/total and an unsprinted line', () => {
    const out = formatMilestoneShow(base, [])
    expect(out).toContain('\nSprint coverage\n')
    expect(out).toMatch(/#3\s+ACTIVE\s+Sprint 3\s+4\/6 done/)
    expect(out).toMatch(/#4\s+DRAFT\s+Sprint 4\s+0\/2 done/)
    expect(out).toMatch(/Unscheduled\s+1 task/)
  })

  it('pluralizes the unsprinted label when unsprinted > 1', () => {
    const out = formatMilestoneShow(
      {
        ...base,
        sprintCoverage: {
          sprints: base.sprintCoverage!.sprints,
          unsprinted: 2,
        },
      },
      []
    )
    expect(out).toMatch(/Unscheduled\s+2 tasks/)
  })

  it('omits the unsprinted line when unsprinted === 0', () => {
    const out = formatMilestoneShow(
      {
        ...base,
        sprintCoverage: {
          sprints: base.sprintCoverage!.sprints,
          unsprinted: 0,
        },
      },
      []
    )
    expect(out).not.toContain('Unscheduled')
  })

  it('shows a placeholder when no sprints are covered', () => {
    const out = formatMilestoneShow(
      { ...base, sprintCoverage: { sprints: [], unsprinted: 0 } },
      []
    )
    expect(out).toContain(
      '\nSprint coverage\n  None — no task of this milestone is in a sprint.'
    )
  })

  it('omits the section entirely when sprintCoverage is absent', () => {
    const { sprintCoverage, ...without } = base
    const out = formatMilestoneShow(without, [])
    expect(out).not.toContain('Sprint coverage')
  })
})

describe('formatMilestoneShow — staleness hints (LUM-624/LUM-714)', () => {
  it('annotates completion drift and missing target date, silent when absent', () => {
    const stale = formatMilestoneShow(
      {
        ...base,
        completedAt: null,
        targetDate: null,
        staleness: { completionDrift: 'complete', datesMissing: true },
      },
      []
    )
    expect(stale).toContain(
      'State:      ACTIVE  (stale — task progress indicates COMPLETED; auto-updating)'
    )
    expect(stale).toContain(
      'Target:     -  (no target date — schedule health unavailable)'
    )

    const clean = formatMilestoneShow(
      { ...base, staleness: { completionDrift: null, datesMissing: false } },
      []
    )
    expect(clean).toContain('State:      ACTIVE\n')
    expect(clean).not.toContain('stale')
    expect(clean).not.toContain('no target date')
  })
})

describe('formatMilestoneShow — close gate (LUM-1135)', () => {
  it('shows an open close gate', () => {
    const out = formatMilestoneShow(
      {
        ...base,
        closeGate: {
          held: 0,
          cases: [{ state: 'open', reason: null }],
        },
      },
      []
    )
    expect(out).toMatch(/Close gate:\s+open/)
  })

  it('summarises a held close gate by reason', () => {
    const out = formatMilestoneShow(
      {
        ...base,
        closeGate: {
          held: 2,
          cases: [
            { state: 'held', reason: 'NOT_RUN' },
            { state: 'held', reason: 'FAILING' },
            { state: 'open', reason: null },
          ],
        },
      },
      []
    )
    expect(out).toMatch(/Close gate:\s+held \(1 not run, 1 failing\)/)
  })

  it('omits the row when the server sent no gate', () => {
    expect(formatMilestoneShow({ ...base }, [])).not.toMatch(/Close gate/)
  })

  it('says unknown when the server sent null (gate read failed)', () => {
    expect(formatMilestoneShow({ ...base, closeGate: null }, [])).toMatch(
      /Close gate:\s+unknown \(could not read\)/
    )
  })
})

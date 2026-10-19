/**
 * @jest-environment node
 */
/**
 * LUM-1232 batch B — detail views (docs/cli-output-conventions.md D-1–D-5,
 * E-1/E-2, decision Q7): a `<ref>  <title>` first line, facts aligned to the
 * widest label, no hard wrap when piped, structured bodies rendered, and no
 * Markdown in `task runs` / `task lineage`.
 */
import {
  fieldLines,
  reportWidth,
  wrapLines,
} from '../../cli/src/lib/report-layout'
import { formatMemoryShow } from '../../cli/src/lib/memory-content'
import { formatLineageMarkdown } from '../../cli/src/commands/task-lineage'
import {
  formatRunReport,
  type RunReport,
} from '../../cli/src/commands/task-runs'
import { formatMilestoneShow } from '../../cli/src/commands/milestone-show'
import { formatSprintShow } from '../../cli/src/commands/sprint-show'
import { crossingFields } from '../../cli/src/commands/crossing-list'
import {
  milestoneMetricsLines,
  type MilestoneMetricsData,
} from '../../cli/src/lib/milestone-metrics'
import { buildAgentRunReport } from '@/lib/services/agent-run-report.service'
import { TIMELINE } from '../helpers/lum1188-agent-runs-timeline'

const ESC = '\u001b'
const LONG_PATH =
  '/private/tmp/claude-501/-Users-chaoli-Desktop-lumo-lumo/60e98fc0-e9c1-4a80-9401-9315909c965b/scratchpad/npx-check'

describe('D-4 — no hard wrapping when piped', () => {
  it('tty:false never wraps; a pure call keeps the 100-column report width', () => {
    expect(wrapLines(`cd ${LONG_PATH} && npx jest`, 4, { tty: false })).toEqual(
      [`    cd ${LONG_PATH} && npx jest`]
    )
    expect(wrapLines(`cd ${LONG_PATH} && npx jest`, 4).length).toBeGreaterThan(
      1
    )
    expect(reportWidth({ width: 80 })).toBe(80)
  })

  it('a long fact value stays on one line next to its label when piped', () => {
    const out = fieldLines([{ label: 'Detail', value: `cd ${LONG_PATH}` }], 2, {
      tty: false,
    })
    expect(out).toEqual([`  Detail:  cd ${LONG_PATH}`])
  })
})

describe('E-2 — bare enum values are coloured on a TTY only', () => {
  it('colours DONE green with colour on; plain otherwise', () => {
    const on = fieldLines([{ label: 'Status', value: 'DONE' }], 0, {
      color: true,
    })
    expect(on[0]).toContain(`${ESC}[32mDONE${ESC}[39m`)
    const off = fieldLines([{ label: 'Status', value: 'DONE' }], 0)
    expect(off).toEqual(['Status:  DONE'])
  })
})

describe('D-5 — memory show renders its body', () => {
  it('ref + summary first, Type, then one section per field; never JSON', () => {
    const out = formatMemoryShow({
      id: 'cmabcdef3lao7kmv',
      category: 'DECISION',
      content: {
        summary: 'Use the published CLI',
        what: 'Collect evidence with the npm build.',
        why: 'The dev build differs.',
      },
    })
    expect(out.split('\n')).toEqual([
      '3lao7kmv  Use the published CLI',
      'Type:  DECISION',
      '',
      'What',
      '  Collect evidence with the npm build.',
      '',
      'Why',
      '  The dev build differs.',
    ])
    expect(out).not.toContain('{')
  })
})

describe('D-1 / Q7 — no Markdown in task lineage and task runs', () => {
  it('lineage: `<ref>  <title>`, Status fact, plain headings', () => {
    const out = formatLineageMarkdown({
      task: { identifier: 'LUM-1', title: 'Add lineage', status: 'DONE' },
      totals: {
        runCount: 1,
        fragmentCount: 0,
        edgeCount: 0,
        tokens: {
          input: 1,
          output: 2,
          cacheRead: 3,
          cacheCreation: 4,
          total: 10,
        },
        loopCount: 1,
        outcomes: {
          MERGED: 0,
          REVERTED: 0,
          REJECTED: 0,
          REWORKED: 0,
          UNKNOWN: 0,
        },
        funnel: {
          impressions: 0,
          index: 0,
          pulled: 0,
          used: 0,
          tokensSaved: null,
        },
        topOperations: [],
      },
      groups: [
        {
          label: 'Session s1',
          includedAt: '2026-06-01T00:00:00.000Z',
          cost: null,
          fragments: [],
        },
      ],
    } as never)
    const lines = out.split('\n')
    expect(lines[0]).toBe('LUM-1  Add lineage')
    expect(lines[1]).toBe('Status:  DONE')
    expect(out).toContain('\nTotals\n  Runs:')
    expect(out).not.toMatch(/^#|\*\*|^- /m)
    expect(out).not.toMatch(/^_/m)
  })

  it('runs: `<ref>  Agent runs` and plain `Run #N` headings', () => {
    const report = buildAgentRunReport(TIMELINE, {
      sessionCount: 1,
      forecast: null,
      tokenCost: { forecast: null, actual: 1000, deltaPct: null, band: null },
      iterations: { forecast: null, actual: 1, deltaPct: null, band: null },
      interactionRounds: {
        forecast: null,
        actual: 1,
        deltaPct: null,
        band: null,
      },
      totalDuration: {
        forecast: null,
        actual: null,
        deltaPct: null,
        band: null,
      },
    } as never) as unknown as RunReport
    const out = formatRunReport('LUM-1188', report, { hints: false })
    expect(out.split('\n')[0]).toBe('LUM-1188  Agent runs')
    expect(out).toMatch(/^Run #1 · /m)
    expect(out).not.toMatch(/^#/m)
  })
})

describe('D-1 — milestone / sprint show start with `<ref>  <title>`', () => {
  it('milestone: slug and name; sprint: #n and name', () => {
    const m = formatMilestoneShow(
      {
        id: 'm1',
        slug: 'q3-launch',
        name: 'Q3 Launch',
        description: null,
        startDate: null,
        targetDate: null,
        completedAt: null,
        archivedAt: null,
        projectName: 'Lumo',
        taskCounts: {
          total: 0,
          BACKLOG: 0,
          TODO: 0,
          IN_PROGRESS: 0,
          IN_REVIEW: 0,
          DONE: 0,
        },
      } as never,
      []
    )
    expect(m.split('\n')[0]).toBe('q3-launch  Q3 Launch')
    expect(m).not.toMatch(/^Milestone:|^Slug:/m)
    const s = formatSprintShow(
      {
        id: 's1',
        number: 3,
        name: 'Sprint 3',
        status: 'ACTIVE',
        team: { name: 'Core' },
        startDate: '2026-06-01T00:00:00.000Z',
        endDate: '2026-06-14T00:00:00.000Z',
        startedAt: null,
        closedAt: null,
      } as never,
      { done: 0, total: 0 },
      []
    )
    expect(s.split('\n').slice(0, 2)).toEqual([
      '#3  Sprint 3',
      'Status:    ACTIVE',
    ])
  })
})

describe('D-2 — crossing facts use short labels', () => {
  it('no label is wider than 16 columns', () => {
    const fields = crossingFields({
      id: 'c',
      ref: 'LUM-X1',
      attribution: { agent: null, model: null, sessionId: null },
      explanations: [],
      occurrenceCount: 1,
    } as never)
    for (const f of fields) expect(f.label.length).toBeLessThanOrEqual(16)
    const labels = fields.map(f => f.label)
    expect(labels).toEqual(
      expect.arrayContaining(['Why flagged', 'Agent notes'])
    )
  })
})

describe('L-3 — milestone by-task rows: same field count on every piped row', () => {
  const data: MilestoneMetricsData = {
    costRollup: {
      tokenCost: 300,
      activeTimeSec: 0,
      measuredTasks: 2,
      totalTasks: 2,
    },
    deliveryStats: {
      pr: { mergedPrCount: 0, multiPrTaskCount: 0, linkedTaskCount: 0 },
      perTask: {
        rows: [
          {
            taskId: 'a',
            ref: 'LUM-1',
            title: 'with split',
            tokenCost: 200,
            models: [{ model: 'm', total: 200 }],
            modelUnattributedTokens: 0,
            activeTimeSec: 0,
            prCount: 0,
            multiPr: false,
            changeVolume: null,
          },
          {
            taskId: 'b',
            ref: 'LUM-2',
            title: 'no split',
            tokenCost: 100,
            models: [],
            modelUnattributedTokens: 0,
            activeTimeSec: 0,
            prCount: 0,
            multiPr: false,
            changeVolume: null,
          },
        ],
      },
    },
  } as never
  it('a row without a model split gets `-` for that field', () => {
    const rows = milestoneMetricsLines(data, { tty: false }).filter(l =>
      /^\s+LUM-\d/.test(l)
    )
    expect(rows).toHaveLength(2)
    const counts = rows.map(r => r.trim().split('\t').length)
    expect(new Set(counts).size).toBe(1)
    expect(rows[1]!.trim().split('\t').pop()).toBe('-')
  })
})

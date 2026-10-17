/**
 * @jest-environment node
 */
import {
  formatModelSplit,
  milestoneMetricsLines,
  type MilestoneMetricsData,
} from '@/cli/src/lib/milestone-metrics'
import { formatMilestoneShow } from '@/cli/src/commands/milestone-show'

// LUM-1190 — `milestone show` Metrics section (text twin of the web strip).

const measured: MilestoneMetricsData = {
  costRollup: {
    tokenCost: 283_500_000,
    activeTimeSec: 10_740,
    measuredTasks: 2,
    totalTasks: 8,
  },
  budget: {
    tokenBudget: 250_000_000,
    tokenCost: 283_500_000,
    usedRatio: 1.134,
    exceeded: true,
    overBy: 33_500_000,
  },
  deliveryStats: {
    pr: { mergedPrCount: 5, multiPrTaskCount: 1, linkedTaskCount: 2 },
    perTask: {
      rows: [
        {
          taskId: 't2',
          ref: 'LUM-707',
          title: 'deferred cleanups',
          tokenCost: 82_300_000,
          models: [],
          modelUnattributedTokens: 82_300_000,
          activeTimeSec: 3_240,
          prCount: 1,
          multiPr: false,
          changeVolume: null,
        },
        {
          taskId: 't1',
          ref: 'LUM-497',
          title: 'reference-class anchors',
          tokenCost: 201_200_000,
          models: [{ model: 'claude-opus-5', total: 168_400_000 }],
          modelUnattributedTokens: 32_800_000,
          activeTimeSec: 7_500,
          prCount: 4,
          multiPr: true,
          changeVolume: { additions: 2_100, deletions: 140 },
        },
        {
          taskId: 't3abcdefgh',
          ref: null,
          title: null,
          tokenCost: null,
          activeTimeSec: 0,
          prCount: 0,
          multiPr: false,
          changeVolume: null,
        },
      ],
    },
  },
}

describe('formatModelSplit', () => {
  it('lists the top three models, the rest folded, then the unattributed spend', () => {
    const out = formatModelSplit(
      [
        { model: 'a', total: 4_000 },
        { model: 'b', total: 3_000 },
        { model: 'c', total: 2_000 },
        { model: 'd', total: 1_000 },
        { model: 'e', total: 500 },
      ],
      1_200
    )
    expect(out).toBe(
      'a 4K · b 3K · c 2K · +2 more models 1.5K · 1.2K not attributed to a model'
    )
  })

  it('is empty without model data', () => {
    expect(formatModelSplit(undefined, 0)).toBe('')
  })

  it('sanitizes model names', () => {
    expect(
      formatModelSplit([{ model: 'x\u001b[31my', total: 1 }])
    ).not.toContain('\u001b')
  })
})

describe('milestoneMetricsLines', () => {
  it('renders the strip totals, budget, rework and the by-task breakdowns', () => {
    const out = milestoneMetricsLines(measured).join('\n')
    expect(out).toContain('\nMetrics\n')
    expect(out).toContain('Tokens:       283.5M  (measured on 2 of 8 tasks)')
    expect(out).toContain(
      'Budget:       113% of 250M token budget  (over budget by 33.5M)'
    )
    expect(out).toContain('Active time:  2h 59m  (non-idle session time)')
    expect(out).toContain(
      'Merged PRs:   5  (rework: 1 task with more than one PR)'
    )
    // Tokens: sorted by tokens desc, figures first; piped, the model split
    // is one more TAB field on the row (one row per line, LUM-1232 L-3); the
    // null-token task is absent.
    expect(out).toContain(
      [
        '  By task — tokens',
        '    LUM-497\t201.2M tokens\treference-class anchors\tclaude-opus-5 168.4M · 32.8M not attributed to a model',
        '    LUM-707\t82.3M tokens\tdeferred cleanups\t82.3M not attributed to a model',
      ].join('\n')
    )
    expect(out).toContain(
      [
        '  By task — active time',
        '    LUM-497\t2h 5m\treference-class anchors',
        '    LUM-707\t54m\tdeferred cleanups',
      ].join('\n')
    )
    expect(out).toContain(
      [
        '  By task — PRs',
        '    LUM-497\t4 PRs\tmulti-PR\t+2.1K/−140\treference-class anchors',
        '    LUM-707\t1 PR\t\tno synced PRs\tdeferred cleanups',
      ].join('\n')
    )
    expect(out).not.toContain('t3abcdef')
  })

  it('reads `-` for unmeasured spend — never 0 / 0s', () => {
    const out = milestoneMetricsLines({
      costRollup: {
        tokenCost: null,
        activeTimeSec: 0,
        measuredTasks: 0,
        totalTasks: 8,
      },
      budget: {
        tokenBudget: 1_000_000,
        tokenCost: null,
        usedRatio: null,
        exceeded: null,
        overBy: null,
      },
      deliveryStats: {
        pr: { mergedPrCount: 0, multiPrTaskCount: 0, linkedTaskCount: 0 },
        perTask: { rows: [] },
      },
    }).join('\n')
    expect(out).toContain('Tokens:       -  (measured on 0 of 8 tasks)')
    expect(out).toContain(
      'Budget:       - of 1M token budget (burn not measured)'
    )
    expect(out).toContain('Active time:  -  (non-idle session time)')
    expect(out).toContain('Merged PRs:   No PRs on record')
    expect(out).toContain('By task — tokens\n    Not measured.')
    expect(out).toContain('By task — PRs\n    No PRs on record.')
    expect(out).not.toMatch(/\b0s\b/)
    expect(out).not.toContain('0 tokens')
  })

  it('omits the budget row without a budget and the by-task blocks on an older server', () => {
    const out = milestoneMetricsLines({
      costRollup: measured.costRollup,
      deliveryStats: { pr: measured.deliveryStats!.pr },
    }).join('\n')
    expect(out).not.toContain('Budget:')
    expect(out).not.toContain('By task')
  })

  it('lists the top ten tasks per block and counts the rest', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      taskId: `t${i}`,
      ref: `LUM-${100 + i}`,
      title: `Task ${i}`,
      tokenCost: 1_000 * (12 - i),
      activeTimeSec: 60 * (12 - i),
      prCount: 1,
      multiPr: false,
      changeVolume: null,
    }))
    const out = milestoneMetricsLines({
      costRollup: measured.costRollup,
      deliveryStats: { pr: measured.deliveryStats!.pr, perTask: { rows } },
    }).join('\n')
    expect(out).toContain('LUM-109')
    expect(out).not.toContain('LUM-110')
    expect(
      out.match(/ {4}Showing 10 of 12 \(all of them in --json\)\./g)
    ).toHaveLength(3)
  })

  it('prints a header row on a TTY with the model split still under its row', () => {
    const out = milestoneMetricsLines(measured, { tty: true, width: 120 }).join(
      '\n'
    )
    expect(out).toMatch(
      /By task — tokens\n {4}TASK +TOKENS +TITLE\n {4}LUM-497 +201\.2M tokens +reference-class anchors\n {6}claude-opus-5/
    )
  })

  it('renders nothing when the server sent neither rollup', () => {
    expect(milestoneMetricsLines({})).toEqual([])
  })
})

describe('formatMilestoneShow — Metrics section', () => {
  it('sits between Progress and the task table', () => {
    const out = formatMilestoneShow(
      {
        id: 'm-1',
        name: 'Q3',
        completedAt: null,
        startDate: null,
        targetDate: null,
        archivedAt: null,
        description: null,
        projectName: 'Lumo',
        taskCounts: { TODO: 1, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 1 },
        ...measured,
      },
      []
    )
    const progress = out.indexOf('\nProgress\n')
    const metrics = out.indexOf('\nMetrics\n')
    const tasks = out.indexOf('\nTasks (0)\n')
    expect(progress).toBeGreaterThan(-1)
    expect(metrics).toBeGreaterThan(progress)
    expect(tasks).toBeGreaterThan(metrics)
  })
})

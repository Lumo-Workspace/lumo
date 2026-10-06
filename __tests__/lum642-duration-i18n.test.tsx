/** @jest-environment jsdom */

/**
 * LUM-642 — 时长单位本地化统一.
 *
 * Pins the four contract criteria:
 *  1. the shared duration helper is byte-identical to the old per-component
 *     formatters in `en` and localizes units in `zh-CN`;
 *  2. the task-level cost read-out (the Record tab's Run report Cost tile —
 *     LUM-496 retired `CostSection` for it) and the milestone KPI
 *     (MilestoneMetricStrip) both render active time through it;
 *  3. the three TaskDetailTimeline cards render a localized relative-ago
 *     instead of the old hardcoded-English copies;
 *  4. the shared documents relative-time helper pins the unified <60s branch.
 *
 * react-intl ships ESM jest can't load (repo convention: mock it), so the
 * mock's formatMessage reads the REAL locale files — the keys asserted here
 * are the shipped translations, not test fixtures.
 */

import type { IntlShape } from 'react-intl'

// Minimal IntlShape stand-in backed by a real locale file.
const makeIntl = (locale: string, messages: Record<string, string>) =>
  ({
    locale,
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => {
      let msg = messages[id]
      if (msg === undefined) throw new Error(`missing i18n key: ${id}`)
      for (const [k, v] of Object.entries(values ?? {})) {
        msg = msg.replace(`{${k}}`, String(v))
      }
      return msg
    },
  }) as unknown as IntlShape

jest.mock('react-intl', () => {
  const zhMessages = jest.requireActual('@/lib/i18n/zh-CN.json')
  return {
    useIntl: () => ({
      locale: 'zh-CN',
      formatMessage: (
        { id }: { id: string },
        values?: Record<string, unknown>
      ) => {
        let msg = zhMessages[id] ?? id
        for (const [k, v] of Object.entries(values ?? {})) {
          msg = msg.replace(`{${k}}`, String(v))
        }
        return msg
      },
    }),
  }
})

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import en from '@/lib/i18n/en.json'
import zh from '@/lib/i18n/zh-CN.json'
import { formatDurationSec, formatDurationMs } from '@/lib/datetime/duration'
import { formatRelativeAgo, formatRelativeTime } from '@/lib/datetime/relative'
import { RunReportTiles } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/RunReportTiles'
import { deriveRunReportTiles } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/run-report-tiles'
import { MilestoneMetricStrip } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneMetricStrip'
import { SlackContextCard } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/SlackContextCard'
import { FigmaLinkCard } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/FigmaLinkCard'
import { WebLinkCard } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/WebLinkCard'
import type { TaskStatusView } from '@/app/workspace/[workspaceUrl]/types'
import type { SlackContextResource } from '@/lib/api-client/slack-contexts'
import type { OptimisticFigmaLink } from '@/app/workspace/[workspaceUrl]/hooks/useFigmaLinks'
import type { OptimisticWebLink } from '@/app/workspace/[workspaceUrl]/hooks/useWebLinks'

const enIntl = makeIntl('en', en as Record<string, string>)
const zhIntl = makeIntl('zh-CN', zh as Record<string, string>)

describe('lum642 duration helper', () => {
  it('lum642 duration helper keeps en output byte-identical and localizes zh units', () => {
    // en shapes are byte-identical to the retired fmtDuration / formatDuration.
    expect(formatDurationSec(enIntl, 8040)).toBe('2h 14m')
    expect(formatDurationSec(enIntl, 185)).toBe('3m 5s')
    expect(formatDurationSec(enIntl, 12)).toBe('12s')
    expect(formatDurationSec(enIntl, 0)).toBe('0s')
    expect(formatDurationSec(enIntl, 7200)).toBe('2h')
    expect(formatDurationMs(enIntl, 0)).toBe('0ms')
    expect(formatDurationMs(enIntl, 999)).toBe('999ms')
    expect(formatDurationMs(enIntl, 59_000)).toBe('59s')
    expect(formatDurationMs(enIntl, 120_000)).toBe('2m')
    expect(formatDurationMs(enIntl, 17_692_000)).toBe('294m 52s')

    // zh-CN rides the duration.* keys — no Latin unit suffixes.
    expect(formatDurationSec(zhIntl, 8040)).toBe('2 小时 14 分钟')
    expect(formatDurationSec(zhIntl, 185)).toBe('3 分钟 5 秒')
    expect(formatDurationSec(zhIntl, 0)).toBe('0 秒')
    expect(formatDurationMs(zhIntl, 999)).toBe('999 毫秒')
    expect(formatDurationMs(zhIntl, 17_692_000)).toBe('294 分钟 52 秒')
  })
})

describe('lum642 cost surfaces (zh-CN render)', () => {
  it('lum642 cost tile and milestone KPI render active time via the shared localized helper', () => {
    // Task-level cost read-out — the Run report's Cost KPI tile (LUM-496),
    // whose active-time sub-caption is the reading CostSection used to carry.
    const data: TaskStatusView = {
      version: 2,
      task: { id: 't1', identifier: 'LUM-1', title: 'x', status: 'DONE' },
      cost: { tokenCost: 12_000, activeTimeSec: 8040 },
      struggleTrail: { pullRequests: [], reopens: [] },
      trend: { cost: [], rework: { reopens: 0, extraPrCycles: 0, total: 0 } },
    }
    const cost = render(
      <RunReportTiles
        tiles={deriveRunReportTiles(data, { explicit: 0, inferred: 0 })}
      />
    )
    expect(cost.container.textContent).toContain('2 小时 14 分钟')
    cost.unmount()

    // Milestone metric chip — same seconds, same helper, tabular-nums cell.
    const { container } = render(
      <MilestoneMetricStrip
        costRollup={{
          tokenCost: 1_234_000,
          activeTimeSec: 8100,
          measuredTasks: 5,
          totalTasks: 8,
        }}
        deliveryStats={undefined}
      />
    )
    const kpi = screen.getByText('2 小时 15 分钟')
    expect(kpi).toBeInTheDocument()
    expect(kpi.className).toContain('tabular-nums')
    expect(container.textContent).not.toMatch(/\d+h \d+m/)
  })
})

describe('lum642 relative ago', () => {
  it('lum642 timeline cards render localized relative ago', async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString()

    const web = render(
      <WebLinkCard
        link={
          {
            id: 'w1',
            url: 'https://example.com/a',
            domain: 'example.com',
            createdAt: fiveMinAgo,
          } as unknown as OptimisticWebLink
        }
        onRefresh={async () => {}}
        onRemove={async () => {}}
      />
    )
    expect(await web.findByText(/5分钟前/)).toBeInTheDocument()
    web.unmount()

    const slack = render(
      <SlackContextCard
        context={
          {
            permalink: 'https://slack.com/x',
            slackChannelName: 'general',
            isThread: false,
            snapshotAt: fiveMinAgo,
            refreshError: null,
            snapshot: {
              messages: [{ userId: 'U1', userName: 'chao', text: 'hi' }],
            },
          } as unknown as SlackContextResource
        }
        onRefresh={async () => {}}
        onUnlink={async () => {}}
      />
    )
    expect(await slack.findByText(/5分钟前/)).toBeInTheDocument()
    slack.unmount()

    const figma = render(
      <FigmaLinkCard
        link={
          {
            id: 'f1',
            url: 'https://www.figma.com/file/abc',
            title: 'Design',
            lastSyncedAt: fiveMinAgo,
            loading: false,
            lastSyncError: null,
          } as unknown as OptimisticFigmaLink
        }
        onRemove={async () => {}}
      />
    )
    expect(await figma.findByText(/5分钟前/)).toBeInTheDocument()
    figma.unmount()

    // The helper itself: full zh ladder + the en shape unchanged.
    const now = Date.now()
    expect(formatRelativeAgo(zhIntl, new Date(now - 20_000), now)).toBe('刚刚')
    expect(formatRelativeAgo(zhIntl, new Date(now - 2 * 3_600_000), now)).toBe(
      '2小时前'
    )
    expect(formatRelativeAgo(zhIntl, new Date(now - 3 * 86_400_000), now)).toBe(
      '3天前'
    )
    expect(formatRelativeAgo(enIntl, new Date(now - 5 * 60_000), now)).toBe(
      '5m ago'
    )
    expect(formatRelativeAgo(enIntl, new Date(now - 2 * 3_600_000), now)).toBe(
      '2h ago'
    )
    expect(formatRelativeAgo(enIntl, new Date(now - 3 * 86_400_000), now)).toBe(
      '3d ago'
    )
  })

  it('lum642 shared relative time helper pins unified locale behavior', () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-07-02T12:00:00Z'))
    try {
      const at = (msBack: number) => new Date(Date.now() - msBack).toISOString()

      // Unified <60s branch: the "now"-style label on both surfaces.
      expect(formatRelativeTime(at(30_000), 'en')).toBe('now')
      expect(formatRelativeTime(at(30_000), 'zh-CN')).toBe('现在')

      expect(formatRelativeTime(at(5 * 60_000), 'en')).toBe('5 minutes ago')
      expect(formatRelativeTime(at(5 * 60_000), 'zh-CN')).toBe('5分钟前')
      expect(formatRelativeTime(at(3 * 3_600_000), 'zh-CN')).toBe('3小时前')
      expect(formatRelativeTime(at(2 * 86_400_000), 'en')).toBe('2 days ago')

      // Past a week: locale short date, not a relative label.
      expect(formatRelativeTime(at(10 * 86_400_000), 'en')).toBe('Jun 22')
    } finally {
      jest.useRealTimers()
    }
  })
})

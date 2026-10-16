/** @jest-environment jsdom */
/**
 * LUM-1188 — `lumo task runs` and the web run card, fed the SAME fixture,
 * show the same run number, tool calls, tokens, loops, summary and
 * attribution badge.
 */
jest.mock('@/app/workspace/[workspaceUrl]/components/AgentBadge', () => ({
  AgentBadge: () => null,
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/RunRawRecordDelete',
  () => ({ RunRawRecordDelete: () => null })
)

// react-intl ships ESM jest can't load; this stub renders defaultMessage with
// ICU plurals and formats numbers through the same Intl API react-intl uses.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      d: { id?: string; defaultMessage?: string },
      values?: Record<string, string | number>
    ) => {
      let s = d.defaultMessage ?? d.id ?? ''
      if (values) {
        s = s.replace(
          /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g,
          (_: string, key: string, one: string, other: string) => {
            const n = Number(values[key] ?? 0)
            return (n === 1 ? one : other).replace('#', String(n))
          }
        )
        for (const [k, v] of Object.entries(values)) {
          s = s.split(`{${k}}`).join(String(v))
        }
      }
      return s
    },
    formatNumber: (n: number, opts?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat('en', opts).format(n),
  }),
}))

import { render } from '@testing-library/react'
import { AgentRunCard } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunCard'
import type { AgentRunSession } from '@/app/workspace/[workspaceUrl]/types'
import { buildAgentRunReport } from '@/lib/services/agent-run-report.service'
import {
  formatRunReport,
  type RunReport,
} from '../../cli/src/commands/task-runs'
import { TIMELINE } from '../helpers/lum1188-agent-runs-timeline'

const cli = formatRunReport(
  'LUM-1188',
  buildAgentRunReport(TIMELINE, null) as unknown as RunReport
)

function webHeader(run: (typeof TIMELINE.runs)[number]): string {
  const { container, unmount } = render(
    <AgentRunCard run={run as unknown as AgentRunSession} />
  )
  const text = container.textContent ?? ''
  unmount()
  return text
}

describe.each(TIMELINE.runs.map(r => [r.runNumber, r] as const))(
  'run #%s',
  (n, run) => {
    it('web and CLI agree on number, tools, tokens, loops and badge', () => {
      const web = webHeader(run)
      expect(web).toContain(`Run #${n}`)
      expect(cli).toContain(`## Run #${n}`)

      const tools = `${run.toolCallCount} tool`
      expect(web).toContain(tools)
      expect(cli).toContain(tools)

      // Token cell: the web's per-model compact figures, e.g. "opus-4 453K".
      const tokenCell =
        run.cost!.byModel.length === 1
          ? `${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(run.cost!.byModel[0]!.total)} tok`
          : run
              .cost!.byModel.map(
                m =>
                  `${m.model.replace(/^claude-/, '')} ${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(m.total)}`
              )
              .join(' · ')
      expect(web).toContain(tokenCell)
      expect(cli).toContain(tokenCell)

      const loops = run.cost!.loopCount!
      expect(web).toContain(`${loops} loop`)
      expect(cli).toContain(`loops ${loops}`)

      const badge =
        run.attribution!.mode === 'EXPLICIT' ? 'Bound' : 'Auto-detected'
      expect(web).toContain(badge)
      expect(cli).toContain(badge)

      if (run.runSummary) {
        expect(web).toContain(run.runSummary)
        expect(cli).toContain(run.runSummary)
      }
    })
  }
)

it('the web marks the pre-dedupe run, and so does the CLI', () => {
  expect(webHeader(TIMELINE.runs[1]!)).toContain('≈2× overstated')
  expect(webHeader(TIMELINE.runs[0]!)).not.toContain('≈2× overstated')
  expect(cli).toContain('12K tok [≈2× overstated]')
})

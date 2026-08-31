import { render, screen } from '@testing-library/react'
import {
  DeliveryGatesPanel,
  gateDescLabel,
} from '@/app/workspace/[workspaceUrl]/components/DeliveryGatesPanel'
import type { DeliveryGateAudit } from '@/lib/services/gate-audit'
import { ALL_GATE_KEYS } from '../shared/src/gate-map'

const messages: Record<string, string> = {
  'gates.status.passed': 'passed',
  'gates.status.failed': 'failed',
  'gates.status.not_run': 'not run',
  'gates.status.not_configured': 'not configured',
  'gates.provenance.independent_harness': 'independent harness',
  'gates.provenance.agent_self_reported': 'agent self-reported',
  'gates.summary':
    '{total} gates · {passed} passed · {failed} failed · {notRun} not run · {notConfigured} not configured',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => {
      const tpl = messages[id] ?? id
      if (!values) return tpl
      return tpl.replace(/\{(\w+)\}/g, (_: string, k: string) =>
        String(values[k] ?? '')
      )
    },
  }),
}))

const AUDIT: DeliveryGateAudit = {
  gates: [
    // passed via an INDEPENDENT CI signal (LUM-616) — reads "independent harness".
    {
      key: 'typecheck',
      status: 'passed',
      provenance: 'independent_harness',
      grounding: {
        pointer: 'cmd:typecheck#exit=0',
        hookEvent: 'github_check',
        at: '2026-06-29T10:00:00.000Z',
        detailsUrl: 'https://ci.example/run/1',
      },
    },
    {
      key: 'test',
      status: 'failed',
      provenance: 'agent_self_reported',
      grounding: {
        pointer: 'cmd:npm test#exit=1',
        hookEvent: 'POST_TOOL_USE_FAILURE',
        at: '2026-06-27T10:05:00.000Z',
      },
    },
    {
      key: 'build',
      status: 'not_run',
      provenance: 'agent_self_reported',
      grounding: null,
    },
  ],
}

function row(container: HTMLElement, key: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-gate-key="${key}"]`)
  if (!el) throw new Error(`row for gate "${key}" not found`)
  return el
}

describe('DeliveryGatesPanel', () => {
  it('honest states and provenance', () => {
    const { container } = render(<DeliveryGatesPanel audit={AUDIT} />)

    // The header text block (title + audit tag + guardrail lines) is gone
    // (LUM-729) — the panel opens straight with the summary line.
    expect(screen.queryByText('Mechanical gates')).not.toBeInTheDocument()
    expect(screen.queryByText('audit')).not.toBeInTheDocument()
    expect(
      screen.queryByText(
        'Verifies that checks ran, not that the work is correct'
      )
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Adjudication lives in the acceptance tab')
    ).not.toBeInTheDocument()
    // The intl mock falls back to the raw id for unmapped keys — assert the
    // ids are absent too, so a lingering formatMessage call can't hide.
    expect(
      screen.queryByText(/gates\.(title|auditTag|guardrail)/)
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/3 gates · 1 passed · 1 failed/)
    ).toBeInTheDocument()

    // not_run carries its own honest status and is NEVER shown with the passed
    // affordance — distinct data-status + distinct label.
    const buildRow = row(container, 'build')
    expect(buildRow.dataset.status).toBe('not_run')
    expect(buildRow.textContent).toContain('not run')
    expect(buildRow.textContent).not.toContain('passed')

    // passed / failed / not_run are visually/semantically distinct.
    const distinctStatuses = new Set([
      row(container, 'typecheck').dataset.status, // passed
      row(container, 'test').dataset.status, // failed
      row(container, 'build').dataset.status, // not_run
    ])
    expect(distinctStatuses.size).toBe(3)

    // Provenance label follows the SIGNAL SOURCE, not the class (LUM-616): a row
    // carried by an independent CI signal reads "independent harness"; a row from
    // the agent's own run reads "agent self-reported".
    expect(row(container, 'typecheck').textContent).toContain(
      'independent harness'
    )
    for (const key of ['test', 'build']) {
      expect(row(container, key).textContent).toContain('agent self-reported')
    }
  })

  it('renders a compact grounding (command + exit) and truncates long commands', () => {
    const longCmd = `lumo task create "${'x'.repeat(300)}"`
    const audit: DeliveryGateAudit = {
      gates: [
        {
          key: 'typecheck',
          status: 'passed',
          provenance: 'agent_self_reported',
          grounding: {
            pointer: 'cmd:tsc --noEmit#exit=0',
            hookEvent: 'POST_TOOL_USE',
            at: 'T',
          },
        },
        {
          key: 'test',
          status: 'failed',
          provenance: 'agent_self_reported',
          grounding: {
            pointer: `cmd:${longCmd}#exit=1`,
            hookEvent: 'POST_TOOL_USE_FAILURE',
            at: 'T',
          },
        },
        {
          key: 'build',
          status: 'not_run',
          provenance: 'agent_self_reported',
          grounding: null,
        },
      ],
    }
    const { container } = render(<DeliveryGatesPanel audit={audit} />)

    // Compact form: command + exit, not the raw cmd:…#exit= grammar.
    const tc = row(container, 'typecheck').textContent ?? ''
    expect(tc).toContain('tsc --noEmit')
    expect(tc).toContain('exit 0')
    expect(tc).not.toContain('cmd:')
    expect(tc).not.toContain('#exit=')

    // A pathologically long command is truncated, never dumped in full.
    const t = row(container, 'test').textContent ?? ''
    expect(t).not.toContain(longCmd)
    expect(t).toContain('…')
    expect(t).toContain('exit 1')

    // not_run rows show no grounding at all.
    expect(row(container, 'build').textContent).not.toContain('exit ')
  })
})

describe('gateDescLabel', () => {
  // intl that echoes the message id, so we can assert wiring without rendering.
  const echoIntl = { formatMessage: ({ id }: { id: string }) => id } as never

  it('gives every gate key a distinct gates.desc.* hint', () => {
    const ids = ALL_GATE_KEYS.map(k => gateDescLabel(k, echoIntl))
    expect(ids.every(id => id.startsWith('gates.desc.'))).toBe(true)
    expect(new Set(ids).size).toBe(ALL_GATE_KEYS.length)
  })
})

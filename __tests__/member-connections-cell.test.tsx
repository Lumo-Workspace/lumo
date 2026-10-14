/** @jest-environment jsdom */
/**
 * LUM-1136 — the members table's Connection cell. react-intl is mocked with
 * the real en copy so the rendered text is what the app shows.
 */
const mockEn: Record<string, string> = require('@/lib/i18n/en.json')

jest.mock('react-intl', () => ({
  useIntl: () => mockIntl,
}))
const mockIntl = {
  locale: 'en',
  formatMessage: ({ id }: { id: string }, values?: Record<string, unknown>) => {
    let msg = mockEn[id] ?? id
    for (const [k, v] of Object.entries(values ?? {})) {
      msg = msg.split(`{${k}}`).join(String(v))
    }
    return msg
  },
}

import { render, screen } from '@testing-library/react'
import {
  MemberConnectionsCell,
  skillVersionLabel,
} from '@/app/workspace/[workspaceUrl]/components/members/MemberConnectionsCell'
import type { MemberConnectionView } from '@/lib/services/member-connection.service'
import type { IntlShape } from 'react-intl'

const NOW = Date.parse('2026-10-14T12:00:00Z')
const conn = (p: Partial<MemberConnectionView> = {}): MemberConnectionView => ({
  agent: 'CLAUDE_CODE',
  cliVersion: '1.121.0',
  skillVersion: '1.121.0',
  lastSeenAt: '2026-10-14T10:00:00Z',
  cliBehind: false,
  skillBehind: false,
  ...p,
})

describe('MemberConnectionsCell', () => {
  it('shows a dash, not "Not connected", while loading or after a failed request', () => {
    render(<MemberConnectionsCell connections={undefined} unknown now={NOW} />)
    expect(screen.queryByText('Not connected')).toBeNull()
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('shows "Not connected" for a member with no connections', () => {
    render(
      <MemberConnectionsCell
        connections={undefined}
        unknown={false}
        now={NOW}
      />
    )
    expect(screen.getByText('Not connected')).toBeTruthy()
  })

  it('renders one line per agent with CLI and skill versions', () => {
    const { container } = render(
      <MemberConnectionsCell
        connections={[conn(), conn({ agent: 'CODEX', skillVersion: 'source' })]}
        unknown={false}
        now={NOW}
      />
    )
    const text = container.textContent ?? ''
    expect(text).toContain('Claude Code · 2h ago')
    expect(text).toContain('CLI 1.121.0 · skill 1.121.0')
    expect(text).toContain('Codex')
    expect(text).toContain('skill from source')
  })

  it('shows the agent logo chip', () => {
    const { container } = render(
      <MemberConnectionsCell
        connections={[conn({ agent: 'CODEX' })]}
        unknown={false}
        now={NOW}
      />
    )
    const chip = container.querySelector('[aria-hidden] svg')
    expect(chip).not.toBeNull()
  })

  it('marks behind versions with a hint', () => {
    render(
      <MemberConnectionsCell
        connections={[
          conn({
            cliVersion: '1.100.0',
            skillVersion: '1.99.0',
            cliBehind: true,
            skillBehind: true,
          }),
        ]}
        unknown={false}
        now={NOW}
      />
    )
    const marks = screen.getAllByText(/\(behind\)/)
    expect(marks).toHaveLength(2)
    expect(marks[0]?.getAttribute('title')).toContain('lumo update')
    expect(marks[1]?.getAttribute('title')).toContain('lumo skill update')
  })

  it('an old CLI that reported nothing shows "CLI version unknown"', () => {
    render(
      <MemberConnectionsCell
        connections={[conn({ cliVersion: null, skillVersion: null })]}
        unknown={false}
        now={NOW}
      />
    )
    expect(screen.getByText('CLI version unknown')).toBeTruthy()
  })
})

describe('skillVersionLabel', () => {
  const intl = mockIntl as unknown as IntlShape
  it.each([
    ['1.2.3', 'skill 1.2.3'],
    ['1.2.3 modified', 'skill 1.2.3 (modified)'],
    ['modified', 'skill (modified)'],
    ['source', 'skill from source'],
    ['none', 'no skill installed'],
  ])('%s → %s', (v, label) => expect(skillVersionLabel(intl, v)).toBe(label))
  it('null → null', () => expect(skillVersionLabel(intl, null)).toBeNull())
})

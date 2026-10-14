/** @jest-environment jsdom */
/**
 * LUM-1136 — the members table's connection UI: Agents cell, version status,
 * expanded details, update banner and filter tabs. react-intl is mocked with
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
    // Minimal ICU plural support for the banner title.
    msg = msg.replace(
      /\{(\w+), plural, one \{([^}]*)\} other \{([^}]*)\}\}/,
      (_m, k: string, one: string, other: string) =>
        (values?.[k] === 1 ? one : other).split('#').join(String(values?.[k]))
    )
    for (const [k, v] of Object.entries(values ?? {})) {
      msg = msg.split(`{${k}}`).join(String(v))
    }
    return msg
  },
}

import { fireEvent, render, screen } from '@testing-library/react'
import {
  MemberConnectionsCell,
  skillVersionLabel,
} from '@/app/workspace/[workspaceUrl]/components/members/MemberConnectionsCell'
import { MemberVersionStatus } from '@/app/workspace/[workspaceUrl]/components/members/MemberVersionStatus'
import { MemberConnectionDetails } from '@/app/workspace/[workspaceUrl]/components/members/MemberConnectionDetails'
import { ConnectionUpdateBanner } from '@/app/workspace/[workspaceUrl]/components/members/ConnectionUpdateBanner'
import { MemberFilterTabs } from '@/app/workspace/[workspaceUrl]/components/members/MemberFilterTabs'
import type { MemberConnectionView } from '@/lib/services/member-connection.service'
import type { IntlShape } from 'react-intl'

const NOW = Date.parse('2026-10-14T12:00:00Z')
const conn = (p: Partial<MemberConnectionView> = {}): MemberConnectionView => ({
  agent: 'CLAUDE_CODE',
  cliVersion: '1.121.0',
  skillVersion: '1.121.0',
  lastSeenAt: '2026-10-14T10:00:00Z',
  stale: false,
  cliBehind: false,
  skillBehind: false,
  ...p,
})

describe('MemberConnectionsCell (Agents column)', () => {
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

  it('renders one chip per agent with its last-seen time and no versions', () => {
    const { container } = render(
      <MemberConnectionsCell
        connections={[conn(), conn({ agent: 'CODEX', skillVersion: 'source' })]}
        unknown={false}
        now={NOW}
      />
    )
    const text = container.textContent ?? ''
    expect(text).toContain('Claude Code')
    expect(text).toContain('2h ago')
    expect(text).toContain('Codex')
    expect(text).not.toContain('CLI 1.121.0')
    expect(container.querySelectorAll('[aria-hidden] svg')).toHaveLength(2)
  })
})

describe('MemberVersionStatus', () => {
  const statusOf = (container: HTMLElement) =>
    container.querySelector('[data-status]')?.getAttribute('data-status')

  it('dash while connections are unknown', () => {
    render(
      <MemberVersionStatus
        connections={undefined}
        latestCliVersion='1.121.0'
        unknown
      />
    )
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('CLI behind → "Update available" with from → to', () => {
    const { container } = render(
      <MemberVersionStatus
        connections={[conn({ cliVersion: '1.118.2', cliBehind: true })]}
        latestCliVersion='1.121.0'
        unknown={false}
      />
    )
    expect(statusOf(container)).toBe('needsUpdate')
    expect(screen.getByText('Update available')).toBeTruthy()
    expect(screen.getByText('CLI 1.118.2 → 1.121.0')).toBeTruthy()
  })

  it('only the skill behind → skill detail', () => {
    render(
      <MemberVersionStatus
        connections={[conn({ skillBehind: true })]}
        latestCliVersion='1.121.0'
        unknown={false}
      />
    )
    expect(screen.getByText('Skill behind its CLI')).toBeTruthy()
  })

  it('CLI behind with the latest version unknown names the CLI, not the skill', () => {
    render(
      <MemberVersionStatus
        connections={[conn({ cliVersion: '1.118.2', cliBehind: true })]}
        latestCliVersion={null}
        unknown={false}
      />
    )
    expect(screen.getByText('CLI 1.118.2')).toBeTruthy()
    expect(screen.queryByText('Skill behind its CLI')).toBeNull()
  })

  it('up to date shows the CLI in use', () => {
    render(
      <MemberVersionStatus
        connections={[conn()]}
        latestCliVersion='1.121.0'
        unknown={false}
      />
    )
    expect(screen.getByText('Up to date')).toBeTruthy()
    expect(screen.getByText('CLI 1.121.0')).toBeTruthy()
  })

  it('unreported CLI → "Version unknown"; none → "Not connected"', () => {
    const { container, rerender } = render(
      <MemberVersionStatus
        connections={[conn({ cliVersion: null })]}
        latestCliVersion='1.121.0'
        unknown={false}
      />
    )
    expect(statusOf(container)).toBe('unknown')
    rerender(
      <MemberVersionStatus
        connections={[]}
        latestCliVersion='1.121.0'
        unknown={false}
      />
    )
    expect(statusOf(container)).toBe('notConnected')
    expect(screen.getByText('Not connected')).toBeTruthy()
  })
})

describe('MemberVersionStatus — stale connections', () => {
  it('only stale → "Not seen recently" with the last CLI seen', () => {
    const { container } = render(
      <MemberVersionStatus
        connections={[conn({ stale: true })]}
        latestCliVersion='1.122.0'
        unknown={false}
      />
    )
    expect(
      container.querySelector('[data-status]')?.getAttribute('data-status')
    ).toBe('stale')
    expect(screen.getByText('Not seen recently')).toBeTruthy()
    expect(screen.getByText('Last seen on CLI 1.121.0')).toBeTruthy()
  })

  it('a fresh connection sets the status and the CLI shown, not a stale one', () => {
    render(
      <MemberVersionStatus
        connections={[
          conn({ agent: 'CODEX', stale: true, cliVersion: '1.119.0' }),
          conn({ cliVersion: '1.122.0' }),
        ]}
        latestCliVersion='1.122.0'
        unknown={false}
      />
    )
    expect(screen.getByText('Up to date')).toBeTruthy()
    expect(screen.getByText('CLI 1.122.0')).toBeTruthy()
  })
})

describe('MemberConnectionDetails', () => {
  it('a stale card tags its versions "as of last seen" and offers no fix', () => {
    render(
      <MemberConnectionDetails
        connections={[conn({ stale: true })]}
        now={NOW}
      />
    )
    expect(screen.getByText('as of last seen')).toBeTruthy()
    expect(screen.queryByText('latest')).toBeNull()
    expect(screen.queryByText('To update, run:')).toBeNull()
  })

  it('one card per connection with versions, tags and the fix command', () => {
    const { container } = render(
      <MemberConnectionDetails
        connections={[
          conn(),
          conn({
            agent: 'CODEX',
            cliVersion: '1.118.2',
            skillVersion: '1.118.2 modified',
            cliBehind: true,
          }),
        ]}
        now={NOW}
      />
    )
    const text = container.textContent ?? ''
    expect(text).toContain('Last seen 2h ago')
    expect(text).toContain('CLI 1.121.0')
    expect(text).toContain('latest')
    expect(text).toContain('skill 1.118.2 (modified)')
    expect(screen.getAllByText('behind')).toHaveLength(1)
    expect(screen.getByText('lumo update')).toBeTruthy()
  })

  it('skill behind → lumo skill update; current → no command', () => {
    const { rerender } = render(
      <MemberConnectionDetails
        connections={[conn({ skillBehind: true })]}
        now={NOW}
      />
    )
    expect(screen.getByText('lumo skill update')).toBeTruthy()
    rerender(<MemberConnectionDetails connections={[conn()]} now={NOW} />)
    expect(screen.queryByText('To update, run:')).toBeNull()
  })

  it('no connections → setup commands', () => {
    render(<MemberConnectionDetails connections={[]} now={NOW} />)
    expect(screen.getByText('npm install -g @lumoai/cli')).toBeTruthy()
    expect(screen.getByText('lumo init')).toBeTruthy()
  })
})

describe('ConnectionUpdateBanner', () => {
  it('pluralizes the count and wires both actions', () => {
    const onShowWho = jest.fn()
    const onDismiss = jest.fn()
    const { rerender } = render(
      <ConnectionUpdateBanner
        count={2}
        onShowWho={onShowWho}
        onDismiss={onDismiss}
      />
    )
    expect(screen.getByText('2 agent connections need an update.')).toBeTruthy()
    fireEvent.click(screen.getByText('Show who'))
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(onShowWho).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
    rerender(
      <ConnectionUpdateBanner
        count={1}
        onShowWho={onShowWho}
        onDismiss={onDismiss}
      />
    )
    expect(screen.getByText('1 agent connection needs an update.')).toBeTruthy()
  })
})

describe('MemberFilterTabs', () => {
  it('marks the active tab, shows known counts and reports clicks', () => {
    const onChange = jest.fn()
    render(
      <MemberFilterTabs
        value='all'
        counts={{ all: 4, needsUpdate: 2 }}
        onChange={onChange}
      />
    )
    const all = screen.getByRole('button', { name: /All/ })
    expect(all.getAttribute('aria-pressed')).toBe('true')
    expect(all.textContent).toBe('All4')
    expect(
      screen.getByRole('button', { name: /Not connected/ }).textContent
    ).toBe('Not connected')
    fireEvent.click(screen.getByRole('button', { name: /Needs update/ }))
    expect(onChange).toHaveBeenCalledWith('needsUpdate')
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

/** @jest-environment jsdom */

/**
 * Mock react-intl to avoid the untranspiled-ESM transform issue under jest.
 * formatMessage returns the message id so tests can assert on i18n key output.
 * For the localized label test we seed the map with the real en value.
 */
const enMessages: Record<string, string> = {
  'taskArtifact.agent.CLAUDE_CODE': 'Claude Code',
  'taskArtifact.agent.CODEX': 'Codex',
  'taskArtifact.agent.CURSOR': 'Cursor',
  'taskArtifact.agent.GEMINI_CLI': 'Gemini CLI',
  'taskArtifact.agent.GITHUB_COPILOT': 'GitHub Copilot',
  'taskArtifact.agent.WINDSURF': 'Windsurf',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => enMessages[id] ?? id,
  }),
}))

import { render } from '@testing-library/react'
import {
  AGENT_META,
  AgentBadge,
} from '@/app/workspace/[workspaceUrl]/components/AgentBadge'
import { TaskArtifactAgent } from '@prisma/client'

describe('AgentBadge', () => {
  it('has metadata (Icon + color) for every enum value', () => {
    for (const value of Object.values(TaskArtifactAgent)) {
      expect(AGENT_META[value]).toBeDefined()
      expect(AGENT_META[value].Icon).toBeDefined()
      expect(typeof AGENT_META[value].color).toBe('string')
    }
  })

  it('renders the localized label', () => {
    const { getByText } = render(<AgentBadge agent={TaskArtifactAgent.CODEX} />)
    // ignore the <title> inside the SVG brand glyph, which also reads "Codex"
    expect(getByText('Codex', { ignore: 'title' })).toBeInTheDocument()
  })

  it('falls back to Claude Code for an unknown agent value', () => {
    // @ts-expect-error — intentionally passing a value outside the enum
    const { getByText } = render(<AgentBadge agent={'BOGUS'} />)
    expect(getByText('Claude Code')).toBeInTheDocument()
  })
})

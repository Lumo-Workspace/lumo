/** @jest-environment jsdom */

const en: Record<string, string> = {
  'memory.category.trap': 'Trap',
  'memory.category.decision': 'Decision',
  'memory.category.convention': 'Convention',
  'memory.category.procedural': 'Procedure',
  'memory.section.trigger': 'Trigger',
  'memory.section.outcome': 'Outcome',
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
    formatMessage: ({ id }: { id: string }, values?: Record<string, unknown>) =>
      (en[id] ?? id).replace(/\{(\w+)\}/g, (_, k) => String(values?.[k] ?? '')),
  }),
}))

import { render, screen } from '@testing-library/react'
import { MemoryCard } from '@/app/workspace/[workspaceUrl]/components/memory/MemoryCard'

it('renders the agent badge in the default (sedimented) branch', () => {
  render(
    <MemoryCard
      item={{
        id: 'm1',
        category: 'TRAP',
        agent: 'CLAUDE_CODE',
        content: { trigger: 't', outcome: 'o' },
      }}
    />
  )
  expect(screen.getByText('Claude Code')).toBeInTheDocument()
})

it('renders agent badge for a different agent', () => {
  render(
    <MemoryCard
      item={{
        id: 'm2',
        category: 'DECISION',
        agent: 'CURSOR',
        content: { what: 'w', why: 'y' },
      }}
    />
  )
  expect(screen.getByText('Cursor', { ignore: 'title' })).toBeInTheDocument()
})

it('renders the source prop instead of agent badge when source is provided', () => {
  render(
    <MemoryCard
      item={{
        id: 'm3',
        category: 'TRAP',
        agent: 'CLAUDE_CODE',
        content: { trigger: 't', outcome: 'o' },
      }}
      source='By Alice'
    />
  )
  expect(screen.getByText('By Alice')).toBeInTheDocument()
  expect(screen.queryByText('Claude Code')).not.toBeInTheDocument()
})

it('renders nothing in the top-right when showSedimentedLabel is false', () => {
  render(
    <MemoryCard
      item={{
        id: 'm4',
        category: 'TRAP',
        agent: 'CLAUDE_CODE',
        content: { trigger: 't', outcome: 'o' },
      }}
      showSedimentedLabel={false}
    />
  )
  expect(screen.queryByText('Claude Code')).not.toBeInTheDocument()
})

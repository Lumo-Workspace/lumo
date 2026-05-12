jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@ai-sdk/gateway', () => ({ gateway: jest.fn() }))

import { buildLumoProposalPrompt } from '@/lib/llm/lumo-proposal-client'

describe('buildLumoProposalPrompt', () => {
  it('includes task title, description, and memories in prompt', () => {
    const prompt = buildLumoProposalPrompt(
      {
        id: 'task-1',
        title: 'Fix auth bug',
        description: 'Users cannot login with SSO',
        taskIdentifier: 'LUM-42',
      },
      [
        {
          id: 'm1',
          category: 'TRAP',
          content: { summary: 'SSO callback URL must use HTTPS in production' },
        },
        {
          id: 'm2',
          category: 'DECISION',
          content: { summary: 'Use Clerk for all auth flows' },
        },
      ],
      '# LUMO.md\n\n## Traps\n\n## Decisions\n'
    )

    expect(prompt).toContain('LUM-42')
    expect(prompt).toContain('Fix auth bug')
    expect(prompt).toContain('Users cannot login with SSO')
    expect(prompt).toContain('SSO callback URL must use HTTPS in production')
    expect(prompt).toContain('Use Clerk for all auth flows')
    expect(prompt).toContain('TRAP')
    expect(prompt).toContain('DECISION')
    expect(prompt).toContain('# LUMO.md')
  })

  it('handles empty LUMO.md', () => {
    const prompt = buildLumoProposalPrompt(
      {
        id: 'task-1',
        title: 'Test',
        description: null,
        taskIdentifier: 'LUM-1',
      },
      [],
      ''
    )

    expect(prompt).toContain('LUM-1')
    expect(prompt).toContain('(empty — no LUMO.md exists yet)')
  })

  it('handles null description', () => {
    const prompt = buildLumoProposalPrompt(
      {
        id: 'task-1',
        title: 'Test',
        description: null,
        taskIdentifier: 'LUM-1',
      },
      [
        {
          id: 'm1',
          category: 'CONVENTION',
          content: { summary: 'Always use async/await' },
        },
      ],
      ''
    )

    expect(prompt).toContain('(no description)')
  })
})

/** @jest-environment node */
jest.mock('@/lib/repositories/idea-slack-context.repository', () => ({
  ideaSlackContextRepository: {
    listByIdea: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/idea-web-link.repository', () => ({
  ideaWebLinkRepository: {
    listByIdea: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/idea-figma-link.repository', () => ({
  ideaFigmaLinkRepository: {
    listByIdea: jest.fn(),
  },
}))

import { summariseIdeaEvidence } from '@/lib/services/idea-evidence-summary'
import { ideaSlackContextRepository } from '@/lib/repositories/idea-slack-context.repository'
import { ideaWebLinkRepository } from '@/lib/repositories/idea-web-link.repository'
import { ideaFigmaLinkRepository } from '@/lib/repositories/idea-figma-link.repository'

const listSlack = ideaSlackContextRepository.listByIdea as jest.Mock
const listWeb = ideaWebLinkRepository.listByIdea as jest.Mock
const listFigma = ideaFigmaLinkRepository.listByIdea as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('summariseIdeaEvidence', () => {
  it('summarises all three channels when all are present', async () => {
    listSlack.mockResolvedValue([
      {
        slackChannelName: 'design',
        slackChannelId: 'C1',
        snapshot: { messages: [{ ts: '1' }, { ts: '2' }, { ts: '3' }] },
      },
    ])
    listWeb.mockResolvedValue([
      { title: 'WCAG contrast guide', domain: 'w3.org' },
      { title: null, domain: 'example.com' },
    ])
    listFigma.mockResolvedValue([
      { fileName: 'Design File', frameName: 'Cover' },
      { fileName: 'Other File', frameName: null },
    ])

    const summary = await summariseIdeaEvidence('idea1')

    expect(summary.slack).toEqual(['slack: 3 msg(s) in #design'])
    expect(summary.web).toEqual([
      'web: WCAG contrast guide',
      'web: example.com',
    ])
    expect(summary.figma).toEqual([
      'figma: Design File · Cover',
      'figma: Other File',
    ])
    expect(summary.sourceCount).toBe(5)
    expect(summary.channels).toEqual(['slack', 'web', 'figma'])
  })

  it('returns an empty summary when no evidence is attached', async () => {
    listSlack.mockResolvedValue([])
    listWeb.mockResolvedValue([])
    listFigma.mockResolvedValue([])

    const summary = await summariseIdeaEvidence('idea2')

    expect(summary).toEqual({
      slack: [],
      web: [],
      figma: [],
      sourceCount: 0,
      channels: [],
    })
  })

  it('handles a partial mix (only web attached)', async () => {
    listSlack.mockResolvedValue([])
    listWeb.mockResolvedValue([{ title: 'Some Article', domain: 'blog.com' }])
    listFigma.mockResolvedValue([])

    const summary = await summariseIdeaEvidence('idea3')

    expect(summary.slack).toEqual([])
    expect(summary.web).toEqual(['web: Some Article'])
    expect(summary.figma).toEqual([])
    expect(summary.sourceCount).toBe(1)
    expect(summary.channels).toEqual(['web'])
  })

  it('falls back to the channel id when slackChannelName is null', async () => {
    listSlack.mockResolvedValue([
      {
        slackChannelName: null,
        slackChannelId: 'C99',
        snapshot: { messages: [{ ts: '1' }] },
      },
    ])
    listWeb.mockResolvedValue([])
    listFigma.mockResolvedValue([])

    const summary = await summariseIdeaEvidence('idea4')

    expect(summary.slack).toEqual(['slack: 1 msg(s) in #C99'])
  })
})

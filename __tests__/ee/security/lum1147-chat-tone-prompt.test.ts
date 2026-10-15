/**
 * @jest-environment node
 *
 * LUM-1147 — the PR chat prompt with a tone, and where the tone comes from:
 * `.lumo.yaml` on the PR's base commit > the stored setting > none.
 */
jest.mock('ai', () => ({ generateText: jest.fn() }))
jest.mock('@/lib/ai/gateway', () => ({ gateway: (id: string) => ({ id }) }))
jest.mock('@/ee/security/repositories/repo-review-setting.repository', () => ({
  repoReviewSettingRepository: { findReviewStyle: jest.fn() },
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrBase: jest.fn(),
  readRepoFile: jest.fn(),
}))
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { generateText } from 'ai'
import {
  answerPrQuestion,
  buildPrChatPrompt,
  prChatSystemPrompt,
  PR_CHAT_SYSTEM_PROMPT,
  type PrChatPromptInput,
} from '@/ee/security/llm/pr-chat-client'
import {
  clearRepoConfigCache,
  repoConfigService,
} from '@/ee/security/services/repo-config.service'
import { repoReviewSettingRepository } from '@/ee/security/repositories/repo-review-setting.repository'
import { fetchPrBase, readRepoFile } from '@/lib/integrations/github/contents'

const gen = generateText as jest.Mock
const findStyle = repoReviewSettingRepository.findReviewStyle as jest.Mock
const BASE = 'b'.repeat(40)

const INPUT: PrChatPromptInput = {
  repo: 'o/r',
  prNumber: 7,
  headSha: null,
  finding: null,
  focus: null,
  question: { text: 'Why?', notices: [] },
  diff: { text: '+a', notices: [], truncated: false },
  file: { text: '', notices: [] },
  hunk: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  clearRepoConfigCache()
  ;(fetchPrBase as jest.Mock).mockResolvedValue({ ref: 'main', sha: BASE })
  ;(readRepoFile as jest.Mock).mockResolvedValue(null)
  findStyle.mockResolvedValue(null)
})

describe('LUM-1147 chat prompt', () => {
  it('without a tone the prompt is unchanged', () => {
    expect(prChatSystemPrompt('')).toBe(PR_CHAT_SYSTEM_PROMPT)
    expect(buildPrChatPrompt(INPUT)).not.toContain('repository-tone')
  })

  it('a tone is fenced last and announced as wording only', async () => {
    gen.mockResolvedValue({ text: 'ok' })
    await answerPrQuestion({ ...INPUT, tone: 'Be brief' })
    const call = gen.mock.calls[0]![0]
    expect(call.system).toContain('changes wording only')
    expect(
      call.prompt.endsWith('<repository-tone>\nBe brief\n</repository-tone>')
    ).toBe(true)
  })
})

describe('LUM-1147 toneForPullRequest', () => {
  const at = { workspaceId: 'ws', repo: 'O/R', prNumber: 7 }

  it('the base-commit file wins over the stored tone', async () => {
    findStyle.mockResolvedValue({ toneInstructions: 'Stored tone' })
    ;(readRepoFile as jest.Mock).mockResolvedValue(
      'tone_instructions: File tone\n'
    )
    await expect(repoConfigService.toneForPullRequest(at)).resolves.toBe(
      'File tone'
    )
    expect(findStyle).toHaveBeenCalledWith('ws', 'o/r')
    expect(readRepoFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: '.lumo.yaml', ref: BASE })
    )
  })

  it('no file key → the stored tone; nothing → null', async () => {
    findStyle.mockResolvedValue({ toneInstructions: 'Stored tone' })
    await expect(repoConfigService.toneForPullRequest(at)).resolves.toBe(
      'Stored tone'
    )
    findStyle.mockResolvedValue(null)
    await expect(repoConfigService.toneForPullRequest(at)).resolves.toBeNull()
  })

  it('never throws: an unreadable base or settings read falls back', async () => {
    findStyle.mockRejectedValue(new Error('db'))
    ;(fetchPrBase as jest.Mock).mockRejectedValue(new Error('404'))
    await expect(repoConfigService.toneForPullRequest(at)).resolves.toBeNull()
  })
})

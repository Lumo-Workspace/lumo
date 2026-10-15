/**
 * @jest-environment node
 *
 * LUM-1147 — the repository's tone is applied to PR chat answers as well as
 * to the AI review: the chat prompt carries it (fenced, wording only), and
 * it resolves base-commit `.lumo.yaml` > stored setting > none.
 */
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('tok'),
}))
jest.mock('@/lib/integrations/github/collaborator-access', () => ({
  checkRepositoryWriteAccess: jest.fn(),
}))
jest.mock('@/lib/integrations/github/pr-comment-client', () => ({
  prCommentClient: {
    createReviewLineReply: jest.fn().mockResolvedValue({}),
    createIssueComment: jest.fn().mockResolvedValue({}),
  },
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrHeadSha: jest.fn(),
  fetchPrDiff: jest.fn(),
  readRepoFile: jest.fn(),
}))
jest.mock('@/ee/security/repositories/pr-chat-request.repository', () => ({
  prChatRequestRepository: {
    claim: jest.fn(),
    countSince: jest.fn(),
    setStatus: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('@/ee/security/llm/pr-chat-client', () => ({
  answerPrQuestion: jest.fn(),
}))
jest.mock('@/ee/security/services/repo-config.service', () => ({
  repoConfigService: { toneForPullRequest: jest.fn() },
}))

import {
  answerQuestion,
  type ChatQuestion,
} from '@/ee/security/services/pr-chat.service'
import { checkRepositoryWriteAccess } from '@/lib/integrations/github/collaborator-access'
import {
  fetchPrDiff,
  fetchPrHeadSha,
  readRepoFile,
} from '@/lib/integrations/github/contents'
import { prChatRequestRepository } from '@/ee/security/repositories/pr-chat-request.repository'
import { answerPrQuestion } from '@/ee/security/llm/pr-chat-client'

const access = checkRepositoryWriteAccess as jest.Mock
const claim = prChatRequestRepository.claim as jest.Mock
const countSince = prChatRequestRepository.countSince as jest.Mock
const model = answerPrQuestion as jest.Mock

const DIFF = [
  'diff --git a/src/db.ts b/src/db.ts',
  '--- a/src/db.ts',
  '+++ b/src/db.ts',
  '@@ -1,2 +1,2 @@',
  '-const q = sql`select * from t where id = ${id}`',
  '+const q = "select * from t where id = " + id',
  '',
].join('\n')

const FILE =
  'import { db } from "./x"\nconst q = "select * from t where id = " + id\nexport { q }'

let posted: string[]
function question(over: Partial<ChatQuestion> = {}): ChatQuestion {
  return {
    workspaceId: 'ws',
    pullRequestId: 'pr1',
    repo: 'o/r',
    prNumber: 7,
    source: 'review',
    commentId: 900,
    login: 'alice',
    body: 'Why is this unsafe?',
    focus: {
      path: 'src/db.ts',
      line: 2,
      diffHunk: '@@ -1,2 +1,2 @@\n+const q',
    },
    finding: null,
    blockingFindingId: null,
    marker: '<!-- marker -->',
    post: async body => {
      posted.push(body)
    },
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  posted = []
  process.env.GITHUB_APP_SLUG = 'uselumo'
  access.mockResolvedValue('write')
  claim.mockResolvedValue({ id: 'c1' })
  countSince.mockResolvedValue(1)
  ;(fetchPrHeadSha as jest.Mock).mockResolvedValue('abcdef1234567890')
  ;(fetchPrDiff as jest.Mock).mockResolvedValue(DIFF)
  ;(readRepoFile as jest.Mock).mockResolvedValue(FILE)
  model.mockResolvedValue(
    'String concatenation puts `id` straight into the SQL text, so a crafted id can change the query. Use a parameter:\n```ts\ndb.query("select * from t where id = $1", [id])\n```'
  )
})

import { repoConfigService } from '@/ee/security/services/repo-config.service'

const toneFor = repoConfigService.toneForPullRequest as jest.Mock

describe('LUM-1147 tone in PR chat', () => {
  it('the answer request carries the repository tone', async () => {
    toneFor.mockResolvedValue('Be friendly and brief')
    await expect(answerQuestion(question())).resolves.toBe('answered')
    expect(toneFor).toHaveBeenCalledWith({
      workspaceId: 'ws',
      repo: 'o/r',
      prNumber: 7,
    })
    expect(model.mock.calls[0][0].tone).toBe('Be friendly and brief')
  })

  it('no tone (or a failed read) leaves the request without one', async () => {
    toneFor.mockResolvedValue(null)
    await answerQuestion(question())
    expect(model.mock.calls[0][0]).not.toHaveProperty('tone')
    model.mockClear()
    toneFor.mockRejectedValue(new Error('db down'))
    await expect(answerQuestion(question({ commentId: 901 }))).resolves.toBe(
      'answered'
    )
    expect(model.mock.calls[0][0]).not.toHaveProperty('tone')
  })
})

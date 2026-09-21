/**
 * LUM-801: PullRequest.headSha —— test run 陈旧性判定的前提。
 *
 * 一条 TestCaseRun 记下自己跑的 commitSha；要判断它是否已经过时，必须拿它和
 * PR 的**当前** head 比。`PullRequest` 此前没有这一列（只有合并时才写的
 * mergeCommitSha），所以本组测试锁两件事：
 *
 *   1. 调用方给了 sha 时，create 与 update 两条路径都要写进去；
 *   2. 调用方**没有** sha 时，update 里不能出现这个 key —— 否则一个
 *      check_suite 之类不带 PR head 的事件会把已记录的 sha 抹成 null，
 *      陈旧性判定随之永久退化成 unknown。
 *
 * 第 2 条照抄同文件里 mergeCommitSha 既有的条件展开约定。
 */
import { githubRepository } from '@/lib/repositories/github.repository'

const upsert = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: { pullRequest: { upsert: (...args: unknown[]) => upsert(...args) } },
}))

const SHA = 'a'.repeat(40)

const base = {
  workspaceId: 'w-1',
  taskId: 't-1',
  integrationId: null,
  repo: 'acme/app',
  number: 123,
  title: 'Fix the footer',
  url: 'https://github.com/acme/app/pull/123',
  state: 'open',
  authorLogin: 'someone',
  headBranch: 'lumo/LUM-1-footer',
  baseBranch: 'main',
  isDraft: false,
  mergedAt: null,
  closedAt: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  upsert.mockResolvedValue({ id: 'pr-1' })
})

describe('upsertPullRequest headSha', () => {
  it('writes headSha on create when the caller supplies it', async () => {
    await githubRepository.upsertPullRequest({ ...base, headSha: SHA })

    const arg = upsert.mock.calls[0]![0] as {
      create: Record<string, unknown>
      update: Record<string, unknown>
    }
    expect(arg.create.headSha).toBe(SHA)
  })

  it('writes headSha on update when the caller supplies it', async () => {
    await githubRepository.upsertPullRequest({ ...base, headSha: SHA })

    const arg = upsert.mock.calls[0]![0] as {
      create: Record<string, unknown>
      update: Record<string, unknown>
    }
    expect(arg.update.headSha).toBe(SHA)
  })

  it('omits headSha from the update when the caller has none — never nulls a recorded sha', async () => {
    await githubRepository.upsertPullRequest({ ...base })

    const arg = upsert.mock.calls[0]![0] as {
      create: Record<string, unknown>
      update: Record<string, unknown>
    }
    expect('headSha' in arg.update).toBe(false)
  })

  it('creates with a null headSha when the caller has none', async () => {
    await githubRepository.upsertPullRequest({ ...base })

    const arg = upsert.mock.calls[0]![0] as {
      create: Record<string, unknown>
      update: Record<string, unknown>
    }
    expect(arg.create.headSha).toBeNull()
  })
})

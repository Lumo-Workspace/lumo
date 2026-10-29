/**
 * @jest-environment node
 *
 * LUM-1318 — provider-neutral Git platform events. The GitHub webhook keeps
 * emitting `github.*`; each one is also delivered as its `git.*` twin with
 * `provider: 'github'`, so a plugin listens on the neutral name and a second
 * platform's webhook emits `git.*` directly. Nothing is persisted.
 */
import type { LumoServerPlugin } from '@/lib/plugins/types'

const seen: Array<[string, unknown]> = []
const plugin: LumoServerPlugin = {
  id: 'probe',
  register(api) {
    api.on('github.push', p => void seen.push(['github.push', p]))
    api.on('git.push', p => void seen.push(['git.push', p]))
    api.on('git.issueComment', p => void seen.push(['git.issueComment', p]))
    api.on('git.reviewComment', p => void seen.push(['git.reviewComment', p]))
    api.on('git.reviewThread', p => void seen.push(['git.reviewThread', p]))
    api.on('git.pullRequest', p => void seen.push(['git.pullRequest', p]))
    api.on('task.prLinked', p => void seen.push(['task.prLinked', p]))
  },
}

jest.mock('@/lib/plugins/installed', () => ({
  get INSTALLED_SERVER_PLUGINS() {
    return [plugin]
  },
}))

import { GITHUB_TO_GIT_EVENT, emitCoreEvent } from '@/lib/plugins/events'

beforeEach(() => {
  seen.length = 0
})

const PUSH = {
  workspaceId: 'w1',
  repo: 'o/r',
  branch: 'main',
  isDefaultBranch: true,
  headSha: 'a'.repeat(40),
}

describe('git.* events', () => {
  it('a github.* event reaches its own handlers unchanged, then the git.* twin with provider github', () => {
    emitCoreEvent('github.push', PUSH)
    expect(seen).toEqual([
      ['github.push', PUSH],
      ['git.push', { ...PUSH, provider: 'github' }],
    ])
  })

  it('maps every GitHub webhook event to a neutral name', () => {
    expect(GITHUB_TO_GIT_EVENT).toEqual({
      'github.pullRequest': 'git.pullRequest',
      'github.push': 'git.push',
      'github.reviewThread': 'git.reviewThread',
      'github.issueComment': 'git.issueComment',
      'github.reviewComment': 'git.reviewComment',
    })
  })

  it.each(Object.entries(GITHUB_TO_GIT_EVENT))(
    '%s is delivered as %s with provider github',
    (github, git) => {
      const payload = { probe: github } as never
      emitCoreEvent(github as 'github.push', payload)
      const twin = seen.filter(([name]) => name === git)
      expect(twin).toEqual([[git, { probe: github, provider: 'github' }]])
    }
  )

  it('a git.* event from another platform keeps its provider and is not echoed under github.*', () => {
    emitCoreEvent('git.push', { ...PUSH, provider: 'codeup' })
    expect(seen).toEqual([['git.push', { ...PUSH, provider: 'codeup' }]])
  })

  it('a non-Git event is delivered once', () => {
    emitCoreEvent('task.prLinked', { taskId: 't', pullRequestId: 'p' })
    expect(seen).toEqual([
      ['task.prLinked', { taskId: 't', pullRequestId: 'p' }],
    ])
  })
})

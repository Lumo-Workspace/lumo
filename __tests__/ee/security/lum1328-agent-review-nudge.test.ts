/**
 * @jest-environment node
 *
 * LUM-1328 — `lumo task status` nudges toward the developer's own agent
 * review: an open PR whose head has no imported Claude Code / Codex review
 * gets an advisory AGENT_REVIEW_MISSING next action, worded for whether
 * Lumo's own AI review is on. A clean import (zero findings) counts.
 */
const layers = jest.fn()
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  loadSecurityLayers: (...a: unknown[]) => layers(...a),
}))
const confirmedRepos = jest.fn()
jest.mock('@/lib/integrations/github/confirmed-repositories', () => ({
  loadConfirmedRepositories: (...a: unknown[]) => confirmedRepos(...a),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: { findLatestByPullRequestIds: jest.fn() },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {},
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { findManyForSecurityByTaskId: jest.fn() },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {},
}))
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: {
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
    findSecurityBaseline: jest.fn().mockResolvedValue(null),
  },
}))

import {
  hasAgentReviewOnHead,
  prSecurityReminderService,
} from '@/ee/security/services/pr-security-reminder.service'
import {
  agentReviewStatement,
  securityTaskStatusSection,
} from '@/ee/security/task-status'
import { resolveSecurityLayers } from '@/ee/security/security-scan/workspace-switches'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import {
  formatTaskStatus,
  pushAgentReviewActions,
  splitNextActions,
  type TaskStatusResponse,
} from '@/cli/src/commands/task-status'

const latest = prSecurityScanRepository.findLatestByPullRequestIds as jest.Mock
const prs = pullRequestRepository.findManyForSecurityByTaskId as jest.Mock

const HEAD = 'abcdef0123456'
const scan = (over: object = {}) => ({
  id: 's1',
  pullRequestId: 'pr1',
  taskId: 't-1',
  workspaceId: 'ws',
  headSha: HEAD,
  status: 'CLEAN',
  trigger: 'PR_EVENT',
  judgeStatus: null,
  truncated: false,
  stages: null,
  partial: false,
  detectorVersion: 'secrets@1',
  error: null,
  startedAt: new Date('2026-10-28T00:00:00Z'),
  finishedAt: new Date('2026-10-28T00:01:00Z'),
  agentNotifiedAt: null,
  agentReviewTools: [] as string[],
  findings: [],
  ...over,
})
const pr = (over: object = {}) => ({
  id: 'pr1',
  number: 12,
  title: 'PR',
  url: 'https://github.com/o/r/pull/12',
  state: 'open',
  headSha: HEAD,
  repo: 'o/r',
  mergedAt: null,
  workspaceId: 'ws',
  ...over,
})
const switches = (over: object = {}) =>
  resolveSecurityLayers({ securityScanEnabled: true, ...over })

beforeEach(() => {
  jest.clearAllMocks()
  layers.mockResolvedValue(switches())
  confirmedRepos.mockResolvedValue((repo: string) =>
    repo === 'o/r' ? repo : null
  )
})

describe('hasAgentReviewOnHead', () => {
  it('true only for an import on the PR head (a clean import counts)', () => {
    expect(
      hasAgentReviewOnHead(scan({ agentReviewTools: ['codex'] }), HEAD)
    ).toBe(true)
    expect(hasAgentReviewOnHead(scan(), HEAD)).toBe(false)
    expect(hasAgentReviewOnHead(undefined, HEAD)).toBe(false)
  })
  it('an import on an older head does not count; an unknown PR head trusts the latest scan', () => {
    const imported = scan({ agentReviewTools: ['claude-code'] })
    expect(hasAgentReviewOnHead(imported, 'newer000')).toBe(false)
    expect(hasAgentReviewOnHead(imported, null)).toBe(true)
  })
  it('an old row without the column reads as no import', () => {
    const { agentReviewTools: _drop, ...old } = scan()
    expect(hasAgentReviewOnHead(old as never, HEAD)).toBe(false)
  })
})

describe('loadOpenFindingsForTask — agentReviewMissing', () => {
  it('lists an open PR with no import, and reports whether Lumo AI review is on', async () => {
    prs.mockResolvedValue([pr()])
    latest.mockResolvedValue([scan()])
    const s = await prSecurityReminderService.loadOpenFindingsForTask('t-1')
    expect(s.agentReviewMissing).toEqual([12])
    expect(s.lumoAiReviewOn).toBe(false)

    layers.mockResolvedValue(switches({ securityAiReviewEnabled: true }))
    const on = await prSecurityReminderService.loadOpenFindingsForTask('t-1')
    expect(on.agentReviewMissing).toEqual([12])
    expect(on.lumoAiReviewOn).toBe(true)
  })
  it('a PR with no scan yet is still nudged', async () => {
    prs.mockResolvedValue([pr()])
    latest.mockResolvedValue([])
    const s = await prSecurityReminderService.loadOpenFindingsForTask('t-1')
    expect(s.agentReviewMissing).toEqual([12])
  })
  it('an imported head, a closed / merged PR and scanning off are not nudged', async () => {
    prs.mockResolvedValue([
      pr(),
      pr({ id: 'pr2', number: 13, state: 'merged' }),
      pr({ id: 'pr3', number: 14, state: 'closed' }),
    ])
    latest.mockResolvedValue([
      scan({ agentReviewTools: ['codex'] }),
      scan({ id: 's2', pullRequestId: 'pr2' }),
      scan({ id: 's3', pullRequestId: 'pr3' }),
    ])
    const s = await prSecurityReminderService.loadOpenFindingsForTask('t-1')
    expect(s.agentReviewMissing).toEqual([])

    prs.mockResolvedValue([pr()])
    latest.mockResolvedValue([scan()])
    layers.mockResolvedValue(switches({ securityScanEnabled: false }))
    const off = await prSecurityReminderService.loadOpenFindingsForTask('t-1')
    expect(off.agentReviewMissing).toEqual([])
  })
})

describe('loadOpenFindingsForTask — repositories an import would be refused for', () => {
  it('a PR in a repository not confirmed in the workspace is not nudged', async () => {
    prs.mockResolvedValue([pr({ repo: 'o/unconfirmed' })])
    latest.mockResolvedValue([])
    const s = await prSecurityReminderService.loadOpenFindingsForTask('t-1')
    expect(s.agentReviewMissing).toEqual([])
  })
  it('a failed confirmed-list read nudges for none and keeps the rest of the read', async () => {
    prs.mockResolvedValue([pr()])
    latest.mockResolvedValue([scan()])
    confirmedRepos.mockRejectedValue(new Error('db down'))
    const s = await prSecurityReminderService.loadOpenFindingsForTask('t-1')
    expect(s.agentReviewMissing).toEqual([])
    expect(s.scans).toHaveLength(1)
  })
  it('the confirmed list is not read when no PR needs a nudge', async () => {
    prs.mockResolvedValue([pr({ state: 'merged' })])
    latest.mockResolvedValue([scan()])
    await prSecurityReminderService.loadOpenFindingsForTask('t-1')
    expect(confirmedRepos).not.toHaveBeenCalled()
  })
})

describe('securityTaskStatusSection — AGENT_REVIEW_MISSING', () => {
  it('adds one advisory row per PR, after the findings, with the import command', async () => {
    prs.mockResolvedValue([pr()])
    latest.mockResolvedValue([scan()])
    const { nextActions } = await securityTaskStatusSection('t-1')
    expect(nextActions).toEqual([
      {
        kind: 'AGENT_REVIEW_MISSING',
        prNumber: 12,
        lumoAiReviewOn: false,
        statement: agentReviewStatement(12, false),
        command: 'lumo security import <file>',
        advisory: true,
      },
    ])
  })
  it('the wording says Lumo review is on and the agent review is an extra', () => {
    expect(agentReviewStatement(12, true)).toBe(
      "PR #12 has no agent security review on its latest commit. Lumo's AI review is on for this workspace, so an agent review is an extra: run /security-review in Claude Code or a Codex review, write its findings to a file and import it"
    )
    expect(agentReviewStatement(12, false)).toBe(
      "PR #12 has no security review on its latest commit (Lumo's AI review is off for this workspace): run /security-review in Claude Code or a Codex review, write its findings to a file and import it"
    )
  })
})

describe('CLI rendering', () => {
  it('prints the row as [SECURITY REVIEW] with the command on its own line', () => {
    const lines: string[] = []
    pushAgentReviewActions(
      lines,
      [
        {
          kind: 'AGENT_REVIEW_MISSING',
          prNumber: 12,
          lumoAiReviewOn: false,
          statement: 'PR #12 has no security review',
          command: 'lumo security import <file>',
          advisory: true,
        },
      ],
      { width: 200 }
    )
    expect(lines).toEqual([
      '  • [SECURITY REVIEW] PR #12 has no security review (advisory) — run:',
      '    lumo security import <file>',
    ])
  })

  it('keeps agent-review rows out of the test-case bucket and leads the advisory section with them', () => {
    const row = {
      kind: 'AGENT_REVIEW_MISSING' as const,
      prNumber: 12,
      lumoAiReviewOn: true,
      statement: 'PR #12 has no agent security review',
      command: 'lumo security import <file>',
      advisory: true as const,
    }
    const testCase = {
      kind: 'TEST_CASE' as const,
      statement: 'no test case recorded yet',
      command: 'lumo task testcase add',
      advisory: true as const,
    }
    const split = splitNextActions([testCase, row])
    expect(split.agentReview).toEqual([row])
    expect(split.testCase).toEqual([testCase])
    const out = formatTaskStatus(
      {
        version: 2,
        task: { id: 't', identifier: 'LUM-1', title: 'x', status: 'IN_REVIEW' },
        nextActions: [testCase, row],
      } as unknown as TaskStatusResponse,
      { width: 200 }
    )
    expect(out).toContain('Next actions (advisory only)')
    expect(out.indexOf('[SECURITY REVIEW]')).toBeLessThan(
      out.indexOf('[TEST CASE]')
    )
  })
})

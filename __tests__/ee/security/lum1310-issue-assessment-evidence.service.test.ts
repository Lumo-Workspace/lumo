/**
 * @jest-environment node
 *
 * LUM-1310 — the issue assessment's evidence through the services: the
 * linked task's test-case runs on the PR head and the bounded repository
 * search are gathered as context (each dropped alone when its read fails —
 * the check itself still runs), the search reads the head archive once with
 * one installation token, and both reach the model as fenced material.
 */
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDetails: jest.fn(),
  readPrTemplate: jest.fn(),
  fetchPrDiff: jest.fn(),
  fetchRepoVisibility: jest.fn(),
  fetchRepoIssues: jest.fn(),
  withRepoReadToken: jest.fn(),
  streamRepoTarballWithToken: jest.fn(),
}))
jest.mock('@/ee/security/llm/pre-merge-checks-client', () => ({
  runPreMergeChecksModel: jest.fn(),
}))
jest.mock('@/ee/security/repositories/repo-review-setting.repository', () => ({
  repoReviewSettingRepository: { findSettings: jest.fn() },
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    setPreMergeChecks: jest.fn(),
    findPreMergeChecks: jest.fn(),
    findLatestChecksTarget: jest.fn(),
  },
}))
jest.mock('@/ee/security/services/repo-config.service', () => ({
  repoConfigService: { fileForDecision: jest.fn() },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { findById: jest.fn(), listMergedByTask: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findForRequirements: jest.fn() },
}))
jest.mock('@/lib/repositories/task-decision.repository', () => ({
  taskDecisionRepository: { listByTask: jest.fn() },
}))
jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: { listForEvidence: jest.fn() },
}))
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { gzipSync } from 'node:zlib'
import { preMergeChecksService } from '@/ee/security/services/pre-merge-checks.service'
import { linkedRequirementsService } from '@/ee/security/services/linked-requirements.service'
import { repoAbsenceSearchService } from '@/ee/security/services/repo-absence-search.service'
import {
  fetchPrDetails,
  fetchRepoIssues,
  fetchRepoVisibility,
  readPrTemplate,
  streamRepoTarballWithToken,
  withRepoReadToken,
} from '@/lib/integrations/github/contents'
import { runPreMergeChecksModel } from '@/ee/security/llm/pre-merge-checks-client'
import { repoReviewSettingRepository } from '@/ee/security/repositories/repo-review-setting.repository'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { repoConfigService } from '@/ee/security/services/repo-config.service'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { taskDecisionRepository } from '@/lib/repositories/task-decision.repository'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'
import { logger } from '@/lib/logger'
import { DEFAULT_REPO_REVIEW_SETTING } from '@/ee/security/security-scan/auto-review-policy'
import {
  parsePreMergeChecksSetting,
  type PreMergeCheckGatherInput,
} from '@/ee/security/security-scan/pre-merge-checks'
import { ISSUE_ASSESSMENT_CHECK_ID } from '@/ee/security/security-scan/issue-assessment'

const HEAD = '0e803ed8417e8dbdbbdf067b3eb75fbf80832a4c'
const listCases = testCaseRepository.listForEvidence as jest.Mock
const stream = streamRepoTarballWithToken as jest.Mock
const withToken = withRepoReadToken as jest.Mock
const model = runPreMergeChecksModel as jest.Mock

// LUM-1309's shape: a browser requirement and a repo-wide absence claim.
const TASK = {
  number: 1309,
  title: 'Skeletons',
  description:
    '<h2>Done when</h2><ul><li><p>No block-level visible loading text left under <code>app/</code> (grep <code>common.loading</code> only hits sr-only labels).</p></li><li><p>My Tasks shows skeletons in the browser.</p></li></ul>',
  team: { identifier: 'LUM' },
}

const PASS_AT_HEAD = {
  result: 'PASS',
  environment: 'LOCAL',
  commitSha: HEAD.slice(0, 7),
  commitDirty: null,
  stepResults: [
    {
      phase: 'STEPS',
      index: 0,
      text: 'open: My Tasks while loading',
      status: 'PASS',
    },
  ],
  evidence: [{ type: 'file', filename: 'mytasks-list.jpg' }],
  unprovenVerification: [],
}

/** A gzipped tar of the given files under GitHub's archive directory. */
function tarball(files: Record<string, string>): Buffer {
  const parts: Buffer[] = []
  for (const [path, body] of Object.entries(files)) {
    const h = Buffer.alloc(512)
    h.write(`acme-app-0e803ed/${path}`, 0, 100)
    h.write(`${Buffer.byteLength(body).toString(8).padStart(11, '0')}\0`, 124)
    h.write('0', 156)
    const data = Buffer.from(body)
    parts.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  parts.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(parts))
}

function archiveOf(files: Record<string, string>) {
  stream.mockImplementation(async (opts: { onChunk: (b: Buffer) => void }) => {
    const { gunzipSync } = await import('node:zlib')
    const raw = gunzipSync(tarball(files))
    opts.onChunk(raw)
    return { complete: true, bytes: raw.length, stop: 'end' }
  })
}

const input = (): PreMergeCheckGatherInput => ({
  workspaceId: 'w1',
  repo: 'acme/app',
  prNumber: 1695,
  pullRequestId: 'pr1',
  baseSha: null,
  headSha: HEAD,
  pr: {
    title: 't',
    body: 'Verified in the browser; jest is green.',
    template: null,
  },
  setting: {
    ...parsePreMergeChecksSetting(null),
    issueAssessment: { mode: 'warning', taskDetailsOnPublicRepos: false },
  },
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(pullRequestRepository.findById as jest.Mock).mockResolvedValue({
    id: 'pr1',
    taskId: 't1',
  })
  ;(pullRequestRepository.listMergedByTask as jest.Mock).mockResolvedValue([])
  ;(taskRepository.findForRequirements as jest.Mock).mockResolvedValue(TASK)
  ;(taskDecisionRepository.listByTask as jest.Mock).mockResolvedValue([])
  ;(fetchRepoVisibility as jest.Mock).mockResolvedValue('private')
  ;(fetchRepoIssues as jest.Mock).mockResolvedValue([])
  withToken.mockImplementation(
    async (_o: unknown, fn: (t: string) => unknown) => fn('tok')
  )
  listCases.mockResolvedValue([
    {
      number: 2,
      title: 'My Tasks skeleton',
      expected: 'Skeletons',
      requiredEnvironment: null,
      runs: [PASS_AT_HEAD],
    },
    {
      number: 7,
      title: 'Older browser run',
      expected: 'x',
      requiredEnvironment: null,
      runs: [{ ...PASS_AT_HEAD, commitSha: '350c9dd' }],
    },
  ])
  archiveOf({
    'app/AsyncContent.tsx':
      "<span className='sr-only'>{t('common.loading')}</span>\n",
    'app/ok.tsx': 'nothing\n',
    'lib/other.ts': "t('common.loading')\n",
  })
})

describe('gathering the evidence', () => {
  it("the task's runs on the head, and one search of the head for the absence claim", async () => {
    const { requirements, context } =
      await linkedRequirementsService.gather(input())
    expect(requirements.map(r => r.id)).toEqual(['task:done:1', 'task:done:2'])
    expect(listCases).toHaveBeenCalledWith('t1', 20)
    expect(context!.testCases).toEqual({
      atHead: [
        expect.objectContaining({
          number: 2,
          effective: 'PASS',
          files: ['mytasks-list.jpg'],
        }),
      ],
      withoutHeadRun: [7],
      notRead: [],
    })
    expect(withToken).toHaveBeenCalledTimes(1)
    expect(withToken).toHaveBeenCalledWith(
      { workspaceId: 'w1', fullName: 'acme/app' },
      expect.any(Function)
    )
    expect(stream).toHaveBeenCalledTimes(1)
    expect(stream.mock.calls[0]![0]).toMatchObject({
      token: 'tok',
      fullName: 'acme/app',
      ref: HEAD,
    })
    const search = context!.repoSearch!
    expect(search.complete).toBe(true)
    // `lib/other.ts` is outside the requirement's `app/` scope.
    expect(search.results).toEqual([
      expect.objectContaining({
        requirementId: 'task:done:1',
        needles: ['common.loading'],
        scopes: ['app/'],
        hitCount: 1,
        fileCount: 1,
      }),
    ])
  })

  it('no absence claim ⇒ no archive read at all', async () => {
    ;(taskRepository.findForRequirements as jest.Mock).mockResolvedValue({
      ...TASK,
      description:
        '<h2>Done when</h2><ul><li><p>My Tasks shows skeletons in the browser.</p></li></ul>',
    })
    const { context } = await linkedRequirementsService.gather(input())
    expect(context!.repoSearch).toBeUndefined()
    expect(withToken).not.toHaveBeenCalled()
    expect(stream).not.toHaveBeenCalled()
  })

  it('unreadable test-case runs drop only them (also a synchronous throw)', async () => {
    listCases.mockImplementation(() => {
      throw new Error('db down')
    })
    const gathered = await linkedRequirementsService.gather(input())
    expect(gathered.requirements).toHaveLength(2)
    expect(gathered.context!.testCases).toBeUndefined()
    expect(gathered.context!.repoSearch).toBeDefined()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('test-case runs unreadable task=t1')
    )
  })

  it('a failed archive read (or token refusal) drops only the search', async () => {
    withToken.mockRejectedValue(
      Object.assign(new Error('repo_not_confirmed'), { status: 403 })
    )
    const gathered = await linkedRequirementsService.gather(input())
    expect(gathered.requirements).toHaveLength(2)
    expect(gathered.context!.repoSearch).toBeUndefined()
    expect(gathered.context!.testCases).toBeDefined()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('repository search failed repo=acme/app')
    )
  })

  it("an issue's absence claim is searched too, with no task linked", async () => {
    ;(pullRequestRepository.findById as jest.Mock).mockResolvedValue({
      id: 'pr1',
      taskId: null,
    })
    ;(fetchRepoIssues as jest.Mock).mockResolvedValue([
      {
        number: 5,
        title: 'Drop the old flag',
        body: 'No `common.loading` left anywhere in the codebase.',
      },
    ])
    const gathered = await linkedRequirementsService.gather({
      ...input(),
      pr: { title: 't', body: 'Closes #5', template: null },
    })
    expect(listCases).not.toHaveBeenCalled()
    expect(gathered.context).toEqual({
      decisions: [],
      mergedPrCount: 0,
      mergedPrs: [],
      repoSearch: expect.objectContaining({
        results: [
          expect.objectContaining({
            requirementId: 'issue:5',
            scopes: [],
            hitCount: 2,
          }),
        ],
      }),
    })
  })
})

describe('the search service on its own', () => {
  it('no queries ⇒ undefined, nothing minted or read', async () => {
    expect(
      await repoAbsenceSearchService.search({
        workspaceId: 'w1',
        repo: 'acme/app',
        headSha: HEAD,
        queries: [],
      })
    ).toBeUndefined()
    expect(withToken).not.toHaveBeenCalled()
  })

  it('an archive that ends without its end block is reported as truncated, not complete', async () => {
    stream.mockImplementation(
      async (opts: { onChunk: (b: Buffer) => void }) => {
        const { gunzipSync } = await import('node:zlib')
        const raw = gunzipSync(tarball({ 'app/a.ts': 'x\n' }))
        opts.onChunk(raw.subarray(0, raw.length - 1024)) // end blocks cut off
        return { complete: true, bytes: raw.length - 1024, stop: 'end' }
      }
    )
    const r = await repoAbsenceSearchService.search({
      workspaceId: 'w1',
      repo: 'acme/app',
      headSha: HEAD,
      queries: [{ requirementId: 'x', needles: ['abc'], scopes: [] }],
    })
    expect(r).toMatchObject({ complete: false, stop: 'truncated' })
  })

  it('a cut read is reported as cut', async () => {
    stream.mockResolvedValue({ complete: false, bytes: 1, stop: 'time' })
    const r = await repoAbsenceSearchService.search({
      workspaceId: 'w1',
      repo: 'acme/app',
      headSha: HEAD,
      queries: [{ requirementId: 'x', needles: ['abc'], scopes: [] }],
    })
    expect(r).toMatchObject({ complete: false, stop: 'time' })
  })
})

describe('through the runner', () => {
  beforeEach(() => {
    ;(fetchPrDetails as jest.Mock).mockResolvedValue({
      title: 'feat: skeletons',
      body: 'Verified in the browser.',
      authorLogin: 'bob',
      state: 'open',
      headSha: HEAD,
      baseRef: 'main',
      baseSha: 'b'.repeat(40),
      requestedReviewers: [],
    })
    ;(readPrTemplate as jest.Mock).mockResolvedValue(null)
    ;(repoConfigService.fileForDecision as jest.Mock).mockResolvedValue(null)
    ;(
      prSecurityScanRepository.findPreMergeChecks as jest.Mock
    ).mockResolvedValue(null)
    ;(repoReviewSettingRepository.findSettings as jest.Mock).mockResolvedValue([
      {
        workspaceId: 'w1',
        ...DEFAULT_REPO_REVIEW_SETTING,
        preMergeChecks: {
          ...parsePreMergeChecksSetting(null),
          title: { mode: 'off', requirements: null },
          description: { mode: 'off' },
          issueAssessment: { mode: 'warning', taskDetailsOnPublicRepos: false },
        },
      },
    ])
    model.mockImplementation(async (i: { checks: Array<{ id: string }> }) => ({
      results: i.checks.map(c => ({
        id: c.id,
        verdict: 'passed',
        explanation: '',
        resolution: '',
        requirements: [
          {
            id: 'task:done:1',
            outcome: 'addressed',
            explanation: 'The head search found only the sr-only label.',
          },
          {
            id: 'task:done:2',
            outcome: 'addressed',
            explanation: 'TC2 passed on this head with a screenshot.',
          },
        ],
      })),
    }))
  })

  it('a screenshot requirement the model calls addressed without a head screenshot is reported Unclear', async () => {
    ;(taskRepository.findForRequirements as jest.Mock).mockResolvedValue({
      ...TASK,
      description:
        '<h2>Done when</h2><ul><li><p>No block-level visible loading text left under <code>app/</code> (grep <code>common.loading</code> only hits sr-only labels).</p></li><li><p>Screenshot of My Tasks from a real browser.</p></li></ul>',
    })
    listCases.mockResolvedValue([
      {
        number: 2,
        title: 'Unit tests',
        expected: 'pass',
        requiredEnvironment: null,
        runs: [
          {
            ...PASS_AT_HEAD,
            evidence: [{ type: 'file', filename: 'jest.json' }],
          },
        ],
      },
    ])
    const record = await preMergeChecksService.run(
      {
        scanId: 's1',
        pullRequestId: 'pr1',
        workspaceId: 'w1',
        repo: 'acme/app',
        prNumber: 1695,
        headSha: HEAD,
      },
      'diff --git a/app/x.tsx b/app/x.tsx\n'
    )
    const r = record!.results.find(x => x.id === ISSUE_ASSESSMENT_CHECK_ID)!
    expect(r.requirements!.map(x => [x.id, x.outcome])).toEqual([
      ['task:done:1', 'addressed'],
      ['task:done:2', 'unclear'],
    ])
    expect(r.verdict).toBe('inconclusive')
  })

  it('the runs and the hits reach the model as material, and the check can pass', async () => {
    const diff =
      'diff --git a/app/x.tsx b/app/x.tsx\n--- a/app/x.tsx\n+++ b/app/x.tsx\n@@ -0,0 +1 @@\n+x\n'
    const record = await preMergeChecksService.run(
      {
        scanId: 's1',
        pullRequestId: 'pr1',
        workspaceId: 'w1',
        repo: 'acme/app',
        prNumber: 1695,
        headSha: HEAD,
      },
      diff
    )
    const material: string = model.mock.calls[0]![0].checks[0].material
    expect(material).toContain('- TC2 "My Tasks skeleton" — PASS in LOCAL.')
    expect(material).toContain(
      'No run on this head (runs on older commits do not count): TC7.'
    )
    expect(material).toContain(
      '[task:done:1] searched `common.loading` in app/: 1 matching line in 1 file.'
    )
    expect(material).toContain(
      "app/AsyncContent.tsx:1: ‹span className='sr-only'›{t('common.loading')}‹/span›"
    )
    expect(model.mock.calls[0]![0].checks[0].rule).toContain(
      'Claims in the pull request description are never evidence:'
    )
    const r = record!.results.find(x => x.id === ISSUE_ASSESSMENT_CHECK_ID)!
    expect(r.verdict).toBe('passed')
  })
})

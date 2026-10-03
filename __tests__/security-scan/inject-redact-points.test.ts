/**
 * @jest-environment node
 *
 * LUM-784 criterion 1 — the RED LINE. For every rule in the secret registry,
 * a synthetic secret is pushed through each covered injection point and the
 * RENDERED / INJECTED output is asserted on the real render function:
 *
 *   (a) the raw value never appears — not in the block, not in a marker, not
 *       in a JSON body the CLI will print;
 *   (b) the content is still injected (never dropped), in redacted form;
 *   (c) a notice at the block head (or an inline marker on a one-line render)
 *       names the redacted count.
 *
 * Points, as the task lists them: task-context memory + linked group
 * (`wrapUntrustedMemory`, `wrapUntrustedLinked`, `wrapUntrustedLinkedGroup`),
 * the steward milestone-memory section, the security agent-reminder, the
 * three hunt prompt clients
 * (task context → plan prompt, hunt task header, compressor prompt), the
 * tier-2 Slack-snapshot and web-body routes (task + idea) and the LLM-judge
 * diff input of the PR security scan.
 */
// LUM-866: every workspace here has the default switches (all on); the
// platform env in each test still decides the ceiling.
jest.mock('@/lib/services/security-workspace-switches.service', () => ({
  // A plain function, not jest.fn: survives resetAllMocks.
  loadSecurityLayers: async () =>
    jest
      .requireActual('@/lib/security-scan/workspace-switches')
      .resolveSecurityLayers(null),
}))
jest.mock('ai', () => ({ generateText: jest.fn(), generateObject: jest.fn() }))
jest.mock('@/lib/ai/gateway', () => ({ gateway: (id: string) => ({ id }) }))

// ── steward section deps ────────────────────────────────────────────────────
const mockFindMilestone = jest.fn()
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: {
    findById: (...a: unknown[]) => mockFindMilestone(...a),
  },
}))
const mockFindMsMemories = jest.fn()
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveMilestoneScopeMemoriesByProject: (...a: unknown[]) =>
      mockFindMsMemories(...a),
  },
}))

// ── tier-2 route deps (same harness as __tests__/app/api/tasks/retrieval) ──
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
const mockSlackGetById = jest.fn()
const mockIdeaSlackGetById = jest.fn()
const mockFindByWorkspaceIdentifier = jest.fn()
jest.mock('@/lib/repositories', () => ({
  taskRepository: {
    findByIdForMention: jest.fn(),
    findByWorkspaceIdentifier: (...a: unknown[]) =>
      mockFindByWorkspaceIdentifier(...a),
  },
  taskSlackContextRepository: {
    getById: (...a: unknown[]) => mockSlackGetById(...a),
  },
  ideaSlackContextRepository: {
    getById: (...a: unknown[]) => mockIdeaSlackGetById(...a),
  },
}))
const mockFetchBody = jest.fn()
jest.mock('@/lib/services/task-web-link.service', () => ({
  taskWebLinkService: { fetchBody: (...a: unknown[]) => mockFetchBody(...a) },
}))
const mockIdeaFetchBody = jest.fn()
jest.mock('@/lib/services/idea-web-link.service', () => ({
  ideaWebLinkService: {
    fetchBody: (...a: unknown[]) => mockIdeaFetchBody(...a),
  },
}))
jest.mock('@/lib/services/idea-evidence-resolve', () => ({
  resolveIdeaRef: jest.fn().mockResolvedValue({ ideaId: 'idea_1' }),
}))

// ── PR security scan deps (same harness as pr-security-scan.service.test) ──
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('tok'),
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  fetchPrHeadSha: jest.fn(),
  // LUM-785: stage A's graph rules read touched files; null = not found.
  readRepoFile: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/lib/llm/security-judge-client', () => ({
  judgeSecurity: jest.fn(),
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findByPrAndSha: jest.fn(),
    create: jest.fn(),
    restart: jest.fn(),
    claimPending: jest.fn(),
    finalize: jest.fn(),
    createFindings: jest.fn(),
    persistResult: jest.fn(),
    countExternalFindings: jest.fn(),
    findDispositionedByPullRequest: jest.fn(),
    findLatestByPullRequestIds: jest.fn(),
    findPreviousOpenFingerprints: jest.fn().mockResolvedValue([]),
    findFindingWithScope: jest.fn(),
    updateDisposition: jest.fn(),
    mergeStages: jest.fn(),
    setManagedRunId: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findById: jest.fn(),
    findManyForSecurityByTaskId: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findLastSarifIngestAt: jest.fn(),
    findSecurityBaseline: jest.fn(),
  },
}))
jest.mock('@/lib/services/security-managed-scan-start', () => ({
  startSecurityManagedScan: jest.fn(),
}))
jest.mock('@/lib/services/security-managed-scan-ops.service', () => ({
  securityManagedScanOpsService: {
    supersedeOlderRuns: jest.fn(),
    enforceHourlyCap: jest.fn(),
  },
}))
jest.mock('@/lib/services/security-hunt-start', () => ({
  startSecurityHunt: jest.fn(),
  recordHuntStartBestEffort: jest.fn(),
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { findUndispositionedByTask: jest.fn() },
}))
jest.mock('@/lib/services/security-baseline.service', () => ({
  securityBaselineService: { ensure: jest.fn().mockResolvedValue('present') },
}))
jest.mock('@/lib/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))

import { NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import {
  renderMemorySection,
  wrapUntrustedLinked,
  wrapUntrustedLinkedGroup,
  wrapUntrustedMemory,
  type RenderableMemory,
} from '@/lib/memory/render'
import { stewardContextService } from '@/lib/services/steward-context.service'
import {
  findingStatement,
  renderPreToolUseSecurityReminder,
  renderSessionStartSecuritySection,
  type ReminderFinding,
} from '@/lib/security-scan/agent-reminder'
import { renderHuntTaskContext } from '@/lib/security-scan/hunt/task-context'
import { buildPlanPrompt } from '@/lib/llm/security-hunt-plan-client'
import { renderTaskForPrompt } from '@/lib/llm/security-hunt-client'
import { buildCompressPrompt } from '@/lib/llm/security-hunt-compress-client'
import { SECRET_PATTERNS } from '@/lib/security-scan/secret-patterns'
import { GET as taskSlackSnapshotGet } from '@/app/api/tasks/[id]/slack-contexts/[contextId]/snapshot/route'
import { GET as taskWebBodyGet } from '@/app/api/tasks/[id]/web-links/[linkId]/body/route'
import { GET as ideaSlackSnapshotGet } from '@/app/api/ideas/[id]/slack-contexts/[contextId]/snapshot/route'
import { GET as ideaWebBodyGet } from '@/app/api/ideas/[id]/web-links/[linkId]/body/route'
import { prSecurityScanService } from '@/lib/services/pr-security-scan.service'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { securityManagedScanOpsService } from '@/lib/services/security-managed-scan-ops.service'
import * as gh from '@/lib/integrations/github/contents'
import * as judge from '@/lib/llm/security-judge-client'

/** One synthetic (non-functional) value per registry rule. */
const CORPUS: { id: string; line: string; value: string }[] = [
  {
    id: 'aws-access-key-id',
    line: 'const k = "AKIAABCDEFGHIJKLMNOP"',
    value: 'AKIAABCDEFGHIJKLMNOP',
  },
  {
    id: 'aws-secret-access-key',
    line: 'aws_secret_access_key = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN"',
    value: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN',
  },
  {
    id: 'github-pat',
    line: 'PAT=github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz',
    value: 'github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz',
  },
  {
    id: 'github-token',
    line: 'token: ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    value: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
  },
  {
    id: 'slack-webhook',
    line: 'url: https://hooks.slack.com/services/T0ABC/B0DEF/abcdefghijklmnopqrstuvwx',
    value:
      'https://hooks.slack.com/services/T0ABC/B0DEF/abcdefghijklmnopqrstuvwx',
  },
  {
    id: 'slack-token',
    line: 'SLACK=xoxb-123456789012-abcdefghijkl',
    value: 'xoxb-123456789012-abcdefghijkl',
  },
  {
    id: 'stripe-key',
    line: 'stripe = "sk_live_abcdefghijklmnopqrstuvwx"',
    value: 'sk_live_abcdefghijklmnopqrstuvwx',
  },
  {
    id: 'anthropic-key',
    line: 'ANTHROPIC="sk-ant-abcdefghijklmnopqrstuvwxyz0123456789"',
    value: 'sk-ant-abcdefghijklmnopqrstuvwxyz0123456789',
  },
  {
    id: 'openai-key',
    line: 'OPENAI="sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF"',
    value: 'sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF',
  },
  {
    id: 'google-api-key',
    line: 'key=AIzaSyAbcdefghijklmnopqrstuvwxyz0123456',
    value: 'AIzaSyAbcdefghijklmnopqrstuvwxyz0123456',
  },
  {
    id: 'sendgrid-key',
    line: 'SG="SG.abcdefghijklmnopqrstuv.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"',
    value:
      'SG.abcdefghijklmnopqrstuv.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
  },
  {
    id: 'twilio-key',
    line: 'TWILIO=SK0123456789abcdef0123456789abcdef',
    value: 'SK0123456789abcdef0123456789abcdef',
  },
  {
    id: 'private-key-block',
    line: '-----BEGIN RSA PRIVATE KEY-----',
    value: '-----BEGIN RSA PRIVATE KEY-----',
  },
  {
    id: 'jwt',
    line: 'auth = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop"',
    value: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop',
  },
  {
    id: 'database-url',
    line: 'DATABASE_URL="postgres://lumo:hunter2secret@db.example.com:5432/app"',
    value: 'hunter2secret',
  },
  {
    id: 'generic-assignment',
    line: 'const apiKey = "Zx9Qw3Lp7Vb2Nm5Rt8Ky1Hg6Fd4Sa0Je"',
    value: 'Zx9Qw3Lp7Vb2Nm5Rt8Ky1Hg6Fd4Sa0Je',
  },
  // LUM-887 rules — values are assembled by concatenation so no literal here
  // looks like a real credential.
  {
    id: 'stripe-clerk-test-key',
    line: 'CLERK = "' + 'sk_' + 'test_Qm7Tz4Lw9Kp2Xc8Vb5Nr3"',
    value: 'sk_' + 'test_Qm7Tz4Lw9Kp2Xc8Vb5Nr3',
  },
  {
    id: 'lumo-api-key',
    line: 'lumo auth login ' + 'lum_' + '0123456789abcdef'.repeat(4),
    value: 'lum_' + '0123456789abcdef'.repeat(4),
  },
  {
    id: 'npm-token',
    line: 'registry token ' + 'npm_' + 'Qm7Tz4Lw9Kp2Xc8Vb5Nr3Hy6Gf1Dj0Sa4Pe7',
    value: 'npm_' + 'Qm7Tz4Lw9Kp2Xc8Vb5Nr3Hy6Gf1Dj0Sa4Pe7',
  },
  {
    id: 'gitlab-pat',
    line: 'remote uses ' + 'glpat-' + 'Qm7Tz4Lw9Kp2Xc8Vb5Nr3',
    value: 'glpat-' + 'Qm7Tz4Lw9Kp2Xc8Vb5Nr3',
  },
  {
    id: 'huggingface-token',
    line: 'hub login ' + 'hf_' + 'Qm7Tz4Lw9Kp2Xc8Vb5Nr3Hy6Gf1Dj0Sa4P',
    value: 'hf_' + 'Qm7Tz4Lw9Kp2Xc8Vb5Nr3Hy6Gf1Dj0Sa4P',
  },
  {
    id: 'vercel-blob-token',
    line: 'blob ' + 'vercel_blob_rw_' + 'Qm7Tz4Lw9Kp2Xc8V_b5Nr3Hy6Gf1Dj0Sa4Pe7',
    value: 'vercel_blob_rw_' + 'Qm7Tz4Lw9Kp2Xc8V_b5Nr3Hy6Gf1Dj0Sa4Pe7',
  },
  {
    id: 'env-assignment',
    line: 'DB_PASSWORD=' + 'Qm7Tz4Lw' + '9Kp2',
    value: 'Qm7Tz4Lw' + '9Kp2',
  },
  {
    id: 'http-authorization',
    line: 'Authorization: Basic ' + 'UW03VHo0THc5S3Ay',
    value: 'UW03VHo0THc5S3Ay',
  },
  {
    id: 'bearer-token',
    line: 'sent Bearer ' + 'Qm7Tz4Lw9Kp2Xc8Vb5Nr3Hy6',
    value: 'Qm7Tz4Lw9Kp2Xc8Vb5Nr3Hy6',
  },
  {
    id: 'cli-credential-flag',
    line: 'mysqladmin --password ' + 'Qm7Tz4Lw' + '9Kp2 status',
    value: 'Qm7Tz4Lw' + '9Kp2',
  },
  {
    id: 'env-assignment-lowercase',
    line: 'db_password=' + 'Qm7Tz4Lw' + '9Kp2Xc8V',
    value: 'Qm7Tz4Lw' + '9Kp2Xc8V',
  },
  {
    id: 'env-assignment-quoted',
    line: 'export TOKEN="' + 'Qm7Tz4 Lw9Kp2' + ' Xc8Vb5"',
    value: 'Qm7Tz4 Lw9Kp2' + ' Xc8Vb5',
  },
  {
    id: 'credential-key-value',
    line: '{"password": "' + 'Qm7Tz4Lw' + '9Kp2Xc8V"}',
    value: 'Qm7Tz4Lw' + '9Kp2Xc8V',
  },
  {
    id: 'credential-yaml-value',
    line: '  password: ' + 'Qm7Tz4Lw' + '9Kp2Xc8V',
    value: 'Qm7Tz4Lw' + '9Kp2Xc8V',
  },
  {
    id: 'http-api-key-header',
    line: 'X-API-Key: ' + 'Qm7Tz4Lw' + '9Kp2Xc8V',
    value: 'Qm7Tz4Lw' + '9Kp2Xc8V',
  },
  {
    id: 'http-cookie',
    line: 'Cookie: session=' + 'Qm7Tz4Lw' + '9Kp2Xc8V',
    value: 'session=' + 'Qm7Tz4Lw' + '9Kp2Xc8V',
  },
  {
    id: 'url-credentials',
    line:
      'git clone https://deploy:' +
      'Qm7Tz4Lw' +
      '9Kp2Xc8V@git.example.com/x.git',
    value: 'Qm7Tz4Lw' + '9Kp2Xc8V',
  },
  {
    id: 'cli-secret-flag',
    line: 'tool deploy --secret ' + 'Qm7Tz4Lw' + '9Kp2Xc8V',
    value: 'Qm7Tz4Lw' + '9Kp2Xc8V',
  },
  {
    id: 'cli-user-password',
    line: 'curl -u admin:' + 'Qm7Tz4Lw' + '9Kp2Xc8V https://api.example.com',
    value: 'Qm7Tz4Lw' + '9Kp2Xc8V',
  },
  {
    id: 'cli-short-password-flag',
    line: 'docker login -u bot -p ' + 'Qm7Tz4Lw' + '9Kp2Xc8V ghcr.io',
    value: 'Qm7Tz4Lw' + '9Kp2Xc8V',
  },
  {
    id: 'kubectl-from-literal',
    line:
      'kubectl create secret generic db --from-literal=dbpass=' +
      'Qm7Tz4Lw' +
      '9Kp2Xc8V',
    value: 'Qm7Tz4Lw' + '9Kp2Xc8V',
  },
  {
    id: 'putty-private-key',
    line: 'PuTTY-User-' + 'Key-File-3: ssh-rsa',
    value: 'PuTTY-User-' + 'Key-File-3: ssh-rsa',
  },
]
const ALL_LINES = CORPUS.map(c => c.line).join('\n')
const NOTICE =
  /⚠ (\d+) suspected credentials? in this content (?:was|were) redacted before injection/
const MARKER = /\[⚠ (\d+) suspected credentials? redacted\]/

function expectNoRawValue(out: string): void {
  for (const c of CORPUS) expect(out).not.toContain(c.value)
}
function expectAllRedactionTokens(out: string): void {
  for (const c of CORPUS) expect(out).toContain(`…(len ${c.value.length})`)
}
function noticeCount(out: string): number {
  const m = NOTICE.exec(out)
  return m ? Number(m[1]) : 0
}

test('the corpus covers every registry rule (a new rule needs a fixture here)', () => {
  expect(CORPUS.map(c => c.id).sort()).toEqual(
    SECRET_PATTERNS.map(p => p.id).sort()
  )
})

describe('① task-context memory — wrapUntrustedMemory', () => {
  it.each(CORPUS)(
    '$id — masked, still injected, notice at the head',
    ({ line, value }) => {
      const memory: RenderableMemory = {
        id: 'm1',
        scope: 'PROJECT',
        category: 'TRAP',
        content: { trigger: `pasted: ${line}`, outcome: 'leak' },
      }
      const out = wrapUntrustedMemory(renderMemorySection([memory]))
      expect(out).not.toContain(value)
      expect(out).toContain(`…(len ${value.length})`)
      expect(out).toContain('pasted: ')
      expect(noticeCount(out)).toBe(1)
      const lines = out.split('\n')
      expect(lines[0]).toBe('<untrusted-team-memory>')
      expect(lines[1]).toMatch(NOTICE)
      expect(lines[2]).toMatch(/^NOTE TO ASSISTANT/)
      expect(out.trimEnd().endsWith('</untrusted-team-memory>')).toBe(true)
    }
  )

  it('clean memory renders byte-identically to the LUM-783 output (no notice)', () => {
    const out = wrapUntrustedMemory(
      renderMemorySection([
        {
          id: 'm1',
          scope: 'PROJECT',
          category: 'TRAP',
          content: { trigger: 'run npm test first', outcome: 'y' },
        },
      ])
    )
    expect(out).not.toMatch(/⚠/)
    expect(out.split('\n')[1]).toMatch(/^NOTE TO ASSISTANT/)
  })
})

describe('② task-context linked group — wrapUntrustedLinked / wrapUntrustedLinkedGroup', () => {
  it('wrapUntrustedLinked: the whole corpus in one Slack section', () => {
    const out = wrapUntrustedLinked(`## Slack\n${ALL_LINES}`)
    expectNoRawValue(out)
    expectAllRedactionTokens(out)
    expect(noticeCount(out)).toBe(CORPUS.length)
    expect(out.split('\n')[1]).toMatch(NOTICE)
  })

  it('wrapUntrustedLinkedGroup: first and continuation blocks are both redacted', () => {
    const [first, second, third] = wrapUntrustedLinkedGroup([
      `## Slack\n${CORPUS[0]!.line}`,
      '## Web\nclean',
      `## Comments\n${ALL_LINES}`,
    ])
    expect(first).not.toContain(CORPUS[0]!.value)
    expect(noticeCount(first!)).toBe(1)
    expect(second).not.toMatch(/⚠/)
    expectNoRawValue(third!)
    expect(noticeCount(third!)).toBe(CORPUS.length)
    // Notice precedes the continuation pointer.
    expect(third!.split('\n')[1]).toMatch(NOTICE)
    expect(
      third!
        .split('\n')
        .some(l => l.startsWith('(untrusted linked content continues'))
    ).toBe(true)
  })
})

describe('③ steward milestone-memory section', () => {
  beforeEach(() => {
    mockFindMilestone.mockResolvedValue({ id: 'ms-2', projectId: 'p1' })
    mockFindMsMemories.mockResolvedValue([
      {
        id: 'mem-1',
        category: 'DECISION',
        content: { what: `rotate: ${ALL_LINES}`, why: 'y' },
        createdByMemberId: null,
        milestoneId: 'ms-1',
      },
    ])
  })

  it('renders the learning with every secret masked and a notice', async () => {
    const { section, count } =
      await stewardContextService.buildMilestoneMemorySection('ms-2')
    expect(count).toBe(1)
    expectNoRawValue(section)
    expectAllRedactionTokens(section)
    expect(section).toContain('rotate: ')
    expect(noticeCount(section)).toBe(CORPUS.length)
  })
})

describe('④ security agent-reminder', () => {
  const finding = (title: string): ReminderFinding => ({
    id: 'f1',
    ruleId: 'llm:hardcoded-credential',
    severity: 'HIGH',
    provenance: 'LLM_JUDGE',
    filePath: 'lib/x.ts',
    line: 3,
    title,
    blocking: true,
    prNumber: 9,
  })

  it.each(CORPUS)(
    '$id — session-start section, pre-tool-use reminder and status statement',
    ({ line, value }) => {
      const start = renderSessionStartSecuritySection({
        findings: [finding(`echoed ${line}`)],
        unconfirmedPrs: [],
        identifier: 'LUM-1',
      })
      expect(start).not.toContain(value)
      expect(start).toContain('echoed ')
      expect(noticeCount(start)).toBe(1)

      const pre = renderPreToolUseSecurityReminder({
        scans: [
          {
            prNumber: 9,
            headSha: 'abcdef0123',
            findings: [finding(`echoed ${line}`)],
          },
        ],
        identifier: 'LUM-1',
      })
      expect(pre).not.toBeNull()
      expect(pre!).not.toContain(value)
      expect(noticeCount(pre!)).toBe(1)

      const statement = findingStatement(finding(`echoed ${line}`))
      expect(statement).not.toContain(value)
      expect(statement).toContain(`…(len ${value.length})`)
    }
  )
})

describe('⑦ hunt — task context → plan prompt', () => {
  it('renderHuntTaskContext masks every field kind and puts the notice first', () => {
    const out = renderHuntTaskContext({
      traps: [`${CORPUS[0]!.line} → leak`, `${CORPUS[1]!.line} → leak`],
      crossings: [
        `HARDCODED_SECRET: ${CORPUS[2]!.line}`,
        `TEST_FILE_DELETED: ${CORPUS[3]!.line}`,
      ],
    })
    for (const c of CORPUS.slice(0, 4)) expect(out).not.toContain(c.value)
    expect(noticeCount(out)).toBe(4)
    expect(out.split('\n')[1]).toMatch(NOTICE)
    expect(out.trimEnd().endsWith('</untrusted-task-context>')).toBe(true)
  })

  it('buildPlanPrompt: the block carries through redacted and a finding title is masked with a marker', () => {
    const block = renderHuntTaskContext({
      traps: [`${ALL_LINES.replace(/\n/g, ' ')} → leak`],
      crossings: [],
    })
    const prompt = buildPlanPrompt({
      reasons: ['diff:sink:prisma-raw'],
      touchedPaths: ['lib/s.ts'],
      findings: [
        {
          severity: 'HIGH',
          ruleId: 'ext:sarif:x',
          title: `found ${CORPUS[3]!.line} and ${CORPUS[5]!.line}`,
        },
      ],
      taskContext: block,
      timeoutMs: 1_000,
    })
    expectNoRawValue(prompt)
    expect(prompt).toMatch(NOTICE)
    const findingLine = prompt.split('\n').find(l => l.startsWith('- [HIGH]'))!
    expect(findingLine).toContain('found ')
    expect(MARKER.exec(findingLine)![1]).toBe('2')
  })
})

describe('⑧ hunt — task header (renderTaskForPrompt)', () => {
  it.each(CORPUS)(
    '$id — objective and starting points are masked, marker inline',
    ({ line, value }) => {
      const out = renderTaskForPrompt({
        id: 't1',
        objective: `trace ${line} to the sink`,
        category: 'idor',
        startingPoints: [`lib/${line}.ts`],
      })
      expect(out).not.toContain(value)
      const header = out.split('\n')[0]!
      expect(header).toMatch(/^## Task t1: trace /)
      expect(MARKER.exec(header)![1]).toBe('1')
      expect(out).toContain('Start from: lib/')
    }
  )

  it('adds no marker to an ordinary objective', () => {
    const out = renderTaskForPrompt({
      id: 't1',
      objective: 'Check the workspace scope before the Prisma call',
      category: 'idor',
      startingPoints: ['a.ts'],
    })
    expect(out).not.toContain('⚠')
  })
})

describe('⑨ hunt — compressor prompt (buildCompressPrompt)', () => {
  it('masks the objective inline and the command output at the block head', () => {
    const prompt = buildCompressPrompt({
      objective: `trace ${CORPUS[7]!.line}`,
      category: 'idor',
      output: `lib/a.ts:1: ${ALL_LINES.split('\n').join('\nlib/a.ts:2: ')}`,
      timeoutMs: 1_000,
    })
    expectNoRawValue(prompt)
    const objectiveLine = prompt.split('\n')[0]!
    expect(objectiveLine).toMatch(/^Objective: trace /)
    expect(MARKER.exec(objectiveLine)![1]).toBe('1')
    const lines = prompt.split('\n')
    const open = lines.indexOf('<untrusted-command-output>')
    expect(lines[open + 1]).toMatch(NOTICE)
    expect(noticeCount(prompt)).toBe(CORPUS.length)
    expect(prompt).toContain('lib/a.ts:1: ')
  })
})

describe('⑩ tier-2 retrieval routes — Slack snapshot + web body (task and idea)', () => {
  const req = () => new NextRequest('http://localhost/api/x')
  const message = (text: string) => ({
    ts: '1',
    userId: 'U1',
    userName: 'kai',
    userAvatarUrl: null,
    text,
    edited: false,
  })
  beforeEach(() => {
    ;(requireIdentity as jest.Mock).mockResolvedValue({ workspaceId: 'ws_1' })
    mockFindByWorkspaceIdentifier.mockResolvedValue({ id: 'task_1' })
  })

  it('task Slack snapshot: every message body masked, count returned', async () => {
    mockSlackGetById.mockResolvedValue({
      taskId: 'task_1',
      snapshot: { messages: CORPUS.map(c => message(`said ${c.line}`)) },
    })
    const res = await taskSlackSnapshotGet(req(), {
      params: Promise.resolve({ id: 'LUM-1', contextId: 'c1' }),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expectNoRawValue(JSON.stringify(json))
    expect(json.redactedSecrets).toBe(CORPUS.length)
    expect(json.snapshot.messages).toHaveLength(CORPUS.length)
    expect(json.snapshot.messages[0].text).toMatch(/^said /)
  })

  it('idea Slack snapshot: same treatment', async () => {
    mockIdeaSlackGetById.mockResolvedValue({
      ideaId: 'idea_1',
      snapshot: { messages: [message(ALL_LINES)] },
    })
    const res = await ideaSlackSnapshotGet(req(), {
      params: Promise.resolve({ id: 'LUM-I1', contextId: 'c1' }),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expectNoRawValue(JSON.stringify(json))
    expect(json.redactedSecrets).toBe(CORPUS.length)
  })

  it('task web body: masked body, count returned; clean body untouched with count 0', async () => {
    mockFetchBody.mockResolvedValue(`# Page\n${ALL_LINES}\n`)
    const res = await taskWebBodyGet(req(), {
      params: Promise.resolve({ id: 'LUM-1', linkId: 'l1' }),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expectNoRawValue(json.body)
    expect(json.body.startsWith('# Page\n')).toBe(true)
    expect(json.redactedSecrets).toBe(CORPUS.length)

    mockFetchBody.mockResolvedValue('# Clean page\nnothing here')
    const clean = await (
      await taskWebBodyGet(req(), {
        params: Promise.resolve({ id: 'LUM-1', linkId: 'l1' }),
      })
    ).json()
    expect(clean).toEqual({
      body: '# Clean page\nnothing here',
      redactedSecrets: 0,
    })
  })

  it('idea web body: same treatment', async () => {
    mockIdeaFetchBody.mockResolvedValue(ALL_LINES)
    const res = await ideaWebBodyGet(req(), {
      params: Promise.resolve({ id: 'LUM-I1', linkId: 'l1' }),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expectNoRawValue(json.body)
    expect(json.redactedSecrets).toBe(CORPUS.length)
  })
})

describe('⑪ PR security scan — the LLM judge never sees the raw diff value', () => {
  const repo = prSecurityScanRepository as jest.Mocked<
    typeof prSecurityScanRepository
  >
  const prRepo = pullRequestRepository as jest.Mocked<
    typeof pullRequestRepository
  >
  const fetchPrDiff = gh.fetchPrDiff as jest.Mock
  const fetchPrHeadSha = gh.fetchPrHeadSha as jest.Mock
  const judgeSecurity = judge.judgeSecurity as jest.Mock

  beforeEach(() => {
    process.env.LUMO_SECURITY_HUNT = 'off'
    prRepo.findById.mockResolvedValue({
      id: 'pr1',
      workspaceId: 'w1',
      taskId: 't1',
      repo: 'o/r',
      number: 7,
    } as never)
    fetchPrHeadSha.mockResolvedValue('sha-1')
    repo.findByPrAndSha.mockResolvedValue(null)
    repo.create.mockResolvedValue({ id: 's1' } as never)
    repo.findDispositionedByPullRequest.mockResolvedValue([])
    repo.countExternalFindings.mockResolvedValue(0)
    repo.setManagedRunId.mockResolvedValue(undefined)
    judgeSecurity.mockResolvedValue({ findings: [] })
    ;(
      securityManagedScanOpsService.supersedeOlderRuns as jest.Mock
    ).mockResolvedValue({ superseded: 0, cancelled: 0, sandboxesStopped: 0 })
    ;(
      securityManagedScanOpsService.enforceHourlyCap as jest.Mock
    ).mockResolvedValue({ capped: false })
    ;(projectRepository.findLastSarifIngestAt as jest.Mock).mockResolvedValue(
      undefined
    )
  })

  it('the diff handed to judgeSecurity carries the redaction tokens, not the values', async () => {
    const diff = [
      '--- a/src/cfg.ts',
      '+++ b/src/cfg.ts',
      `@@ -1,0 +1,${CORPUS.length} @@`,
      ...CORPUS.map(c => `+${c.line}`),
    ].join('\n')
    fetchPrDiff.mockResolvedValue(diff)
    const result = await prSecurityScanService.run({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(result).toMatchObject({
      deduped: false,
      scanId: 's1',
      status: 'FINDINGS',
    })
    expect(judgeSecurity).toHaveBeenCalledTimes(1)
    const sent: string = judgeSecurity.mock.calls[0]![0].diff
    expectNoRawValue(sent)
    expectAllRedactionTokens(sent)
    // The diff structure the judge reasons over is intact.
    expect(sent).toContain('+++ b/src/cfg.ts')
    expect(sent.split('\n').filter(l => l.startsWith('+')).length).toBe(
      CORPUS.length + 1
    )
    // Stage A (deterministic) still saw the real values: one finding per line.
    const persisted = repo.persistResult.mock.calls[0]![1]
    expect(persisted).toHaveLength(CORPUS.length)
    for (const f of persisted) expectNoRawValue(JSON.stringify(f))
  })
})

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
 * tier-2 Slack-snapshot and web-body routes and the LLM-judge
 * diff input of the PR security scan.
 */
// LUM-1064: plugin cases live in __tests__/ee/security/security-scan/inject-redact-points.test.ts.
// LUM-1064: core test, run without the security plugin (the OSS build).
jest.mock('@/lib/plugins/installed', () => ({ INSTALLED_SERVER_PLUGINS: [] }))
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
}))
const mockFetchBody = jest.fn()
jest.mock('@/lib/services/task-web-link.service', () => ({
  taskWebLinkService: { fetchBody: (...a: unknown[]) => mockFetchBody(...a) },
}))

import { NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import {
  renderMemorySection,
  wrapUntrustedLinked,
  wrapUntrustedLinkedGroup,
  wrapUntrustedMemory,
  wrapUntrustedTaskDescription,
  type RenderableMemory,
} from '@/lib/memory/render'
import { renderPrReviewTodosSection } from '@/lib/context/render/pr-review-todos'
import { guardPromptLineText } from '@/lib/security-scan/inject-guard'
import { stewardContextService } from '@/lib/services/steward-context.service'
import { SECRET_PATTERNS } from '@/lib/security-scan/secret-patterns'
import { GET as taskSlackSnapshotGet } from '@/app/api/tasks/[id]/slack-contexts/[contextId]/snapshot/route'
import { GET as taskWebBodyGet } from '@/app/api/tasks/[id]/web-links/[linkId]/body/route'

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

describe('⑩ tier-2 retrieval routes — Slack snapshot + web body', () => {
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
})

describe('⑫ LUM-998 — task description, session summaries, review todos', () => {
  it('wrapUntrustedTaskDescription: the whole corpus, notice at the head', () => {
    const out = wrapUntrustedTaskDescription(`## Context\n${ALL_LINES}`)
    expectNoRawValue(out)
    expectAllRedactionTokens(out)
    expect(noticeCount(out)).toBe(CORPUS.length)
    const lines = out.split('\n')
    expect(lines[0]).toBe('<untrusted-task-description>')
    expect(lines[1]).toMatch(NOTICE)
    expect(out.trimEnd().endsWith('</untrusted-task-description>')).toBe(true)
  })

  it.each(CORPUS)(
    '$id — a session summary line is masked with an inline marker',
    ({ line, value }) => {
      const out = guardPromptLineText(`Left open: ${line}`)
      expect(out).not.toContain(value)
      expect(out).toContain(`…(len ${value.length})`)
      expect(MARKER.exec(out)![1]).toBe('1')
    }
  )

  it.each(CORPUS)(
    '$id — a PR review todo is masked with an inline marker',
    ({ line, value }) => {
      const out = renderPrReviewTodosSection([
        {
          kind: 'line',
          prNumber: 1,
          filePath: 'lib/a.ts',
          line: 1,
          text: `rotate ${line}`,
          url: 'https://github.com/acme/app/pull/1#r1',
          author: 'eve',
          reviewer: { trusted: false, role: 'no_association' },
        },
      ])
      expect(out).not.toContain(value)
      expect(MARKER.exec(out)![1]).toBe('1')
    }
  )
})

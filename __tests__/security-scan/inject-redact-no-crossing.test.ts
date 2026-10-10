/**
 * @jest-environment node
 *
 * LUM-784 criterion 4 — injecting secret-bearing content never produces a
 * boundary crossing. This is Lumo's own data flow (a credential sitting in a
 * Slack thread / memory row / diff), not an agent stepping over a line, so a
 * crossing here would pollute the accountability ledger the crossing system
 * exists for. Same two layers as LUM-783's no-boundary-crossing test:
 *
 *   1. Structural — neither the redaction/guard modules nor the injection
 *      points they were added to import the crossing service / repository.
 *   2. Behavioural — render secret content through the real wrappers and
 *      prompt builders with every crossing write path spied on; nothing may
 *      be called.
 */
// LUM-1064: plugin cases live in __tests__/ee/security/security-scan/inject-redact-no-crossing.test.ts.
// LUM-1064: core test, run without the security plugin (the OSS build).
jest.mock('@/lib/plugins/installed', () => ({ INSTALLED_SERVER_PLUGINS: [] }))
jest.mock('ai', () => ({ generateText: jest.fn(), generateObject: jest.fn() }))
jest.mock('@/lib/ai/gateway', () => ({ gateway: (id: string) => ({ id }) }))

const mockCrossingWrite = jest.fn()
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: new Proxy(
    {},
    {
      get:
        (_t, prop) =>
        (...a: unknown[]) =>
          mockCrossingWrite(String(prop), ...a),
    }
  ),
}))
jest.mock('@/lib/services/boundary-crossing.service', () => ({
  boundaryCrossingService: new Proxy(
    {},
    {
      get:
        (_t, prop) =>
        (...a: unknown[]) =>
          mockCrossingWrite(String(prop), ...a),
    }
  ),
}))
const mockActivityCreate = jest.fn()
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {
    create: (...a: unknown[]) => mockActivityCreate(...a),
    createMany: (...a: unknown[]) => mockActivityCreate(...a),
  },
}))

import { readFileSync } from 'node:fs'
import {
  renderMemorySection,
  wrapUntrustedLinked,
  wrapUntrustedLinkedGroup,
  wrapUntrustedMemory,
} from '@/lib/memory/render'
import {
  guardInjectedText,
  redactSlackSnapshotForInjection,
  redactWebBodyForInjection,
} from '@/lib/security-scan/inject-guard'
import { redactForInjection } from '@/lib/security-scan/scan-secrets'

const SECRETS = [
  'token: ghp_abcdefghijklmnopqrstuvwxyz0123456789',
  'const k = "AKIAABCDEFGHIJKLMNOP"',
  'DATABASE_URL="postgres://lumo:hunter2secret@db.example.com:5432/app"',
  '-----BEGIN RSA PRIVATE KEY-----',
].join('\n')

describe('structural — no path from the redaction to the crossing ledger', () => {
  const CROSSING_IMPORT = /boundary-crossing\.(service|repository)/
  const FILES = [
    'lib/security-scan/scan-secrets.ts',
    'lib/security-scan/inject-guard.ts',
    'lib/security-scan/secret-patterns.ts',
    'lib/security-scan/redact.ts',
    'lib/memory/render.ts',
    'app/api/tasks/[id]/slack-contexts/[contextId]/snapshot/route.ts',
    'app/api/tasks/[id]/web-links/[linkId]/body/route.ts',
    'cli/src/lib/redaction-notice.ts',
  ]

  it.each(FILES)('%s imports no crossing service or repository', file => {
    const src = readFileSync(file, 'utf8')
    const imports = src
      .split('\n')
      .filter(
        l => /^\s*(import|export)\b.*from\s+['"]/.test(l) || /require\(/.test(l)
      )
    for (const l of imports) expect(l).not.toMatch(CROSSING_IMPORT)
    expect(src).not.toMatch(/boundaryCrossing(Service|Repository)/)
  })
})

describe('behavioural — secret content through every render path, crossing paths spied', () => {
  beforeEach(() => {
    mockCrossingWrite.mockClear()
    mockActivityCreate.mockClear()
  })

  afterEach(() => {
    expect(mockCrossingWrite).not.toHaveBeenCalled()
    expect(mockActivityCreate).not.toHaveBeenCalled()
  })

  it('memory and linked wrappers', () => {
    const out = [
      wrapUntrustedMemory(
        renderMemorySection([
          {
            id: 'm',
            scope: 'TASK',
            category: 'TRAP',
            content: { trigger: SECRETS, outcome: 'x' },
          },
        ])
      ),
      wrapUntrustedLinked(`## Slack\n${SECRETS}`),
      ...wrapUntrustedLinkedGroup([
        `## Web\n${SECRETS}`,
        `## Comments\n${SECRETS}`,
      ]),
    ].join('\n')
    expect(out).not.toContain('AKIAABCDEFGHIJKLMNOP')
    expect(out).toMatch(/suspected credentials/)
  })

  it('tier-2 helpers and the pure functions', () => {
    const out = [
      redactWebBodyForInjection(SECRETS).body,
      JSON.stringify(
        redactSlackSnapshotForInjection({
          messages: [
            {
              ts: '1',
              userId: 'U',
              userName: null,
              userAvatarUrl: null,
              text: SECRETS,
              edited: false,
            },
          ],
        }).snapshot
      ),
      guardInjectedText(SECRETS).text,
      redactForInjection(SECRETS).text,
    ].join('\n')
    expect(out).not.toContain('AKIAABCDEFGHIJKLMNOP')
  })

  it('the pure function never throws on odd input', () => {
    const NUL = String.fromCharCode(0)
    const ESC = String.fromCharCode(27)
    for (const input of [
      '',
      '\n',
      '\n\n\n',
      'x'.repeat(20_000),
      `${NUL}${ESC}[31m`,
      '"'.repeat(100),
      '\\'.repeat(100),
    ]) {
      expect(() => redactForInjection(input)).not.toThrow()
      expect(() => guardInjectedText(input)).not.toThrow()
    }
  })
})

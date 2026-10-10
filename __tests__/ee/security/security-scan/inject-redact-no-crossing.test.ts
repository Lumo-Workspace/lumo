/**
 * @jest-environment node
 *
 * LUM-1064: plugin half of __tests__/security-scan/inject-redact-no-crossing.test.ts (split)
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
import { renderHuntTaskContext } from '@/ee/security/security-scan/hunt/task-context'
import { buildPlanPrompt } from '@/ee/security/llm/security-hunt-plan-client'
import { renderTaskForPrompt } from '@/ee/security/llm/security-hunt-client'
import { buildCompressPrompt } from '@/ee/security/llm/security-hunt-compress-client'

const SECRETS = [
  'token: ghp_abcdefghijklmnopqrstuvwxyz0123456789',
  'const k = "AKIAABCDEFGHIJKLMNOP"',
  'DATABASE_URL="postgres://lumo:hunter2secret@db.example.com:5432/app"',
  '-----BEGIN RSA PRIVATE KEY-----',
].join('\n')

describe('structural — no path from the redaction to the crossing ledger', () => {
  const CROSSING_IMPORT = /boundary-crossing\.(service|repository)/
  const FILES = [
    'ee/security/security-scan/hunt/task-context.ts',
    'ee/security/security-scan/agent-reminder.ts',
    'ee/security/llm/security-hunt-client.ts',
    'ee/security/llm/security-hunt-compress-client.ts',
    'ee/security/llm/security-hunt-plan-client.ts',
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

  it('hunt prompts', () => {
    const block = renderHuntTaskContext({
      traps: [SECRETS],
      crossings: [],
    })
    const out = [
      block,
      buildPlanPrompt({
        reasons: ['diff:sink:prisma-raw'],
        touchedPaths: ['lib/s.ts'],
        findings: [{ severity: 'HIGH', ruleId: 'x', title: SECRETS }],
        taskContext: block,
        timeoutMs: 1,
      }),
      renderTaskForPrompt({
        id: 't',
        objective: SECRETS,
        category: 'idor',
        startingPoints: ['a.ts'],
      }),
      buildCompressPrompt({
        objective: SECRETS,
        category: 'idor',
        output: SECRETS,
        timeoutMs: 1,
      }),
    ].join('\n')
    expect(out).not.toContain('AKIAABCDEFGHIJKLMNOP')
  })
})

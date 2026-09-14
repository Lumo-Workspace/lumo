/** @jest-environment node */
jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@ai-sdk/gateway', () => ({ gateway: (id: string) => ({ id }) }))

import { generateObject } from 'ai'
import { REASONING_MODEL } from '@/lib/ai/models'
import { falsifyCandidate } from '@/lib/llm/security-falsifier-client'

const gen = generateObject as jest.Mock

const candidate = {
  category: 'idor' as const,
  cwe: 'CWE-639',
  severity: 'MEDIUM' as const,
  sink: { symbol: 's.ts#taskRepo.find@4', file: 's.ts', line: 4 },
  entry: { symbol: 'r.ts#GET', file: 'r.ts', line: 2 },
  call_chain: [{ from: 'r.ts#GET', to: 's.ts#taskRepo.find@4' }],
  precondition: 'attacker supplies another workspace id',
  claim: 'workspace id from the path is not checked against membership',
  reachability: 'EXTERNAL' as const,
  fingerprint: 'a'.repeat(16),
}

describe('LUM-739 falsifier client', () => {
  it('uses the VERIFIER bucket, passes the claim, precondition, chain and both snippets, and maps the verdict', async () => {
    gen.mockResolvedValueOnce({
      object: { verdict: 'REJECT', reason: 'requireMember on line 3' },
      usage: { totalTokens: 420 },
    })
    const out = await falsifyCandidate({
      candidate,
      entrySnippet: '2: export async function GET()',
      sinkSnippet: '4: taskRepo.find(id)',
    })
    expect(out).toEqual({
      verdict: 'REJECT',
      reason: 'requireMember on line 3',
      tokens: 420,
    })
    const call = gen.mock.calls[0]![0]
    expect(call.model).toEqual({ id: REASONING_MODEL })
    expect(call.system).toContain('ONLY two outputs')
    expect(call.system).not.toMatch(/ACCEPT|CONFIRMED/)
    expect(call.prompt).toContain(candidate.claim)
    expect(call.prompt).toContain(candidate.precondition)
    expect(call.prompt).toContain('r.ts#GET -> s.ts#taskRepo.find@4')
    expect(call.prompt).toContain('2: export async function GET()')
    expect(call.prompt).toContain('4: taskRepo.find(id)')
    expect(call.schema).toBeDefined()
  })

  it('treats missing usage as 0 tokens', async () => {
    gen.mockResolvedValueOnce({
      object: { verdict: 'INCONCLUSIVE', reason: 'no check found' },
      usage: {},
    })
    await expect(
      falsifyCandidate({ candidate, entrySnippet: '', sinkSnippet: '' })
    ).resolves.toEqual({
      verdict: 'INCONCLUSIVE',
      reason: 'no check found',
      tokens: 0,
    })
  })
})

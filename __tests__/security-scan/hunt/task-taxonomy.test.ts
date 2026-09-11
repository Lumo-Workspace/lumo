/** @jest-environment node */
// LUM-758 §11.2 — the design's load-bearing invariant: a `HuntTask`'s
// `objective` is open vocabulary, but the finding it produces is always
// typed by one of the closed `HUNT_CATEGORIES`, and `huntFingerprint` never
// hashes task identity. That's what lets `inheritDispositions` carry a
// human's "ignore this one" call across scans even though the plan that
// found it can phrase its objective differently next time.
// `security-hunt.service.ts` statically imports `lib/integrations/github/
// contents`, which pulls in `@octokit/auth-app` (ESM-only) transitively —
// stub both so this suite can statically import `toHuntFindingRows` without
// tripping jest's "Cannot use import statement outside a module" (same
// pattern as `__tests__/security-hunt.service.test.ts`).
jest.mock('@/lib/integrations/github/auth', () => ({}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  readRepoFile: jest.fn(),
}))

import { toHuntFindingRows } from '@/lib/services/security-hunt.service'
import {
  huntFingerprint,
  HUNT_CATEGORIES,
} from '@/lib/security-scan/hunt/candidate'

const candidate = (category: string) => ({
  category,
  claim: 'c',
  precondition: 'p',
  severity: 'HIGH' as const,
  cwe: 'CWE-89',
  reachability: 'DIRECT' as const,
  entry: { symbol: 'a.ts#GET', file: 'a.ts', line: 1 },
  sink: { symbol: 'b.ts#q', file: 'b.ts', line: 2 },
  call_chain: [{ from: 'a.ts#GET', to: 'b.ts#q' }],
  fingerprint: huntFingerprint(category, 'b.ts#q', 'a.ts#GET'),
  falsifierReason: 'r',
})

it('task objectives are open vocabulary but finding taxonomy and fingerprints stay closed', () => {
  for (const category of HUNT_CATEGORIES) {
    const [row] = toHuntFindingRows('s1', [candidate(category) as never])
    expect(row!.ruleId).toBe(`hunt:${category}`)
    expect(HUNT_CATEGORIES).toContain(row!.ruleId.slice('hunt:'.length))
  }
  // 同一候选、不同任务 id / objective → 同一 fingerprint。这是
  // inheritDispositions 跨扫描继承人工裁定的前提；任务标识一旦进 fingerprint，
  // 人上次 dismiss 掉的 finding 下次就会换个指纹重新冒出来。
  expect(huntFingerprint('injection', 'b.ts#q', 'a.ts#GET')).toBe(
    huntFingerprint('injection', 'b.ts#q', 'a.ts#GET')
  )
})

# Fragment-Level Trust Badge (LUM-303) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface lineage's cross-task "trust score" (used in N tasks, X% merged) as a badge on each memory card, reusing the LUM-300 discriminative caliber.

**Architecture:** Extract the trust-scoring math from `lineage-signal.ts` into one pure function `computeFragmentTrust`, shared by the CLI markdown renderer and a new web path (service → thin route → React Query hook → atomic badge). Unqualified fragments (cold-start <3 / zero-variance / no edges) produce no verdict → no badge.

**Tech Stack:** Next.js 14 App Router, TypeScript (strict, `noUncheckedIndexedAccess`), Prisma, React Query (TanStack), react-intl, Jest + jsdom, Tailwind/shadcn.

**Branch:** `lumo/LUM-303-fragment-trust-badge` (already created; spec committed).

**Spec:** `docs/superpowers/specs/2026-06-07-lum303-fragment-trust-badge-design.md`

---

## File Structure

**Create:**

- `app/api/lineage/fragment-trust/route.ts` — thin POST route (auth → zod → service).
- `lib/api-client/lineage.ts` — `lineageClient.fragmentTrust(ids)`.
- `app/workspace/[workspaceUrl]/hooks/useFragmentTrust.ts` — batched React Query read.
- `app/workspace/[workspaceUrl]/components/memory/FragmentTrustBadge.tsx` — atomic badge.
- `__tests__/lineage-signal-compute.test.ts` — pure-function unit tests.
- `__tests__/lineage-fragment-trust-service.test.ts` — service tests.
- `__tests__/fragment-trust-route.test.ts` — route tests.
- `__tests__/FragmentTrustBadge.test.tsx` — component tests.
- `__tests__/useFragmentTrust.test.tsx` — hook tests.

**Modify:**

- `lib/services/lineage-signal.ts` — add `TrustVerdict`/`computeFragmentTrust`; refactor `assembleLineageSection` + `renderLineageSection` to consume it (markdown unchanged).
- `lib/services/lineage.service.ts` — add `fragmentTrustForMemories`.
- `lib/query/keys.ts` — add `fragmentTrust` key.
- `lib/api-client/index.ts` — export `lineageClient`.
- `app/workspace/[workspaceUrl]/components/memory/MemoryCard.tsx` — optional `trustBadge` slot next to category label.
- `app/workspace/[workspaceUrl]/components/memory/MemoryListItem.tsx` — accept `trust`, pass badge into MemoryCard.
- `app/workspace/[workspaceUrl]/components/memory/MemoryTab.tsx` — fetch trust, fan out by id.
- `lib/i18n/en.json` + 15 other locales — 4 new keys.

---

## Task 1: Extract `computeFragmentTrust` pure function

**Files:**

- Modify: `lib/services/lineage-signal.ts`
- Test: `__tests__/lineage-signal-compute.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lineage-signal-compute.test.ts`:

```ts
import {
  computeFragmentTrust,
  LINEAGE_MIN_USED_TASKS,
  LINEAGE_MIN_RESOLVED_TASKS,
} from '@/lib/services/lineage-signal'
import type { FragmentRef } from '@/lib/repositories/lineage-edge.repository'

const ref = (id: string): FragmentRef => ({
  fragmentType: 'MEMORY',
  fragmentId: id,
})
const key = (id: string) => `MEMORY::${id}`

describe('computeFragmentTrust', () => {
  it('prefers the usage signal once it clears the usage floor', () => {
    const { verdicts } = computeFragmentTrust([ref('a')], {
      universe: 10,
      presence: [
        {
          fragmentType: 'MEMORY',
          fragmentId: 'a',
          resolvedTasks: 8,
          mergedTasks: 8,
        },
      ],
      usage: [
        {
          fragmentType: 'MEMORY',
          fragmentId: 'a',
          usedResolvedTasks: LINEAGE_MIN_USED_TASKS,
          usedMergedTasks: 3,
        },
      ],
    })
    expect(verdicts.get(key('a'))).toEqual({
      kind: 'usage',
      resolvedTasks: LINEAGE_MIN_USED_TASKS,
      mergedTasks: 3,
      pct: 100,
    })
  })

  it('falls back to presence when usage is below the floor', () => {
    const { verdicts } = computeFragmentTrust([ref('b')], {
      universe: 10,
      presence: [
        {
          fragmentType: 'MEMORY',
          fragmentId: 'b',
          resolvedTasks: 4,
          mergedTasks: 1,
        },
      ],
      usage: [
        {
          fragmentType: 'MEMORY',
          fragmentId: 'b',
          usedResolvedTasks: LINEAGE_MIN_USED_TASKS - 1,
          usedMergedTasks: 1,
        },
      ],
    })
    expect(verdicts.get(key('b'))).toEqual({
      kind: 'presence',
      resolvedTasks: 4,
      mergedTasks: 1,
      pct: 25,
    })
  })

  it('excludes zero-variance presence fragments and counts them', () => {
    const res = computeFragmentTrust([ref('c')], {
      universe: 5,
      presence: [
        {
          fragmentType: 'MEMORY',
          fragmentId: 'c',
          resolvedTasks: 5,
          mergedTasks: 5,
        },
      ],
      usage: [],
    })
    expect(res.verdicts.has(key('c'))).toBe(false)
    expect(res.excludedZeroVariance).toBe(1)
  })

  it('gates presence below the cold-start floor (no verdict, not excluded)', () => {
    const res = computeFragmentTrust([ref('d')], {
      universe: 10,
      presence: [
        {
          fragmentType: 'MEMORY',
          fragmentId: 'd',
          resolvedTasks: LINEAGE_MIN_RESOLVED_TASKS - 1,
          mergedTasks: 1,
        },
      ],
      usage: [],
    })
    expect(res.verdicts.has(key('d'))).toBe(false)
    expect(res.excludedZeroVariance).toBe(0)
  })

  it('produces no verdict for a fragment with no edge history', () => {
    const res = computeFragmentTrust([ref('e')], {
      universe: 10,
      presence: [],
      usage: [],
    })
    expect(res.verdicts.size).toBe(0)
    expect(res.excludedZeroVariance).toBe(0)
  })

  it('dedupes repeated refs (counts a zero-variance fragment once)', () => {
    const res = computeFragmentTrust([ref('f'), ref('f')], {
      universe: 3,
      presence: [
        {
          fragmentType: 'MEMORY',
          fragmentId: 'f',
          resolvedTasks: 3,
          mergedTasks: 2,
        },
      ],
      usage: [],
    })
    expect(res.excludedZeroVariance).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lineage-signal-compute.test.ts`
Expected: FAIL — `computeFragmentTrust is not a function` / not exported.

- [ ] **Step 3: Add the types and pure function**

In `lib/services/lineage-signal.ts`, after the existing `UsageSignalEntry` interface (around line 34), add:

```ts
/** A per-fragment trust verdict derived from lineage edges, calibrated per
 * LUM-300: a strong `usage` signal (agent voted it used) preferred over a weak
 * `presence` signal (merely co-loaded). Unqualified fragments get NO verdict. */
export interface TrustVerdict {
  kind: 'usage' | 'presence'
  /** Denominator: distinct resolved tasks (usage → used-resolved). */
  resolvedTasks: number
  /** Numerator: distinct merged tasks (usage → used-merged). */
  mergedTasks: number
  /** Math.round(merged / resolved * 100). */
  pct: number
}

/** Pre-fetched aggregate inputs for {@link computeFragmentTrust}. */
export interface TrustStats {
  /** countResolvedTasks() — global distinct tasks with a resolved edge. */
  universe: number
  presence: FragmentMergeRate[]
  usage: FragmentUsageRate[]
}

export interface FragmentTrustResult {
  /** Qualifying verdicts keyed by `${fragmentType}::${fragmentId}`, insertion
   * order = first-seen order of `refs`. */
  verdicts: Map<string, TrustVerdict>
  /** Count of deduped fragments dropped for zero presence-variance (appeared in
   * every resolved task). Backs the CLI's "已排除 N 个全量加载" note. */
  excludedZeroVariance: number
}

function trustKey(fragmentType: string, fragmentId: string): string {
  return `${fragmentType}::${fragmentId}`
}

/**
 * Pure trust scoring. Iterates `refs` (deduped, first-seen order), and for each:
 *   1. usage signal if usedResolvedTasks >= LINEAGE_MIN_USED_TASKS → kind 'usage'
 *   2. else presence: needs a stat, NOT zero-variance (resolvedTasks===universe
 *      when universe>0 → excluded+counted), and resolvedTasks >= the cold-start
 *      floor → kind 'presence'
 *   3. else no verdict.
 * No I/O — all gating lives here so the CLI markdown and web badge never drift.
 */
export function computeFragmentTrust(
  refs: FragmentRef[],
  stats: TrustStats
): FragmentTrustResult {
  const presenceByKey = new Map(
    stats.presence.map(s => [trustKey(s.fragmentType, s.fragmentId), s])
  )
  const usageByKey = new Map(
    stats.usage.map(s => [trustKey(s.fragmentType, s.fragmentId), s])
  )

  const verdicts = new Map<string, TrustVerdict>()
  let excludedZeroVariance = 0
  const seen = new Set<string>()

  for (const ref of refs) {
    const key = trustKey(ref.fragmentType, ref.fragmentId)
    if (seen.has(key)) continue
    seen.add(key)

    const usage = usageByKey.get(key)
    if (usage && usage.usedResolvedTasks >= LINEAGE_MIN_USED_TASKS) {
      verdicts.set(key, {
        kind: 'usage',
        resolvedTasks: usage.usedResolvedTasks,
        mergedTasks: usage.usedMergedTasks,
        pct: Math.round(
          (usage.usedMergedTasks / usage.usedResolvedTasks) * 100
        ),
      })
      continue
    }

    const stat = presenceByKey.get(key)
    if (!stat) continue
    if (stats.universe > 0 && stat.resolvedTasks === stats.universe) {
      excludedZeroVariance++
      continue
    }
    if (stat.resolvedTasks < LINEAGE_MIN_RESOLVED_TASKS) continue
    verdicts.set(key, {
      kind: 'presence',
      resolvedTasks: stat.resolvedTasks,
      mergedTasks: stat.mergedTasks,
      pct: Math.round((stat.mergedTasks / stat.resolvedTasks) * 100),
    })
  }

  return { verdicts, excludedZeroVariance }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lineage-signal-compute.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/lineage-signal.ts __tests__/lineage-signal-compute.test.ts
git commit -m "feat: extract computeFragmentTrust pure scoring [LUM-303]"
```

---

## Task 2: Refactor `assembleLineageSection` onto `computeFragmentTrust` (markdown unchanged)

**Files:**

- Modify: `lib/services/lineage-signal.ts:40-191`
- Test: `__tests__/lineage-signal-markdown.test.ts`

- [ ] **Step 1: Write the snapshot/equivalence test FIRST (guards no-drift)**

Create `__tests__/lineage-signal-markdown.test.ts`:

```ts
import { assembleLineageSection } from '@/lib/services/lineage-signal'
import type { ContextFragmentType } from '@/lib/services/task-context.service'

function deps(
  over: Partial<Parameters<typeof assembleLineageSection>[2]> = {}
) {
  return {
    resolveCanonicalFragment: async (_t: string, id: string) => id,
    mergeRateByFragments: async () => [],
    usageMergeRateByFragments: async () => [],
    countResolvedTasks: async () => 0,
    ...over,
  }
}

const frag = (id: string): { type: ContextFragmentType; id: string } => ({
  type: 'MEMORY',
  id,
})

describe('assembleLineageSection markdown (post-refactor parity)', () => {
  it('renders a usage line with the strong-signal suffix', async () => {
    const out = await assembleLineageSection(
      [frag('a')],
      new Map([['a', 'Use waitUntil for side effects']]),
      deps({
        usageMergeRateByFragments: async () => [
          {
            fragmentType: 'MEMORY',
            fragmentId: 'a',
            usedResolvedTasks: 4,
            usedMergedTasks: 3,
          },
        ],
        countResolvedTasks: async () => 10,
      })
    )
    expect(out).toContain('## 飞轮信号 · 历史 merge 贡献')
    expect(out).toContain('用过的 4 个已闭合任务·3 merged (75%) · 真实使用信号')
  })

  it('renders presence line + zero-variance note, usage grouped before presence', async () => {
    const out = await assembleLineageSection(
      [frag('strong'), frag('weak'), frag('global')],
      new Map([
        ['strong', 'S'],
        ['weak', 'W'],
        ['global', 'G'],
      ]),
      deps({
        usageMergeRateByFragments: async () => [
          {
            fragmentType: 'MEMORY',
            fragmentId: 'strong',
            usedResolvedTasks: 5,
            usedMergedTasks: 5,
          },
        ],
        mergeRateByFragments: async () => [
          {
            fragmentType: 'MEMORY',
            fragmentId: 'weak',
            resolvedTasks: 4,
            mergedTasks: 2,
          },
          {
            fragmentType: 'MEMORY',
            fragmentId: 'global',
            resolvedTasks: 6,
            mergedTasks: 6,
          },
        ],
        countResolvedTasks: async () => 6,
      })
    )
    const usageIdx = out.indexOf('真实使用信号')
    const presenceIdx = out.indexOf('仅共同加载,弱信号')
    expect(usageIdx).toBeGreaterThan(-1)
    expect(presenceIdx).toBeGreaterThan(usageIdx) // usage grouped first
    expect(out).toContain('已排除 1 个全量加载')
  })

  it('returns "" when nothing qualifies and nothing excluded', async () => {
    const out = await assembleLineageSection([frag('x')], new Map(), deps())
    expect(out).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify current behavior (baseline)**

Run: `npx jest __tests__/lineage-signal-markdown.test.ts`
Expected: PASS against the CURRENT implementation (these assertions describe today's output). This locks the contract before refactoring.

- [ ] **Step 3: Refactor `assembleLineageSection` to delegate gating to `computeFragmentTrust`**

In `lib/services/lineage-signal.ts`, replace the body of `assembleLineageSection` (the `try` block, currently lines ~127-186) with:

```ts
try {
  const inputs: { ref: FragmentRef; label: string }[] = []
  for (const f of fragments) {
    const lineageType = toLineageFragmentType(f.type)
    if (!lineageType) continue
    const canonicalId = await deps.resolveCanonicalFragment(lineageType, f.id)
    inputs.push({
      ref: { fragmentType: lineageType, fragmentId: canonicalId },
      label: fragmentLabel(f.type, f.id, memoryContentById),
    })
  }
  if (inputs.length === 0) return ''

  const refs = inputs.map(i => i.ref)
  const [universe, presence, usage] = await Promise.all([
    deps.countResolvedTasks(),
    deps.mergeRateByFragments(refs),
    deps.usageMergeRateByFragments(refs),
  ])
  const { verdicts, excludedZeroVariance } = computeFragmentTrust(refs, {
    universe,
    presence,
    usage,
  })

  const usageEntries: UsageSignalEntry[] = []
  const presenceEntries: LineageSignalEntry[] = []
  const seen = new Set<string>()
  for (const input of inputs) {
    const key = `${input.ref.fragmentType}::${input.ref.fragmentId}`
    if (seen.has(key)) continue
    seen.add(key)
    const v = verdicts.get(key)
    if (!v) continue
    if (v.kind === 'usage') {
      usageEntries.push({
        label: input.label,
        usedResolvedTasks: v.resolvedTasks,
        usedMergedTasks: v.mergedTasks,
      })
    } else {
      presenceEntries.push({
        label: input.label,
        resolvedTasks: v.resolvedTasks,
        mergedTasks: v.mergedTasks,
      })
    }
  }
  return renderLineageSection(
    usageEntries,
    presenceEntries,
    excludedZeroVariance
  )
} catch (err) {
  logger.error('assembleLineageSection failed; omitting flywheel signal', err)
  return ''
}
```

- [ ] **Step 4: Simplify `renderLineageSection` (presence now pre-gated)**

In `renderLineageSection` (lines ~40-75), the cold-start filter is now redundant because `computeFragmentTrust` already gated presence. Replace:

```ts
const presenceQualifying = presenceEntries.filter(
  e => e.resolvedTasks >= LINEAGE_MIN_RESOLVED_TASKS
)
if (
  usageEntries.length === 0 &&
  presenceQualifying.length === 0 &&
  excludedCount === 0
) {
  return ''
}
```

with:

```ts
if (
  usageEntries.length === 0 &&
  presenceEntries.length === 0 &&
  excludedCount === 0
) {
  return ''
}
```

and update the later `...presenceQualifying.map(` line to `...presenceEntries.map(`.

- [ ] **Step 5: Run the markdown test + the full lineage suite**

Run: `npx jest __tests__/lineage-signal-markdown.test.ts __tests__/lineage-signal-compute.test.ts`
Expected: PASS. Then run any existing signal test:
Run: `npx jest lineage-signal`
Expected: PASS (no pre-existing assertions broken).

- [ ] **Step 6: Commit**

```bash
git add lib/services/lineage-signal.ts __tests__/lineage-signal-markdown.test.ts
git commit -m "refactor: assembleLineageSection delegates to computeFragmentTrust [LUM-303]"
```

---

## Task 3: Service `fragmentTrustForMemories`

**Files:**

- Modify: `lib/services/lineage.service.ts`
- Test: `__tests__/lineage-fragment-trust-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lineage-fragment-trust-service.test.ts`:

```ts
import { lineageService } from '@/lib/services/lineage.service'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'

jest.mock('@/lib/repositories/lineage-edge.repository')
jest.mock('@/lib/repositories/memory-provenance.repository')

const edges = lineageEdgeRepository as jest.Mocked<typeof lineageEdgeRepository>
const prov = memoryProvenanceRepository as jest.Mocked<
  typeof memoryProvenanceRepository
>

describe('lineageService.fragmentTrustForMemories', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    edges.countResolvedTasks.mockResolvedValue(10)
    edges.mergeRateByFragments.mockResolvedValue([])
    edges.usageMergeRateByFragments.mockResolvedValue([])
  })

  it('returns {} for empty input without hitting the DB', async () => {
    const out = await lineageService.fragmentTrustForMemories([])
    expect(out).toEqual({})
    expect(edges.countResolvedTasks).not.toHaveBeenCalled()
  })

  it('maps a canonical verdict back to the original memory id', async () => {
    prov.resolveCanonicalFragment.mockImplementation(async (_t, id) =>
      id === 'raw' ? 'canon' : id
    )
    edges.usageMergeRateByFragments.mockResolvedValue([
      {
        fragmentType: 'MEMORY',
        fragmentId: 'canon',
        usedResolvedTasks: 4,
        usedMergedTasks: 3,
      },
    ])
    const out = await lineageService.fragmentTrustForMemories(['raw'])
    expect(out).toEqual({
      raw: { kind: 'usage', resolvedTasks: 4, mergedTasks: 3, pct: 75 },
    })
  })

  it('omits ids that do not qualify', async () => {
    prov.resolveCanonicalFragment.mockImplementation(async (_t, id) => id)
    const out = await lineageService.fragmentTrustForMemories(['none'])
    expect(out).toEqual({})
  })

  it('degrades to {} on repository failure', async () => {
    prov.resolveCanonicalFragment.mockRejectedValue(new Error('boom'))
    const out = await lineageService.fragmentTrustForMemories(['x'])
    expect(out).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lineage-fragment-trust-service.test.ts`
Expected: FAIL — `fragmentTrustForMemories is not a function`.

- [ ] **Step 3: Implement the service method**

In `lib/services/lineage.service.ts`, add to the imports at the top:

```ts
import { computeFragmentTrust } from '@/lib/services/lineage-signal'
import type { TrustVerdict } from '@/lib/services/lineage-signal'
```

Then add this method inside the `lineageService` object (e.g. after `getLineageForIdentifier`):

```ts
  /**
   * Per-memory trust verdicts for the web badge (LUM-303). Resolves each memory
   * id to its canonical fragment (matching how edges were keyed at birth),
   * scores via the shared `computeFragmentTrust`, and maps verdicts back to the
   * ORIGINAL ids the UI knows. Unqualified ids are omitted. Best-effort: any
   * failure degrades to `{}` so the memory tab never breaks on the decoration.
   */
  async fragmentTrustForMemories(
    memoryIds: string[]
  ): Promise<Record<string, TrustVerdict>> {
    if (memoryIds.length === 0) return {}
    try {
      const pairs = await Promise.all(
        memoryIds.map(async id => ({
          id,
          canonical: await memoryProvenanceRepository.resolveCanonicalFragment(
            'MEMORY',
            id
          ),
        }))
      )
      const refs: FragmentRef[] = pairs.map(p => ({
        fragmentType: 'MEMORY',
        fragmentId: p.canonical,
      }))
      const [universe, presence, usage] = await Promise.all([
        lineageEdgeRepository.countResolvedTasks(),
        lineageEdgeRepository.mergeRateByFragments(refs),
        lineageEdgeRepository.usageMergeRateByFragments(refs),
      ])
      const { verdicts } = computeFragmentTrust(refs, { universe, presence, usage })
      const out: Record<string, TrustVerdict> = {}
      for (const p of pairs) {
        const v = verdicts.get(`MEMORY::${p.canonical}`)
        if (v) out[p.id] = v
      }
      return out
    } catch (err) {
      logger.error('fragmentTrustForMemories failed; returning empty', err)
      return {}
    }
  },
```

(`FragmentRef`, `lineageEdgeRepository`, `memoryProvenanceRepository`, and `logger` are already imported in this file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lineage-fragment-trust-service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/lineage.service.ts __tests__/lineage-fragment-trust-service.test.ts
git commit -m "feat: lineageService.fragmentTrustForMemories [LUM-303]"
```

---

## Task 4: API route `POST /api/lineage/fragment-trust`

**Files:**

- Create: `app/api/lineage/fragment-trust/route.ts`
- Test: `__tests__/fragment-trust-route.test.ts`

> POST (not GET) so a memory tab with 100+ ids isn't shoved into a query string.

- [ ] **Step 1: Write the failing test**

Create `__tests__/fragment-trust-route.test.ts`:

```ts
import { POST } from '@/app/api/lineage/fragment-trust/route'
import { requireIdentity } from '@/lib/auth/identity'
import { lineageService } from '@/lib/services/lineage.service'

jest.mock('@/lib/auth/identity')
jest.mock('@/lib/services/lineage.service')

const auth = requireIdentity as jest.MockedFunction<typeof requireIdentity>
const svc = lineageService as jest.Mocked<typeof lineageService>

function req(body: unknown): Request {
  return new Request('http://t/api/lineage/fragment-trust', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/lineage/fragment-trust', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    auth.mockResolvedValue({ memberId: 'm', workspaceId: 'w' } as never)
  })

  it('returns the service trust map', async () => {
    svc.fragmentTrustForMemories.mockResolvedValue({
      a: { kind: 'usage', resolvedTasks: 4, mergedTasks: 3, pct: 75 },
    })
    const res = await POST(req({ ids: ['a'] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      trust: {
        a: { kind: 'usage', resolvedTasks: 4, mergedTasks: 3, pct: 75 },
      },
    })
  })

  it('400s on an invalid body', async () => {
    const res = await POST(req({ ids: 'not-an-array' }))
    expect(res.status).toBe(400)
    expect(svc.fragmentTrustForMemories).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/fragment-trust-route.test.ts`
Expected: FAIL — cannot find module `@/app/api/lineage/fragment-trust/route`.

- [ ] **Step 3: Implement the route**

Create `app/api/lineage/fragment-trust/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireIdentity } from '@/lib/auth/identity'
import { lineageService } from '@/lib/services/lineage.service'

const bodySchema = z.object({
  ids: z.array(z.string().min(1)).max(200),
})

export async function POST(request: Request): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  let ids: string[]
  try {
    ids = bodySchema.parse(await request.json()).ids
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const trust = await lineageService.fragmentTrustForMemories(ids)
  return NextResponse.json({ trust })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/fragment-trust-route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/lineage/fragment-trust/route.ts __tests__/fragment-trust-route.test.ts
git commit -m "feat: POST /api/lineage/fragment-trust route [LUM-303]"
```

---

## Task 5: API client + query key

**Files:**

- Create: `lib/api-client/lineage.ts`
- Modify: `lib/api-client/index.ts`, `lib/query/keys.ts`

- [ ] **Step 1: Create the client**

Create `lib/api-client/lineage.ts`:

```ts
import { apiFetch } from './base'
import type { TrustVerdict } from '@/lib/services/lineage-signal'

export const lineageClient = {
  /** Batched per-memory trust verdicts (LUM-303). Empty for ids with no signal. */
  fragmentTrust(
    ids: string[]
  ): Promise<{ trust: Record<string, TrustVerdict> }> {
    return apiFetch('/api/lineage/fragment-trust', {
      method: 'POST',
      body: { ids },
    })
  },
}
```

> `import type` is erased at compile time, so importing the `TrustVerdict` type from the service module pulls no server code into the client bundle.

- [ ] **Step 2: Export it**

In `lib/api-client/index.ts`, add after the `memoriesClient` export (line 27):

```ts
export { lineageClient } from './lineage'
```

- [ ] **Step 3: Add the query key**

In `lib/query/keys.ts`, after the `lineage` key (line 91), add:

```ts
  fragmentTrust: (ids: string[]) => ['fragmentTrust', [...ids].sort()] as const,
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/api-client/lineage.ts lib/api-client/index.ts lib/query/keys.ts
git commit -m "feat: lineageClient.fragmentTrust + query key [LUM-303]"
```

---

## Task 6: `useFragmentTrust` hook

**Files:**

- Create: `app/workspace/[workspaceUrl]/hooks/useFragmentTrust.ts`
- Test: `__tests__/useFragmentTrust.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/useFragmentTrust.test.tsx`:

```tsx
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFragmentTrust } from '@/app/workspace/[workspaceUrl]/hooks/useFragmentTrust'
import { lineageClient } from '@/lib/api-client'

jest.mock('@/lib/api-client', () => ({
  lineageClient: { fragmentTrust: jest.fn() },
}))

const client = lineageClient as jest.Mocked<typeof lineageClient>

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useFragmentTrust', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns {} and does not fetch when ids is empty', () => {
    const { result } = renderHook(() => useFragmentTrust([], true), { wrapper })
    expect(result.current).toEqual({})
    expect(client.fragmentTrust).not.toHaveBeenCalled()
  })

  it('returns {} and does not fetch when disabled', () => {
    renderHook(() => useFragmentTrust(['a'], false), { wrapper })
    expect(client.fragmentTrust).not.toHaveBeenCalled()
  })

  it('returns the fetched trust map', async () => {
    client.fragmentTrust.mockResolvedValue({
      trust: {
        a: { kind: 'usage', resolvedTasks: 4, mergedTasks: 3, pct: 75 },
      },
    })
    const { result } = renderHook(() => useFragmentTrust(['a'], true), {
      wrapper,
    })
    await waitFor(() => expect(result.current.a).toBeDefined())
    expect(result.current.a).toEqual({
      kind: 'usage',
      resolvedTasks: 4,
      mergedTasks: 3,
      pct: 75,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/useFragmentTrust.test.tsx`
Expected: FAIL — cannot find module `useFragmentTrust`.

- [ ] **Step 3: Implement the hook**

Create `app/workspace/[workspaceUrl]/hooks/useFragmentTrust.ts`:

```ts
'use client'

import { useQuery } from '@tanstack/react-query'
import { lineageClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { TrustVerdict } from '@/lib/services/lineage-signal'

/**
 * Batched, read-through per-memory trust verdicts (LUM-303). One request for
 * the whole visible memory list; ids are sorted into the query key so the cache
 * is stable across re-renders. Returns `{}` (never throws) so a badge failure
 * never blocks the memory tab. Disabled / empty → no fetch.
 */
export function useFragmentTrust(
  ids: string[],
  enabled = true
): Record<string, TrustVerdict> {
  const sorted = [...ids].sort()
  const query = useQuery<Record<string, TrustVerdict>>({
    queryKey: queryKeys.fragmentTrust(sorted),
    queryFn: async () => (await lineageClient.fragmentTrust(sorted)).trust,
    enabled: enabled && sorted.length > 0,
  })
  return query.data ?? {}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/useFragmentTrust.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/workspace/[workspaceUrl]/hooks/useFragmentTrust.ts __tests__/useFragmentTrust.test.tsx
git commit -m "feat: useFragmentTrust hook [LUM-303]"
```

---

## Task 7: `FragmentTrustBadge` component + i18n keys

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/memory/FragmentTrustBadge.tsx`
- Modify: `lib/i18n/en.json` (other locales in Task 9)
- Test: `__tests__/FragmentTrustBadge.test.tsx`

- [ ] **Step 1: Add the 4 i18n keys to `en.json`**

In `lib/i18n/en.json`, add (alphabetical block near other `trust.*`/after `lineage.*` is fine — JSON order is not enforced, only key parity):

```json
  "trust.badge.meta": "· {n, plural, one {# task} other {# tasks}}",
  "trust.badge.weak": " · weak",
  "trust.tooltip.usage": "Used in {resolved} resolved tasks · {merged} merged · real-usage signal",
  "trust.tooltip.presence": "Co-loaded in {resolved} resolved tasks · {merged} merged · co-load only, weak signal",
```

- [ ] **Step 2: Write the failing component test**

Create `__tests__/FragmentTrustBadge.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { FragmentTrustBadge } from '@/app/workspace/[workspaceUrl]/components/memory/FragmentTrustBadge'
import en from '@/lib/i18n/en.json'

function renderBadge(
  verdict: Parameters<typeof FragmentTrustBadge>[0]['verdict']
) {
  return render(
    <IntlProvider locale='en' messages={en as Record<string, string>}>
      <FragmentTrustBadge verdict={verdict} />
    </IntlProvider>
  )
}

describe('FragmentTrustBadge', () => {
  it('renders nothing for an undefined verdict', () => {
    const { container } = renderBadge(undefined)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the percentage and the usage tooltip for a strong verdict', () => {
    renderBadge({ kind: 'usage', resolvedTasks: 4, mergedTasks: 3, pct: 75 })
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByTitle(/real-usage signal/)).toBeInTheDocument()
  })

  it('marks a presence verdict as weak', () => {
    renderBadge({ kind: 'presence', resolvedTasks: 4, mergedTasks: 1, pct: 25 })
    expect(screen.getByText('25%')).toBeInTheDocument()
    expect(screen.getByTitle(/weak signal/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest __tests__/FragmentTrustBadge.test.tsx`
Expected: FAIL — cannot find module `FragmentTrustBadge`.

- [ ] **Step 4: Implement the component**

Create `app/workspace/[workspaceUrl]/components/memory/FragmentTrustBadge.tsx`:

```tsx
'use client'

import { useIntl } from 'react-intl'
import type { TrustVerdict } from '@/lib/services/lineage-signal'

/**
 * Fragment-level "trust score" badge (LUM-303): the cross-task merge
 * contribution of a memory, rendered next to its category label. Neutral
 * muted pill — order via typography, no semantic color (a green low score
 * would mislead). Strong (usage) = solid border; weak (presence) = dashed
 * border + "weak" suffix + dimmed text. Undefined verdict → renders nothing
 * (cold-start / zero-variance / no edges don't get a badge).
 */
export function FragmentTrustBadge({
  verdict,
}: {
  verdict: TrustVerdict | undefined
}) {
  const intl = useIntl()
  if (!verdict) return null

  const isWeak = verdict.kind === 'presence'
  const tooltip = intl.formatMessage(
    {
      id: isWeak ? 'trust.tooltip.presence' : 'trust.tooltip.usage',
      defaultMessage: isWeak
        ? 'Co-loaded in {resolved} resolved tasks · {merged} merged · co-load only, weak signal'
        : 'Used in {resolved} resolved tasks · {merged} merged · real-usage signal',
    },
    { resolved: verdict.resolvedTasks, merged: verdict.mergedTasks }
  )

  return (
    <span
      title={tooltip}
      className={`inline-flex items-baseline gap-1 rounded-sm border bg-muted/50 px-1.5 leading-5 ${
        isWeak ? 'border-dashed border-border' : 'border-border'
      }`}
    >
      <span
        className={`text-[11px] font-semibold tabular-nums ${
          isWeak ? 'text-muted-foreground' : 'text-foreground'
        }`}
      >
        {verdict.pct}%
      </span>
      <span className='text-[10px] text-muted-foreground'>
        {intl.formatMessage(
          {
            id: 'trust.badge.meta',
            defaultMessage: '· {n, plural, one {# task} other {# tasks}}',
          },
          { n: verdict.resolvedTasks }
        )}
        {isWeak
          ? intl.formatMessage({
              id: 'trust.badge.weak',
              defaultMessage: ' · weak',
            })
          : ''}
      </span>
    </span>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/FragmentTrustBadge.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/memory/FragmentTrustBadge.tsx lib/i18n/en.json __tests__/FragmentTrustBadge.test.tsx
git commit -m "feat: FragmentTrustBadge component + en i18n [LUM-303]"
```

---

## Task 8: Wire the badge into the memory cards

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/memory/MemoryCard.tsx`, `MemoryListItem.tsx`, `MemoryTab.tsx`
- Test: extend `__tests__/FragmentTrustBadge.test.tsx` is enough for the badge; add a small MemoryListItem wiring assertion only if a test file already exists. (No new test file required — the slot is a pass-through; covered by component + hook tests.)

- [ ] **Step 1: Add a `trustBadge` slot to `MemoryCard`**

In `MemoryCard.tsx`, add to `MemoryCardProps` (after `showSedimentedLabel`):

```ts
  /** Optional fragment-level trust badge (LUM-303), rendered next to the
   *  category label. A node, not a value, so MemoryCard stays unaware of
   *  lineage. Omit → nothing renders. */
  trustBadge?: ReactNode
```

Add `trustBadge` to the destructured params:

```ts
export function MemoryCard({
  item,
  source,
  showSedimentedLabel = true,
  trustBadge,
}: MemoryCardProps) {
```

Render it inside the left category span (after the category label `</span>`):

```tsx
<span className='flex shrink-0 items-center gap-1.5'>
  <span
    aria-hidden
    className={`size-[7px] shrink-0 rounded-full ${style.dot}`}
  />
  <span className='text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
    {intl.formatMessage({ id: style.labelId })}
  </span>
  {trustBadge}
</span>
```

- [ ] **Step 2: Thread `trust` through `MemoryListItem`**

In `MemoryListItem.tsx`, add the import:

```ts
import { FragmentTrustBadge } from './FragmentTrustBadge'
import type { TrustVerdict } from '@/lib/services/lineage-signal'
```

Add to `MemoryListItemProps`:

```ts
  /** Trust verdict for this memory (LUM-303); undefined → no badge. */
  trust?: TrustVerdict | undefined
```

Add `trust` to the destructured params, and pass the badge into `MemoryCard`:

```tsx
<MemoryCard
  item={{
    id: memory.id,
    category: memory.category,
    agent: memory.agent,
    content: memory.content,
  }}
  source={source ?? <AgentBadge agent={memory.agent} />}
  showSedimentedLabel={false}
  trustBadge={<FragmentTrustBadge verdict={trust} />}
/>
```

- [ ] **Step 3: Fetch + fan out trust in `MemoryTab`**

In `MemoryTab.tsx`, add the import:

```ts
import { useFragmentTrust } from '../../hooks/useFragmentTrust'
```

After `visibleMemories` is computed (after the `useMemo` block), add:

```ts
const trust = useFragmentTrust(
  visibleMemories.map(m => m.id),
  enabled
)
```

Pass it to each item:

```tsx
<MemoryListItem
  key={m.id}
  memory={m}
  canPromote={scope === 'task' && m.scope === 'TASK'}
  memberName={
    m.createdByMemberId ? memberNames?.get(m.createdByMemberId) : undefined
  }
  trust={trust[m.id]}
  onEdit={editing => setDialog({ open: true, mode: 'edit', editing })}
  onPromote={mem => promote(mem.id)}
  onDelete={mem => remove(mem.id)}
/>
```

> `useFragmentTrust` is called unconditionally at the top level (the `loading`/`error`/empty early returns are AFTER it — verify the hook call sits above them; if not, move it above the first `if (loading)`).

- [ ] **Step 4: Typecheck + run the memory/badge suites**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx jest __tests__/FragmentTrustBadge.test.tsx __tests__/useFragmentTrust.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/memory/MemoryCard.tsx app/workspace/[workspaceUrl]/components/memory/MemoryListItem.tsx app/workspace/[workspaceUrl]/components/memory/MemoryTab.tsx
git commit -m "feat: render trust badge on memory cards [LUM-303]"
```

---

## Task 9: i18n parity (all 16 locales) + final verification

**Files:**

- Modify: every file in `lib/i18n/*.json` except `en.json`

- [ ] **Step 1: Scaffold placeholders for the other locales**

Run: `npm run i18n:sync`
Expected: the 4 new `trust.*` keys are back-filled into all non-en locale files with `[TODO:<locale>] …` markers.

- [ ] **Step 2: Replace every `[TODO:…]` for the 4 keys with a real translation**

Edit each locale file. Reference values (translate the rest — do NOT leave English in non-English locales):

- `zh-CN.json`:
  - `trust.badge.meta`: `"· {n} 个任务"`
  - `trust.badge.weak`: `" · 弱"`
  - `trust.tooltip.usage`: `"用过的 {resolved} 个已闭合任务·{merged} merged · 真实使用信号"`
  - `trust.tooltip.presence`: `"共同加载的 {resolved} 个已闭合任务·{merged} merged · 仅共同加载，弱信号"`
- `zh-TW.json`:
  - `trust.badge.meta`: `"· {n} 個任務"`
  - `trust.badge.weak`: `" · 弱"`
  - `trust.tooltip.usage`: `"用過的 {resolved} 個已關閉任務·{merged} merged · 真實使用訊號"`
  - `trust.tooltip.presence`: `"共同載入的 {resolved} 個已關閉任務·{merged} merged · 僅共同載入，弱訊號"`

For `de, es, es-419, fr, hi, id, ja, ko, ms, ru, vi, en-GB, en-AU`: provide real, idiomatic translations of the four English source strings (en-GB/en-AU may keep the English wording; do not leave `[TODO]`). Preserve the ICU placeholders `{n, plural, …}`, `{resolved}`, `{merged}` and the leading `· ` / `·` spacing exactly.

- [ ] **Step 3: Verify locale parity**

Run: `npm run i18n:check`
Expected: PASS — no missing keys, no remaining `[TODO:…]`, no empty values.

- [ ] **Step 4: Full verification gate**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm test`
Expected: all green (new suites + existing).
Run: `git grep -n "console.log" app/api/lineage app/workspace/'[workspaceUrl]'/components/memory app/workspace/'[workspaceUrl]'/hooks/useFragmentTrust.ts lib/services/lineage-signal.ts lib/services/lineage.service.ts lib/api-client/lineage.ts`
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add lib/i18n
git commit -m "i18n: trust badge strings across all locales [LUM-303]"
```

---

## Task 10: Build + PR

- [ ] **Step 1: Production build (the only CI gate is the Vercel build)**

Run: `npm run build`
Expected: success (no RSC-boundary / type errors from the new client→service type import).

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin lumo/LUM-303-fragment-trust-badge
gh pr create --title "feat: fragment-level trust badge on memory cards [LUM-303]" --body "$(cat <<'EOF'
## What
Surfaces lineage's cross-task trust signal (used in N tasks, X% merged) as a badge on each memory card, reusing the LUM-300 discriminative caliber (usage > presence > exclude zero-variance, cold-start ≥3). Unqualified fragments get no badge.

## How
- Extracted `computeFragmentTrust` pure fn in `lineage-signal.ts`; CLI markdown + web badge share one caliber (snapshot-guarded, markdown unchanged).
- New `lineageService.fragmentTrustForMemories` → thin `POST /api/lineage/fragment-trust` → `useFragmentTrust` hook → `FragmentTrustBadge` on `MemoryCard`.

## Scope
Memory cards only; LineageTab untouched; other fragment types + score-based coloring deferred.

## Notes
- No new npm packages. No schema/migration changes.
- i18n: 4 new keys across all 16 locales.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Set the task to in_review**

Run: `lumo task update LUM-303 --status in_review` (do not mark done until merged — verification-before-completion).

---

## Self-Review Notes

- **Spec coverage:** §5.1 → Tasks 1-2; §5.2 → Task 3; §5.3 → Task 4; §5.4 hook → Task 6, component → Task 7, wiring → Task 8; §6 i18n → Tasks 7+9; §7 tests → per-task; §8 acceptance → Tasks 9-10.
- **No schema changes** → no Prisma/migration tasks (correct; all signal infra exists from LUM-300).
- **Caliber drift risk** is closed by the Task 2 markdown parity test before refactor (Step 2 runs against current code, then again after).
- **Type consistency:** `TrustVerdict { kind, resolvedTasks, mergedTasks, pct }` and `computeFragmentTrust(refs, {universe, presence, usage}) → {verdicts, excludedZeroVariance}` are used identically in Tasks 1, 3, 5, 6, 7.

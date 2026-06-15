/**
 * LUM-500 — progressive-disclosure reachability guard (read-only, pre-ship / CI).
 *
 * Hard invariant: a fragment that historically contributed to a merged task
 * MUST remain reachable under the new progressive-disclosure model. "Reachable"
 * means the agent can still get to the fragment's content — either because it
 * is injected in full (Tier-0/1) or because it appears in a Tier-2 index /
 * manifest line (including the "+N more, browse" pointer for MEMORY).
 *
 * This script:
 *   1. Loads every distinct (fragmentType, fragmentId) pair whose lineage edges
 *      carry outcome = MERGED (i.e. the fragment contributed to merged work).
 *   2. Builds the `reachable` set per the NEW model's rules: any merged fragment
 *      whose type is in DISCLOSED_FRAGMENT_TYPES is reachable.
 *      DISCLOSED_FRAGMENT_TYPES is the single source of truth — if a future
 *      refactor stops surfacing a type (drops it from the index/manifest), you
 *      must remove it here, and this guard will fire for any now-unreachable
 *      historical fragment of that type.
 *   3. Calls unreachableMergedFragments(merged, reachable).
 *   4. Exits 1 and lists violations if any are found; exits 0 with a summary
 *      if the invariant holds.
 *
 * Read-only: no writes, no mutations. Uses DATABASE_URL already in env (same
 * dev DB the project uses; do NOT pass a prod URL unless you intend to check
 * prod).
 *
 * Usage:
 *   npx tsx scripts/eval/disclosure-reachability.ts
 */
import { prisma } from '@/lib/db/prisma'
import {
  fragmentReachKey,
  unreachableMergedFragments,
  type FragmentKey,
} from '@/lib/services/memory/disclosure-reachability'

/**
 * The exhaustive set of fragment types the new progressive-disclosure model
 * still surfaces to the agent — either injected full (Tier-0/1) or present as
 * a Tier-2 index / manifest line the agent can `lumo … show` to retrieve.
 *
 * Types in this set: reachable.
 * Types NOT in this set: unreachable → guard fires for any merged fragment of
 * that type.
 *
 * Current model (LUM-500 baseline — none dropped):
 *   MEMORY          — Tier-2 index ("+N more, browse" pointer included)
 *   SLACK_CONTEXT   — Tier-2 manifest
 *   WEB_LINK        — Tier-2 manifest
 *   FIGMA           — Tier-2 manifest
 *   PR              — Tier-2 manifest
 *   PR_REVIEW_TODO  — injected full (Tier-1)
 *   SESSION         — injected full (Tier-1)
 */
const DISCLOSED_FRAGMENT_TYPES = new Set([
  'MEMORY',
  'SLACK_CONTEXT',
  'WEB_LINK',
  'FIGMA',
  'PR',
  'PR_REVIEW_TODO',
  'SESSION',
])

export async function main(): Promise<number> {
  // Load all distinct (fragmentType, fragmentId) pairs that have at least one
  // MERGED edge — these are the fragments that historically contributed to
  // merged work. We dedup by groupBy so we get one entry per unique pair
  // regardless of how many edges exist.
  const rows = await prisma.lineageEdge.groupBy({
    by: ['fragmentType', 'fragmentId'],
    where: { outcome: 'MERGED' },
  })

  const merged: FragmentKey[] = rows.map(r => ({
    fragmentType: r.fragmentType as string,
    fragmentId: r.fragmentId,
  }))

  // Build the reachable set: every merged fragment whose type is still
  // disclosed by the new model. The keying matches fragmentReachKey exactly —
  // both use `fragmentType:fragmentId`.
  const reachable = new Set<string>()
  for (const f of merged) {
    if (DISCLOSED_FRAGMENT_TYPES.has(f.fragmentType)) {
      reachable.add(fragmentReachKey(f))
    }
  }

  const violations = unreachableMergedFragments(merged, reachable)

  if (violations.length > 0) {
    process.stderr.write(
      `✗ disclosure-reachability: ${violations.length} merged fragment(s) are UNREACHABLE under the new model:\n`
    )
    // Group by type for a readable summary.
    const byType = new Map<string, string[]>()
    for (const v of violations) {
      const ids = byType.get(v.fragmentType) ?? []
      ids.push(v.fragmentId)
      byType.set(v.fragmentType, ids)
    }
    for (const [type, ids] of byType) {
      process.stderr.write(`  ${type}: ${ids.length} fragment(s)\n`)
      for (const id of ids.slice(0, 5)) {
        process.stderr.write(`    - ${id}\n`)
      }
      if (ids.length > 5) {
        process.stderr.write(`    … and ${ids.length - 5} more\n`)
      }
    }
    process.stderr.write(
      `\nTo fix: add the missing type(s) to DISCLOSED_FRAGMENT_TYPES in\n` +
        `scripts/eval/disclosure-reachability.ts if the new model truly surfaces\n` +
        `them, or investigate why they were dropped from the disclosure model.\n`
    )
    return 1
  }

  process.stdout.write(
    `✓ reachability OK: ${merged.length} merged fragment(s), 0 unreachable\n`
  )
  return 0
}

// Run only when invoked directly (not when imported by a test).
if (require.main === module) {
  main()
    .then(code => process.exit(code))
    .catch(err => {
      process.stderr.write(
        `disclosure-reachability: ${(err as Error).message ?? String(err)}\n`
      )
      process.exit(1)
    })
}

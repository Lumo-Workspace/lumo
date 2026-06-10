/**
 * LUM-396 grounding live eval — key-gated (AI_GATEWAY_API_KEY), NOT in CI.
 *
 * Runs the real `groundCandidates` gate over the annotated grounding corpus
 * (ground-set.ts) and scores two numbers:
 * - interception: UNSUPPORTED (hallucination) candidates that were discarded;
 * - protection:   SUPPORTED (grounded) candidates that were kept.
 *
 * Exit 0 only when interception = 100% AND protection = 100% — the corpus is
 * small and clear-cut by construction, so anything less is a regression in
 * either the gate prompt or the model.
 *
 * Usage: npx tsx scripts/eval/memory/ground-runner.ts
 */
export async function runGroundEval(): Promise<boolean> {
  // eslint-disable-next-line no-console
  const log = console.log
  const { groundEvalSet, validateGroundEvalSet } = await import('./ground-set')
  // Dynamic import AFTER dotenv (ground-candidates pulls the gateway chain).
  const { groundCandidates } = await import(
    '@/lib/services/memory/ground-candidates'
  )

  const problems = validateGroundEvalSet(groundEvalSet)
  if (problems.length) {
    // eslint-disable-next-line no-console
    console.error('ground-set invalid:\n' + problems.join('\n'))
    return false
  }

  let interceptHit = 0
  let interceptTotal = 0
  let protectHit = 0
  let protectTotal = 0

  log('=== LUM-396 Grounding Eval (live, quote-or-discard) ===\n')
  for (const c of groundEvalSet) {
    const { kept } = await groundCandidates({
      sourceText: c.sourceText,
      candidates: c.candidates,
      logTag: `ground-eval.${c.id}`,
    })
    const keptSet = new Set(kept)
    for (const cand of c.candidates) {
      const wasKept = keptSet.has(cand)
      const wantKept = cand.expected === 'SUPPORTED'
      const ok = wasKept === wantKept
      if (cand.expected === 'UNSUPPORTED') {
        interceptTotal++
        if (ok) interceptHit++
      } else {
        protectTotal++
        if (ok) protectHit++
      }
      const summary =
        (cand.content as { summary?: string }).summary ?? JSON.stringify(cand.content).slice(0, 50)
      log(
        `  ${ok ? '✓' : '✗'} ${c.id} [${cand.expected}${ok ? '' : wasKept ? ' but KEPT' : ' but DISCARDED'}] ${summary}`
      )
    }
  }

  const interception = interceptTotal ? interceptHit / interceptTotal : 0
  const protection = protectTotal ? protectHit / protectTotal : 0
  log(
    `\n— HEADLINE —\n  interception (hallucination discarded) = ${interceptHit}/${interceptTotal} (${(interception * 100).toFixed(0)}%)\n  protection (grounded kept)             = ${protectHit}/${protectTotal} (${(protection * 100).toFixed(0)}%)`
  )
  return interception === 1 && protection === 1
}

if (require.main === module) {
  void import('dotenv').then(({ config }) => {
    config({ path: '.env.local' })
    if (!process.env.AI_GATEWAY_API_KEY) {
      // eslint-disable-next-line no-console
      console.error(
        'ground-runner: AI_GATEWAY_API_KEY missing — this live eval needs the gateway key (.env.local).'
      )
      process.exit(1)
    }
    runGroundEval()
      .then(pass => process.exit(pass ? 0 : 1))
      .catch(err => {
        // eslint-disable-next-line no-console
        console.error(err)
        process.exit(1)
      })
  })
}

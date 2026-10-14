/**
 * LUM-1131 — the shipped thread-reply classifier (deterministic gate AND the
 * FAST-tier model, `decideLearning`) on the labelled set, against the real
 * model. Precision target: 100% (no non-learning stored); recall ≥ 80%.
 *
 * Writes `results.json` next to this file: per run, per reply (index into
 * `LABELLED_REPLIES`), the gate label, the model verdict, how many model
 * calls it took and the decision; the first run also keeps the learning
 * sentence.
 *
 * LUM-1139: the model is asked exactly as the service asks it — only for a
 * reply the gate labelled LEARNING, through `classifyWithRetry` (one retry
 * on a refusal or a failed call). A gate-rejected reply is never sent.
 *
 * Run (needs AI_GATEWAY_API_KEY):
 *   DOTENV_CONFIG_PATH=/abs/.env.local npx tsx -r dotenv/config \
 *     scripts/analysis/lum1131-thread-reply/probe.ts [--runs 3]
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { guardInjectedText } from '@/lib/security-scan/inject-guard'
import {
  decideLearning,
  screenReply,
} from '@/ee/security/security-scan/thread-reply'
import {
  classifyThreadReply,
  THREAD_REPLY_MODELS,
} from '@/ee/security/llm/thread-reply-client'
import { classifyWithRetry } from '@/ee/security/security-scan/thread-reply-retry'
import { LABELLED_FINDING, LABELLED_REPLIES } from './labelled'

async function main(): Promise<void> {
  const i = process.argv.indexOf('--runs')
  const runs = i > 0 ? Number(process.argv[i + 1]) : 3
  const out: unknown[] = []
  let tp = 0
  let fp = 0
  let fn = 0
  let modelOnlyTp = 0
  let modelOnlyFp = 0
  let retries = 0
  let vetoed = 0
  let vetoChances = 0
  for (let run = 0; run < runs; run++) {
    for (const item of LABELLED_REPLIES) {
      const gate = screenReply(item.reply)
      const guarded = guardInjectedText(item.reply)
      let verdict = null
      let attempts = 0
      let retried: string | null = null
      if (gate === 'LEARNING') {
        const result = await classifyWithRetry((timeoutMs, attempt) =>
          classifyThreadReply({
            finding: LABELLED_FINDING,
            reply: { text: guarded.text, notices: guarded.notices },
            timeoutMs,
            tier: attempt === 1 ? 'primary' : 'fallback',
          })
        )
        for (const e of result.errors)
          process.stderr.write(
            `model error (#${LABELLED_REPLIES.indexOf(item)}): ${e}\n`
          )
        verdict = result.verdict
        attempts = result.attempts
        retried = result.retried
      }
      const learning = decideLearning(gate, verdict)
      const decided = learning !== null
      if (decided && item.learning) tp++
      if (decided && !item.learning) fp++
      if (!decided && item.learning) fn++
      if (verdict?.isLearning && item.learning) modelOnlyTp++
      if (verdict?.isLearning && !item.learning) modelOnlyFp++
      if (retried) retries++
      if (gate === 'LEARNING' && !item.learning) {
        vetoChances++
        if (!decided) vetoed++
      }
      out.push({
        run,
        i: LABELLED_REPLIES.indexOf(item),
        expected: item.learning,
        gate,
        model: verdict ? verdict.isLearning : null,
        attempts,
        retried,
        stored: decided,
        ...(run === 0 && learning ? { learning } : {}),
      })
    }
  }
  const summary = {
    models: THREAD_REPLY_MODELS,
    runs,
    replies: LABELLED_REPLIES.length,
    shipped: {
      precision: tp + fp === 0 ? null : tp / (tp + fp),
      recall: tp / (tp + fn),
      tp,
      fp,
      fn,
    },
    // The model only sees replies the gate let through (as in the service).
    modelOnGatePasses: { tp: modelOnlyTp, fp: modelOnlyFp },
    // Non-learnings the gate let through, and how many the model refused.
    modelVeto: { chances: vetoChances, vetoed },
    retries,
  }
  writeFileSync(
    join(__dirname, 'results.json'),
    JSON.stringify({ summary, calls: out }, null, 2) + '\n'
  )
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n')
}

void main()

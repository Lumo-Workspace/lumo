/**
 * LUM-1131 — the shipped thread-reply classifier (deterministic gate AND the
 * FAST-tier model, `decideLearning`) on the labelled set, against the real
 * model. Precision target: 100% (no non-learning stored); recall ≥ 80%.
 *
 * Writes `results.json` next to this file: per run, per reply (index into
 * `LABELLED_REPLIES`), the gate label, the model verdict and the decision;
 * the first run also keeps the learning sentence.
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
import { classifyThreadReply } from '@/ee/security/llm/thread-reply-client'
import { FAST_MODEL } from '@/lib/ai/models'
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
  for (let run = 0; run < runs; run++) {
    for (const item of LABELLED_REPLIES) {
      const gate = screenReply(item.reply)
      const guarded = guardInjectedText(item.reply)
      let verdict = null
      try {
        verdict = await classifyThreadReply({
          finding: LABELLED_FINDING,
          reply: { text: guarded.text, notices: guarded.notices },
        })
      } catch (error) {
        verdict = null
        process.stderr.write(`model error: ${String(error)}\n`)
      }
      const learning = decideLearning(gate, verdict)
      const decided = learning !== null
      if (decided && item.learning) tp++
      if (decided && !item.learning) fp++
      if (!decided && item.learning) fn++
      if (verdict?.isLearning && item.learning) modelOnlyTp++
      if (verdict?.isLearning && !item.learning) modelOnlyFp++
      out.push({
        run,
        i: LABELLED_REPLIES.indexOf(item),
        expected: item.learning,
        gate,
        model: verdict ? verdict.isLearning : null,
        stored: decided,
        ...(run === 0 && learning ? { learning } : {}),
      })
    }
  }
  const summary = {
    model: FAST_MODEL,
    runs,
    replies: LABELLED_REPLIES.length,
    shipped: {
      precision: tp + fp === 0 ? null : tp / (tp + fp),
      recall: tp / (tp + fn),
      tp,
      fp,
      fn,
    },
    modelAlone: { tp: modelOnlyTp, fp: modelOnlyFp },
  }
  writeFileSync(
    join(__dirname, 'results.json'),
    JSON.stringify({ summary, calls: out }, null, 2) + '\n'
  )
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n')
}

void main()

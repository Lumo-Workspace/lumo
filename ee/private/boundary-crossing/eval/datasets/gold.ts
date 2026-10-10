/**
 * LUM-984 — the LUM-468 hand-labeled gold corpus as an evaluation dataset.
 * One sample per tool action; offline, deterministic, in the repository.
 *
 * Its extras keep `scripts/boundary-align-eval.ts`'s contract: the detail is
 * align-eval's own report (`formatReport` over `tallyAlignReport`), and the
 * guard fails the run when any non-evasion positive or advisory shape is
 * missed (the recall regression guard).
 */
import {
  ADVISORY_ONLY_CATEGORIES,
  GOLD_CORPUS,
  formatReport,
  tallyAlignReport,
  type GoldItem,
} from '@/ee/private/boundary-crossing/align-eval'
import type { DatasetAdapter } from '../run'
import type { EvalSample } from '../types'

export function goldSample(item: GoldItem, index: number): EvalSample {
  const base = {
    id: `${index + 1}:${item.label}`,
    groups: { category: [item.category] },
    events: [
      {
        toolName: item.toolName,
        filePath: item.filePath ?? null,
        payload: item.payload,
      },
    ],
    ...(item.projectRules ? { projectRules: item.projectRules } : {}),
  }
  if (item.expect === 'flag') {
    return {
      ...base,
      label: 'positive',
      category: item.category,
      ...(item.evasion ? { evasion: true } : {}),
    }
  }
  if (item.expect === 'advisory') {
    return { ...base, label: 'advisory', category: item.category }
  }
  return {
    ...base,
    label: 'negative',
    ...(ADVISORY_ONLY_CATEGORIES.has(item.category)
      ? { alarmOnAdvisory: item.category }
      : {}),
  }
}

export function goldDataset(corpus: GoldItem[] = GOLD_CORPUS): DatasetAdapter {
  return {
    id: 'gold',
    describe:
      'LUM-468 hand-labeled gold corpus (positives, dogfood false-positive shapes, evasion, advisory-only)',
    unit: 'action',
    source:
      'ee/private/boundary-crossing/align-eval-corpus.ts (in the repository)',
    load: async () => ({
      samples: corpus.map(goldSample),
      options: `${corpus.length} items`,
      notes: [],
    }),
    detail: (samples, verdicts) => {
      const results = []
      for (let i = 0; i < samples.length; i++) {
        const v = verdicts.get(samples[i]!.id)
        // Only a rule judge carries the crossings align-eval tallies.
        if (!v?.crossings) return ''
        results.push({
          item: corpus[i]!,
          crossings: v.crossings.map(c => c.crossing),
        })
      }
      return `\n--- align-eval view (scripts/boundary-align-eval.ts) ---\n${formatReport(tallyAlignReport(results))}`
    },
    guard: report => {
      const slipped = report.misses.filter(m => !m.evasion)
      if (slipped.length === 0) return null
      return (
        `recall guard FAILED — ${slipped.length} non-evasion real crossing(s) slipped:\n` +
        slipped.map(s => `    ✗ ${s.id}`).join('\n')
      )
    },
  }
}

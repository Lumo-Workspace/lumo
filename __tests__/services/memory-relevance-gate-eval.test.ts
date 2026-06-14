import {
  gateProjectMemories,
  type RelevanceGateDeps,
} from '@/lib/services/memory/relevance-gate'
import type { RenderableMemory } from '@/lib/memory/render'
import { RELEVANCE_GATE_TOP_K } from '@/lib/services/memory/relevance-gate.constants'

interface GoldCase {
  name: string
  task: { title: string; description: string }
  /** id → similarity score the ranker would assign (embedding mechanism). */
  scores: Record<string, number>
  /** ids that were ACTUALLY used (must survive the gate — recall guard). */
  used: string[]
  /** ids that are noise (should be dropped). */
  noise: string[]
}

const m = (id: string): RenderableMemory => ({
  id,
  scope: 'PROJECT',
  category: 'CONVENTION',
  content: { summary: id },
})

const GOLD: GoldCase[] = [
  {
    // The real LUM-483 incident: a narrow "remove direct Prisma from Service
    // layer" refactor. 2 of the injected memories were actually used; the rest
    // (Figma OAuth, Slack content-type, CSS tokens, i18n, HookEvent enums, …)
    // are noise. Scores approximate cosine to the task text.
    name: 'LUM-483 narrow prisma refactor',
    task: {
      title: 'remove direct Prisma from Service layer',
      description: 'runInTransaction; move queries to repositories',
    },
    scores: {
      'prisma-boundary': 0.82,
      'tx-pattern': 0.71, // used
      'figma-oauth': 0.18,
      'slack-content-type': 0.12,
      'css-tokens': 0.09,
      'i18n-merge': 0.15,
      'hookevent-enum': 0.22,
      'doc-patch': 0.19,
      'milestone-slug': 0.2,
      'tiptap-html': 0.17,
      // padding noise to exceed TOP_K and force real gating
      n1: 0.05,
      n2: 0.06,
      n3: 0.07,
      n4: 0.08,
      n5: 0.04,
    },
    used: ['prisma-boundary', 'tx-pattern'],
    noise: [
      'figma-oauth',
      'slack-content-type',
      'css-tokens',
      'i18n-merge',
      'hookevent-enum',
      'doc-patch',
      'milestone-slug',
      'tiptap-html',
    ],
  },
]

function depsForCase(c: GoldCase): RelevanceGateDeps {
  return {
    rankBySimilarity: async () => ({
      mechanism: 'embedding',
      ranked: Object.entries(c.scores)
        .map(([id, score]) => ({ id, score }))
        .sort((a, b) => b.score - a.score),
    }),
    trustByFragment: async () => new Map(), // pure-relevance eval; no trust boost
  }
}

describe('relevance gate control-eval', () => {
  for (const c of GOLD) {
    test(`${c.name}: every actually-used fragment survives the gate`, async () => {
      const projectMemories = Object.keys(c.scores).map(m)
      const res = await gateProjectMemories(
        {
          task: { title: c.task.title, description: c.task.description },
          projectMemories,
          projectId: 'p',
        },
        depsForCase(c)
      )
      const selected = new Set(res.selected.map(s => s.id))
      // Recall-regression guard: no used fragment may be dropped.
      for (const u of c.used) expect(selected.has(u)).toBe(true)
    })

    test(`${c.name}: precision/recall clear thresholds`, async () => {
      const projectMemories = Object.keys(c.scores).map(m)
      const res = await gateProjectMemories(
        {
          task: { title: c.task.title, description: c.task.description },
          projectMemories,
          projectId: 'p',
        },
        depsForCase(c)
      )
      const selected = new Set(res.selected.map(s => s.id))
      const tp = c.used.filter(id => selected.has(id)).length
      const fp = c.noise.filter(id => selected.has(id)).length
      const recall = tp / c.used.length
      const precision = tp / (tp + fp || 1)
      expect(recall).toBe(1) // never drop a used fragment
      expect(precision).toBeGreaterThanOrEqual(0.66) // drop the bulk of noise
      // Corpus reduction: never inject the whole corpus for a narrow task.
      expect(res.selected.length).toBeLessThanOrEqual(RELEVANCE_GATE_TOP_K)
    })
  }
})

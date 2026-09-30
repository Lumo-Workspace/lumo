/**
 * LIVE, key-gated. Embeds every eval case's candidate + existing text under each
 * qwen3 model and writes vectors.fixture.json. Run once (and re-run when the
 * corpus changes or to re-check model drift). Requires AI_GATEWAY_API_KEY.
 *
 * Usage: npx tsx scripts/eval/memory/fixture-gen.ts
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { embedMany } from 'ai'
import { gateway } from '@/lib/ai/gateway'
import { memoryContentToText } from '@/lib/memory/content-text'
import { evalSet } from './eval-set'

export const FIXTURE_MODELS = [
  'alibaba/qwen3-embedding-0.6b',
  'alibaba/qwen3-embedding-4b',
  'alibaba/qwen3-embedding-8b',
] as const

export type FixtureModel = (typeof FIXTURE_MODELS)[number]

export interface VectorsFixture {
  models: string[]
  /** caseId → { candidate: { model → vec }, existing: { model → vec } } */
  cases: Record<
    string,
    { candidate: Record<string, number[]>; existing: Record<string, number[]> }
  >
}

/** 6 significant decimals preserves cosine similarity to ~1e-6 — well below any
 * ranking-relevant delta — while roughly halving the committed fixture size vs
 * full f64 JSON precision. */
function round6(v: number[]): number[] {
  return v.map(x => Math.round(x * 1e6) / 1e6)
}

async function embedAll(model: string, texts: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({
    model: gateway.textEmbeddingModel(model),
    values: texts,
  })
  return embeddings.map(round6)
}

async function main(): Promise<void> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error('AI_GATEWAY_API_KEY required for fixture-gen (live step).')
  }
  const ids = evalSet.map(c => c.id)
  const candidateTexts = evalSet.map(c =>
    memoryContentToText(c.category, c.candidate)
  )
  const existingTexts = evalSet.map(c =>
    memoryContentToText(c.category, c.existing)
  )

  const fixture: VectorsFixture = { models: [...FIXTURE_MODELS], cases: {} }
  for (const id of ids) fixture.cases[id] = { candidate: {}, existing: {} }

  for (const model of FIXTURE_MODELS) {
    // eslint-disable-next-line no-console
    console.log(
      `Embedding ${ids.length} candidate + ${ids.length} existing under ${model}…`
    )
    const [candVecs, existVecs] = await Promise.all([
      embedAll(model, candidateTexts),
      embedAll(model, existingTexts),
    ])
    ids.forEach((id, i) => {
      fixture.cases[id]!.candidate[model] = candVecs[i]!
      fixture.cases[id]!.existing[model] = existVecs[i]!
    })
  }

  const out = join(__dirname, 'vectors.fixture.json')
  writeFileSync(out, JSON.stringify(fixture))
  // eslint-disable-next-line no-console
  console.log(
    `Wrote ${out} (${ids.length} cases × ${FIXTURE_MODELS.length} models).`
  )
}

if (require.main === module) {
  // Load .env.local before the gateway reads the key.
  void import('dotenv').then(({ config }) => {
    config({ path: '.env.local' })
    main().catch(err => {
      // eslint-disable-next-line no-console
      console.error(err)
      process.exit(1)
    })
  })
}

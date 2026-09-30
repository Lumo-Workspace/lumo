/**
 * LIVE, key-gated. Embeds every LUM-414 retrieve query under the PROD embedding
 * model and writes retrieve-vectors.fixture.json. Pool-side vectors are NOT
 * re-embedded — the harness reuses each case's `existing` vector from the
 * LUM-329 vectors.fixture.json, so the two fixtures must come from the same
 * model. Re-run when the query set changes. Requires AI_GATEWAY_API_KEY.
 *
 * Prod model only: the ablation answers questions at the prod operating point
 * (qwen3-embedding-0.6b + floor 0.78); cross-model retrieval comparison was
 * settled by LUM-329 and is out of scope here.
 *
 * Usage: npx tsx scripts/eval/memory/retrieve-fixture-gen.ts
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { embedMany } from 'ai'
import { gateway } from '@/lib/ai/gateway'
import { retrieveQuerySet, retrieveQueryText } from './retrieve-set'

export const RETRIEVE_FIXTURE_MODEL = 'alibaba/qwen3-embedding-0.6b'

export interface RetrieveVectorsFixture {
  model: string
  /** queryId → embedding of retrieveQueryText(query). */
  queries: Record<string, number[]>
}

/** Same 6-decimal rounding as the LUM-329 fixture (cosine error ~1e-6). */
function round6(v: number[]): number[] {
  return v.map(x => Math.round(x * 1e6) / 1e6)
}

async function main(): Promise<void> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error(
      'AI_GATEWAY_API_KEY required for retrieve-fixture-gen (live step).'
    )
  }
  const texts = retrieveQuerySet.map(retrieveQueryText)
  // eslint-disable-next-line no-console
  console.log(
    `Embedding ${texts.length} retrieve queries under ${RETRIEVE_FIXTURE_MODEL}…`
  )
  const { embeddings } = await embedMany({
    model: gateway.textEmbeddingModel(RETRIEVE_FIXTURE_MODEL),
    values: texts,
  })
  const fixture: RetrieveVectorsFixture = {
    model: RETRIEVE_FIXTURE_MODEL,
    queries: {},
  }
  retrieveQuerySet.forEach((q, i) => {
    fixture.queries[q.id] = round6(embeddings[i]!)
  })
  const out = join(__dirname, 'retrieve-vectors.fixture.json')
  writeFileSync(out, JSON.stringify(fixture))
  // eslint-disable-next-line no-console
  console.log(`Wrote ${out} (${texts.length} queries).`)
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

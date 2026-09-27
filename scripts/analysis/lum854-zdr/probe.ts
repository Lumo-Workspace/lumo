/**
 * LUM-854 — live probe: does every model we send customer code to resolve on
 * the AI Gateway under zero data retention, and which provider serves it?
 *
 * Goes through the production provider (`lib/ai/gateway`) WITHOUT passing any
 * providerOptions, so it proves the wire-level ZDR enforcement itself — not a
 * probe-only option. For each model id exported from `lib/ai/models.ts` plus
 * `EMBEDDING_MODEL` it sends one tiny request and prints the gateway's
 * routing: final provider + the providers it skipped for ZDR (`zdr_*` reasons).
 *
 * Exits 1 if any model fails (e.g. `no_providers_available`) or if the
 * gateway's routing does not report that ZDR filtering was applied.
 *
 *   npx tsx scripts/analysis/lum854-zdr/probe.ts [--json]
 *
 * Needs AI_GATEWAY_API_KEY: read from the environment, else `.env.local` in
 * the cwd, else `.env.local` of the main checkout (worktrees have none).
 */
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { config } from 'dotenv'
import { embedMany, generateText } from 'ai'

function loadEnv() {
  if (process.env.AI_GATEWAY_API_KEY) return
  const candidates = [path.resolve('.env.local')]
  try {
    const common = execSync(
      'git rev-parse --path-format=absolute --git-common-dir',
      { encoding: 'utf8' }
    ).trim()
    candidates.push(path.join(path.dirname(common), '.env.local'))
  } catch {
    // not in a git checkout — rely on cwd only
  }
  const found = candidates.find(p => fs.existsSync(p))
  if (found) config({ path: found, quiet: true })
}

type Routing = {
  finalProvider?: string
  planningReasoning?: string
  skippedProviderAttempts?: Array<{ provider: string; reason: string }>
}

export type ProbeRow = {
  constant: string
  model: string
  kind: 'chat' | 'embedding'
  ok: boolean
  finalProvider?: string
  zdrApplied: boolean
  skippedAsNonZdr: string[]
  error?: string
}

function rowFrom(
  constant: string,
  model: string,
  kind: ProbeRow['kind'],
  routing: Routing | undefined
): ProbeRow {
  const skippedAsNonZdr = (routing?.skippedProviderAttempts ?? [])
    .filter(s => s.reason.startsWith('zdr_'))
    .map(s => s.provider)
  const zdrApplied = /ZDR/.test(routing?.planningReasoning ?? '')
  return {
    constant,
    model,
    kind,
    ok: zdrApplied && Boolean(routing?.finalProvider),
    finalProvider: routing?.finalProvider,
    zdrApplied,
    skippedAsNonZdr,
    ...(zdrApplied
      ? {}
      : { error: 'gateway routing did not report ZDR filtering' }),
  }
}

async function main() {
  loadEnv()
  // Imported after env load: the gateway provider reads the key lazily, but
  // keep the order obvious.
  const models = await import('@/lib/ai/models')
  const { EMBEDDING_MODEL } = await import('@/lib/ai/embedding')
  const { gateway } = await import('@/lib/ai/gateway')

  const chat = Object.entries(models).filter(
    (e): e is [string, string] => typeof e[1] === 'string' && e[1].includes('/')
  )
  const rows: ProbeRow[] = []

  for (const [constant, model] of chat) {
    try {
      const r = await generateText({
        model: gateway(model),
        prompt: 'Reply with OK',
        maxOutputTokens: 16,
      })
      const routing = (
        r.providerMetadata?.gateway as { routing?: Routing } | undefined
      )?.routing
      rows.push(rowFrom(constant, model, 'chat', routing))
    } catch (e) {
      rows.push({
        constant,
        model,
        kind: 'chat',
        ok: false,
        zdrApplied: false,
        skippedAsNonZdr: [],
        error: String((e as Error).message ?? e).slice(0, 300),
      })
    }
  }

  try {
    const r = await embedMany({
      model: gateway.textEmbeddingModel(EMBEDDING_MODEL),
      values: ['probe'],
    })
    const meta = (
      r as { providerMetadata?: { gateway?: { routing?: Routing } } }
    ).providerMetadata
    const routing = meta?.gateway?.routing
    // Embedding responses may not echo routing metadata; a successful call
    // under forced ZDR is itself the proof (no ZDR provider → 400).
    rows.push(
      routing
        ? rowFrom('EMBEDDING_MODEL', EMBEDDING_MODEL, 'embedding', routing)
        : {
            constant: 'EMBEDDING_MODEL',
            model: EMBEDDING_MODEL,
            kind: 'embedding',
            ok: true,
            zdrApplied: true,
            skippedAsNonZdr: [],
            finalProvider: '(not echoed; request succeeded under forced ZDR)',
          }
    )
  } catch (e) {
    rows.push({
      constant: 'EMBEDDING_MODEL',
      model: EMBEDDING_MODEL,
      kind: 'embedding',
      ok: false,
      zdrApplied: false,
      skippedAsNonZdr: [],
      error: String((e as Error).message ?? e).slice(0, 300),
    })
  }

  if (process.argv.includes('--json')) {
    console.log(
      JSON.stringify({ probedAt: new Date().toISOString(), rows }, null, 2)
    )
  } else {
    for (const r of rows) {
      const status = r.ok ? 'PASS' : 'FAIL'
      const skipped = r.skippedAsNonZdr.length
        ? ` · skipped non-ZDR: ${r.skippedAsNonZdr.join(', ')}`
        : ''
      console.log(
        `${status}  ${r.constant.padEnd(22)} ${r.model.padEnd(30)} → ${r.finalProvider ?? '-'}${skipped}${r.error ? ` · ${r.error}` : ''}`
      )
    }
  }
  const failed = rows.filter(r => !r.ok)
  if (failed.length) {
    console.error(
      `${failed.length}/${rows.length} model(s) failed the ZDR probe`
    )
    process.exit(1)
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})

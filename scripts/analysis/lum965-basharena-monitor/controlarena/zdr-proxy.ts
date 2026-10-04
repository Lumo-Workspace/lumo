/**
 * LUM-965 — local Anthropic-compatible proxy in front of the Vercel AI
 * Gateway, so ControlArena / Inspect (Python, Anthropic SDK) can generate
 * fresh BashArena trajectories under the same rules as `@/lib/ai/gateway`:
 *
 *   - every JSON POST body gets `providerOptions.gateway.zeroDataRetention`
 *     forced on by the shared `withZeroDataRetention` (fail closed: a body
 *     that is not a JSON object is refused, never sent unconstrained);
 *   - Anthropic bare ids (`claude-sonnet-4-6`) are mapped to the gateway's
 *     dotted ids (`anthropic/claude-sonnet-4.6`);
 *   - every response's gateway-reported cost is appended to a ledger, and
 *     once the ledger total reaches `--budget` (USD) every further request is
 *     refused with a non-retryable 400 — a hard spend cap independent of
 *     whatever the Python side does.
 *
 *   AI_GATEWAY_API_KEY=… npx tsx \
 *     scripts/analysis/lum965-basharena-monitor/controlarena/zdr-proxy.ts \
 *     --port 8765 --budget 45 [--ledger ~/.cache/lumo-lum965/ca-ledger.jsonl]
 *
 * Then point Inspect at it: ANTHROPIC_BASE_URL=http://127.0.0.1:8765,
 * ANTHROPIC_API_KEY=unused (the proxy substitutes the gateway key).
 * Listens on 127.0.0.1 only.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { withZeroDataRetention } from '@/lib/ai/zdr-fetch'

export const GATEWAY_BASE = 'https://ai-gateway.vercel.sh'

export const DEFAULT_LEDGER = join(
  homedir(),
  '.cache',
  'lumo-lum965',
  'ca-ledger.jsonl'
)

/** `claude-sonnet-4-6` → `anthropic/claude-sonnet-4.6`; prefixed ids pass. */
export function gatewayModelId(model: string): string {
  if (model.includes('/')) return model
  const m = /^(claude-[a-z]+)-(\d+)-(\d+)(?:-\d{8})?$/.exec(model)
  if (m) return `anthropic/${m[1]}-${m[2]}.${m[3]}`
  return `anthropic/${model}`
}

/** Rewrite one request body: ZDR forced, model id mapped. */
export function rewriteBody(body: string): string {
  const forced = JSON.parse(withZeroDataRetention(body)) as Record<
    string,
    unknown
  >
  if (typeof forced.model === 'string')
    forced.model = gatewayModelId(forced.model)
  return JSON.stringify(forced)
}

/**
 * Gateway-reported cost in a JSON or SSE response body. Each response carries
 * one `"cost":"<usd>"` in its gateway metadata (SSE: in the final event).
 */
export function extractCost(text: string): number | null {
  let found: number | null = null
  for (const m of Array.from(text.matchAll(/"cost"\s*:\s*"?([0-9.eE-]+)"?/g))) {
    const n = Number(m[1])
    if (Number.isFinite(n)) found = n
  }
  return found
}

export function extractUsage(text: string): {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
} {
  const last = (key: string) => {
    let v = 0
    for (const m of Array.from(
      text.matchAll(new RegExp(`"${key}"\\s*:\\s*(\\d+)`, 'g'))
    ))
      v = Math.max(v, Number(m[1]))
    return v
  }
  return {
    inputTokens: last('input_tokens'),
    outputTokens: last('output_tokens'),
    cacheReadTokens: last('cache_read_input_tokens'),
  }
}

export interface LedgerEntry {
  at: string
  path: string
  model: string | null
  status: number
  costUsd: number | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

export function ledgerTotal(entries: Pick<LedgerEntry, 'costUsd'>[]): number {
  return entries.reduce((s, e) => s + (e.costUsd ?? 0), 0)
}

async function readLedger(path: string): Promise<LedgerEntry[]> {
  try {
    return (await readFile(path, 'utf8'))
      .split('\n')
      .filter(l => l.trim() !== '')
      .map(l => JSON.parse(l) as LedgerEntry)
  } catch {
    return []
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c as Buffer))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const FORWARDED_HEADERS = [
  'anthropic-version',
  'anthropic-beta',
  'content-type',
]

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const key = process.env.AI_GATEWAY_API_KEY
  if (!key) throw new Error('AI_GATEWAY_API_KEY is not set')
  const port = Number(flag('--port') ?? 8765)
  const budget = Number(flag('--budget') ?? 45)
  const ledger = flag('--ledger') ?? DEFAULT_LEDGER
  await mkdir(dirname(ledger), { recursive: true })
  let spent = ledgerTotal(await readLedger(ledger))
  process.stdout.write(`ledger $${spent.toFixed(2)} of $${budget}\n`)

  const server = createServer(async (req, res) => {
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    }
    try {
      if (spent >= budget) {
        send(400, {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: `LUM-965 proxy budget exhausted ($${spent.toFixed(2)} of $${budget})`,
          },
        })
        return
      }
      const raw = await readBody(req)
      const isPost = (req.method ?? 'GET').toUpperCase() === 'POST'
      let body: string | undefined
      let model: string | null = null
      if (isPost) {
        body = rewriteBody(raw)
        model = (JSON.parse(body) as { model?: string }).model ?? null
      }
      const headers: Record<string, string> = { 'x-api-key': key }
      for (const h of FORWARDED_HEADERS) {
        const v = req.headers[h]
        if (typeof v === 'string') headers[h] = v
      }
      const upstream = await fetch(`${GATEWAY_BASE}${req.url ?? '/'}`, {
        method: req.method ?? 'GET',
        headers,
        ...(body !== undefined ? { body } : {}),
      })
      // Stream through (Inspect streams reasoning calls and has an idle
      // timeout), keeping a copy to read the cost from once it ends.
      res.writeHead(upstream.status, {
        'content-type':
          upstream.headers.get('content-type') ?? 'application/json',
      })
      let text = ''
      if (upstream.body) {
        const decoder = new TextDecoder()
        const reader = upstream.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          text += decoder.decode(value, { stream: true })
          res.write(value)
        }
      }
      res.end()
      if (isPost) {
        const entry: LedgerEntry = {
          at: new Date().toISOString(),
          path: req.url ?? '',
          model,
          status: upstream.status,
          costUsd: extractCost(text),
          ...extractUsage(text),
        }
        spent += entry.costUsd ?? 0
        await appendFile(ledger, `${JSON.stringify(entry)}\n`)
      }
    } catch (err) {
      if (res.headersSent) {
        res.end()
        return
      }
      send(400, {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: `LUM-965 proxy: ${(err as Error).message}`,
        },
      })
    }
  })
  server.listen(port, '127.0.0.1', () =>
    process.stdout.write(`zdr proxy on http://127.0.0.1:${port}\n`)
  )
}

if (process.argv[1]?.endsWith('controlarena/zdr-proxy.ts')) {
  main().catch(err => {
    process.stderr.write(`lum965 zdr-proxy: ${(err as Error).message}\n`)
    process.exit(1)
  })
}

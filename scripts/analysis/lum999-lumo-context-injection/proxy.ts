/**
 * LUM-1001 — loopback auth proxy so the agent under test never holds the
 * Gateway key.
 *
 * run.ts starts one proxy per suite on 127.0.0.1:<ephemeral>. The agent gets
 * only `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>` and a random per-run
 * dummy token. The proxy checks that token, strips it, adds the real key on
 * the upstream request, and redacts the key from anything it sends back.
 * A successful injection can therefore read the dummy token (worthless once
 * the suite ends) but never the key. Node built-ins only.
 */
import { randomBytes, timingSafeEqual } from 'crypto'
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from 'http'
import { request as httpsRequest } from 'https'
import type { AddressInfo } from 'net'
import { Transform, type TransformCallback } from 'stream'

export interface GatewayProxy {
  /** `http://127.0.0.1:<port>` — the only base URL the agent sees. */
  baseUrl: string
  /** Random per-run token the agent sends; the proxy strips it. */
  dummyToken: string
  close(): Promise<void>
}

export interface GatewayProxyOptions {
  /** Upstream origin, e.g. https://ai-gateway.vercel.sh */
  upstream: string
  /** The real key. Lives only in this closure; never logged or returned. */
  apiKey: string
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
])

const REDACTED = '[redacted]'

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** The token the client presented, from `Authorization: Bearer` or `x-api-key`. */
function presentedToken(h: IncomingHttpHeaders): string | null {
  const auth = h.authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim()
  }
  const k = h['x-api-key']
  return typeof k === 'string' ? k.trim() : null
}

/** Pure: client request headers → upstream headers, dummy token out, key in. */
export function upstreamHeaders(
  h: IncomingHttpHeaders,
  apiKey: string
): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(h)) {
    if (value === undefined) continue
    if (HOP_BY_HOP.has(name)) continue
    if (name === 'authorization' || name === 'x-api-key') continue
    out[name] = value
  }
  out.authorization = `Bearer ${apiKey}`
  // Keep the body scannable for redaction.
  out['accept-encoding'] = 'identity'
  return out
}

/** Pure: upstream response headers → client headers with the key removed. */
export function downstreamHeaders(
  h: IncomingHttpHeaders,
  apiKey: string
): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(h)) {
    if (value === undefined) continue
    if (HOP_BY_HOP.has(name) || name === 'content-length') continue
    out[name] = Array.isArray(value)
      ? value.map(v => v.split(apiKey).join(REDACTED))
      : value.split(apiKey).join(REDACTED)
  }
  return out
}

/**
 * Streams bytes through, replacing every occurrence of `secret`, including
 * one split across chunk boundaries (the last secret.length-1 bytes are held
 * back until the next chunk or the end).
 */
export class RedactStream extends Transform {
  private tail = Buffer.alloc(0)
  private readonly secret: Buffer
  private readonly replacement = Buffer.from(REDACTED)

  constructor(secret: string) {
    super()
    this.secret = Buffer.from(secret)
  }

  private redact(buf: Buffer): Buffer {
    const parts: Buffer[] = []
    let from = 0
    for (;;) {
      const i = buf.indexOf(this.secret, from)
      if (i < 0) break
      parts.push(buf.subarray(from, i), this.replacement)
      from = i + this.secret.length
    }
    parts.push(buf.subarray(from))
    return Buffer.concat(parts)
  }

  override _transform(
    chunk: Buffer,
    _enc: BufferEncoding,
    cb: TransformCallback
  ): void {
    const buf = this.redact(Buffer.concat([this.tail, chunk]))
    const keep = Math.min(buf.length, this.secret.length - 1)
    this.tail = Buffer.from(buf.subarray(buf.length - keep))
    cb(null, buf.subarray(0, buf.length - keep))
  }

  override _flush(cb: TransformCallback): void {
    cb(null, this.redact(this.tail))
  }
}

function deny(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ type: 'error', error: { type: 'proxy', message } }))
}

export async function startGatewayProxy(
  o: GatewayProxyOptions
): Promise<GatewayProxy> {
  if (!o.apiKey) throw new Error('startGatewayProxy: empty apiKey')
  const upstream = new URL(o.upstream)
  const send = upstream.protocol === 'https:' ? httpsRequest : httpRequest
  const dummyToken = `lum999-proxy-${randomBytes(24).toString('hex')}`

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = req.url ?? ''
    // Origin-form only: an absolute-form or `//host` target could steer the
    // key to another host.
    if (!path.startsWith('/v1/')) {
      req.resume()
      deny(res, 404, 'only /v1/* is proxied')
      return
    }
    const token = presentedToken(req.headers)
    if (token === null || !sameSecret(token, dummyToken)) {
      req.resume()
      deny(res, 401, 'invalid proxy token')
      return
    }
    const target = new URL(upstream.origin)
    target.pathname = `${upstream.pathname.replace(/\/$/, '')}${path.split('?')[0]}`
    target.search = path.includes('?') ? path.slice(path.indexOf('?')) : ''
    const up = send(
      target,
      { method: req.method, headers: upstreamHeaders(req.headers, o.apiKey) },
      upRes => {
        res.writeHead(
          upRes.statusCode ?? 502,
          downstreamHeaders(upRes.headers, o.apiKey)
        )
        upRes.pipe(new RedactStream(o.apiKey)).pipe(res)
      }
    )
    up.on('error', () => {
      if (!res.headersSent) deny(res, 502, 'upstream request failed')
      else res.destroy()
    })
    req.pipe(up)
  })

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolveListen())
  })
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    dummyToken,
    close: () =>
      new Promise<void>(resolveClose => {
        server.close(() => resolveClose())
        server.closeAllConnections()
      }),
  }
}

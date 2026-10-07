/**
 * @jest-environment node
 *
 * LUM-1001 (c) — the loopback proxy adds the Gateway key upstream, rejects a
 * wrong dummy token, and never echoes the key back. The upstream is a local
 * fake server that reflects the credentials it received; no network.
 */
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs'
import {
  createServer,
  request,
  type IncomingHttpHeaders,
  type Server,
} from 'http'
import type { AddressInfo } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { Readable } from 'stream'
import {
  RedactStream,
  downstreamHeaders,
  startGatewayProxy,
  upstreamHeaders,
  type GatewayProxy,
} from '../proxy'
import { createSandbox, runClaude } from '../sandbox'

const FAKE_KEY = 'FAKE-GATEWAY-KEY-lum1001-not-a-secret'

interface Seen {
  method?: string
  url?: string
  headers: IncomingHttpHeaders
  body: string
}

let upstream: Server
let upstreamUrl: string
let seen: Seen[]
let proxy: GatewayProxy

beforeEach(async () => {
  seen = []
  upstream = createServer((req, res) => {
    let body = ''
    req.on('data', d => (body += String(d)))
    req.on('end', () => {
      seen.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
      })
      // A hostile/buggy upstream that reflects the credential it got, in a
      // header and split across two body chunks.
      const auth = String(req.headers.authorization ?? '')
      res.writeHead(200, {
        'content-type': 'application/json',
        'x-echo-auth': auth,
      })
      const payload = JSON.stringify({ echoedAuth: auth, echoedBody: body })
      const cut = payload.indexOf(FAKE_KEY) + 7
      res.write(payload.slice(0, cut))
      setTimeout(() => res.end(payload.slice(cut)), 5)
    })
  })
  await new Promise<void>(r => upstream.listen(0, '127.0.0.1', () => r()))
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`
  proxy = await startGatewayProxy({ upstream: upstreamUrl, apiKey: FAKE_KEY })
})

afterEach(async () => {
  await proxy.close()
  await new Promise<void>(r => upstream.close(() => r()))
})

function call(
  path: string,
  headers: Record<string, string>,
  body = '{"model":"claude-haiku-4-5"}'
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    // Options form so the raw path reaches the proxy un-normalized.
    const req = request(
      {
        host: '127.0.0.1',
        port: Number(new URL(proxy.baseUrl).port),
        path,
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
      },
      res => {
        let text = ''
        res.on('data', d => (text += String(d)))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: text,
          })
        )
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}

describe('(c) loopback gateway proxy', () => {
  it('listens on loopback and hands out a random dummy token, not the key', () => {
    expect(proxy.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(proxy.dummyToken).not.toContain(FAKE_KEY)
    expect(proxy.dummyToken.length).toBeGreaterThanOrEqual(40)
  })

  it('injects the key upstream and strips the dummy token', async () => {
    const r = await call('/v1/messages?beta=true', {
      authorization: `Bearer ${proxy.dummyToken}`,
    })
    expect(r.status).toBe(200)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.url).toBe('/v1/messages?beta=true')
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${FAKE_KEY}`)
    expect(JSON.stringify(seen[0]!.headers)).not.toContain(proxy.dummyToken)
    expect(seen[0]!.body).toBe('{"model":"claude-haiku-4-5"}')
  })

  it('accepts the dummy token as x-api-key too', async () => {
    const r = await call('/v1/messages', { 'x-api-key': proxy.dummyToken })
    expect(r.status).toBe(200)
    expect(seen[0]!.headers['x-api-key']).toBeUndefined()
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${FAKE_KEY}`)
  })

  it('never echoes the key in the response body or headers', async () => {
    const r = await call('/v1/messages', {
      authorization: `Bearer ${proxy.dummyToken}`,
    })
    expect(r.body).not.toContain(FAKE_KEY)
    expect(JSON.stringify(r.headers)).not.toContain(FAKE_KEY)
    expect(r.body).toContain('[redacted]')
  })

  it('rejects a wrong or missing dummy token without calling upstream', async () => {
    const wrong = await call('/v1/messages', {
      authorization: `Bearer ${proxy.dummyToken}x`,
    })
    const real = await call('/v1/messages', {
      authorization: `Bearer ${FAKE_KEY}`,
    })
    const none = await call('/v1/messages', {})
    for (const r of [wrong, real, none]) {
      expect(r.status).toBe(401)
      expect(r.body).not.toContain(FAKE_KEY)
    }
    expect(seen).toHaveLength(0)
  })

  it('only proxies /v1/* origin-form paths', async () => {
    const r = await call('//evil.example/v1/messages', {
      authorization: `Bearer ${proxy.dummyToken}`,
    })
    expect(r.status).toBe(404)
    expect(seen).toHaveLength(0)
  })

  it('rejects paths that normalization would move outside /v1/', async () => {
    for (const p of [
      '/v1/../admin',
      '/v1/%2e%2e/admin',
      '/v1/%2E%2E/admin',
      '/v1/./../admin',
    ]) {
      const r = await call(p, { authorization: `Bearer ${proxy.dummyToken}` })
      expect(r.status).toBe(400)
    }
    expect(seen).toHaveLength(0)
  })

  it('redacts a key split across stream chunks', async () => {
    const text = `abc ${FAKE_KEY} xyz`
    const chunks = [text.slice(0, 10), text.slice(10, 25), text.slice(25)]
    const out: string[] = []
    await new Promise<void>((resolve, reject) => {
      Readable.from(chunks)
        .pipe(new RedactStream(FAKE_KEY))
        .on('data', d => out.push(String(d)))
        .on('end', resolve)
        .on('error', reject)
    })
    expect(out.join('')).toBe('abc [redacted] xyz')
  })
})

describe('(a) end to end: proxy → runClaude', () => {
  let tmp: string
  beforeEach(() => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'lum1001-')))
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('the agent env carries only the loopback URL and the dummy token', async () => {
    const bin = join(tmp, 'fake-claude')
    writeFileSync(bin, '#!/bin/sh\nexec /usr/bin/env -0\n')
    chmodSync(bin, 0o755)
    const root = join(tmp, 'episodes')
    const sb = createSandbox(join(root, 'ep'), '# ctx\n', root)
    await runClaude(sb, {
      claudeBin: bin,
      model: 'claude-haiku-4-5',
      maxBudgetUsd: 0.01,
      timeoutMs: 20_000,
      baseUrl: proxy.baseUrl,
      authToken: proxy.dummyToken,
      toolPath: ['/usr/bin', '/bin'],
    })
    const raw = readFileSync(join(sb.dir, 'claude.stdout.json'), 'utf8')
    expect(raw).not.toContain(FAKE_KEY)
    expect(raw).toContain(`ANTHROPIC_BASE_URL=${proxy.baseUrl}\0`)
    expect(raw).toContain(`ANTHROPIC_AUTH_TOKEN=${proxy.dummyToken}\0`)
    // runClaude's own budget is 20 s; jest's 5 s default made this flake when
    // the full suite saturates the machine and the child spawns slowly.
  }, 30_000)
})

describe('header helpers', () => {
  it('upstreamHeaders drops client credentials and hop-by-hop headers', () => {
    const h = upstreamHeaders(
      {
        authorization: 'Bearer dummy',
        'x-api-key': 'dummy',
        host: '127.0.0.1:1',
        connection: 'keep-alive',
        'anthropic-version': '2023-06-01',
      },
      FAKE_KEY
    )
    expect(h).toEqual({
      authorization: `Bearer ${FAKE_KEY}`,
      'anthropic-version': '2023-06-01',
      'accept-encoding': 'identity',
    })
  })

  it('downstreamHeaders redacts the key and drops content-length', () => {
    const h = downstreamHeaders(
      {
        'content-length': '12',
        'x-echo': `Bearer ${FAKE_KEY}`,
        'set-cookie': [`a=${FAKE_KEY}`],
      },
      FAKE_KEY
    )
    expect(h).toEqual({
      'x-echo': 'Bearer [redacted]',
      'set-cookie': ['a=[redacted]'],
    })
  })
})

/**
 * @jest-environment node
 */
import {
  CLI_VERSION_HEADER,
  commandPathOf,
  createVersionCompatTracker,
} from '@/cli/src/lib/version-compat'
import { cliUpgradeRequired, serverLacksFeature } from '@/cli/src/lib/errors'
import { CLI_VERSION_HEADER as SERVER_HEADER } from '@/lib/api/cli-version-gate'

type Seen = { url: string; headers: Headers }

function recordingFetch(
  respond: () => Response,
  seen: Seen[] = []
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    )
    seen.push({
      url: String(input instanceof Request ? input.url : input),
      headers,
    })
    return respond()
  }) as typeof fetch
}

const BEARER = { headers: { Authorization: 'Bearer lum_test' } }
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
const html404 = () =>
  new Response('<!DOCTYPE html><html>404</html>', {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })

describe('X-Lumo-Cli-Version on CLI requests', () => {
  it('uses the same header name as the server gate', () => {
    expect(CLI_VERSION_HEADER).toBe(SERVER_HEADER)
  })

  it('adds the header to bearer-authenticated requests in every header form', async () => {
    const seen: Seen[] = []
    const t = createVersionCompatTracker({ version: '1.117.0' })
    const f = t.wrapFetch(recordingFetch(() => json(200, {}), seen))
    await f('https://x/api/tasks', BEARER)
    await f('https://x/api/tasks', {
      headers: new Headers({ authorization: 'Bearer lum_a', 'x-other': '1' }),
    })
    await f('https://x/api/tasks', { headers: [['Authorization', 'Bearer b']] })
    await f(
      new Request('https://x/api/docs', {
        headers: { Authorization: 'Bearer c' },
      })
    )
    expect(seen.map(s => s.headers.get(CLI_VERSION_HEADER))).toEqual([
      '1.117.0',
      '1.117.0',
      '1.117.0',
      '1.117.0',
    ])
    // Existing headers survive.
    expect(seen[0]!.headers.get('authorization')).toBe('Bearer lum_test')
    expect(seen[1]!.headers.get('x-other')).toBe('1')
    expect(seen[3]!.headers.get('authorization')).toBe('Bearer c')
  })

  it('never sends it to non-Lumo requests (no bearer) or when the version is unknown', async () => {
    const seen: Seen[] = []
    const known = createVersionCompatTracker({ version: '1.117.0' })
    await known.wrapFetch(recordingFetch(() => json(200, {}), seen))(
      'https://registry.npmjs.org/@lumoai%2fcli'
    )
    const unknown = createVersionCompatTracker({ version: null })
    await unknown.wrapFetch(recordingFetch(() => json(200, {}), seen))(
      'https://x/api/tasks',
      BEARER
    )
    expect(seen.map(s => s.headers.has(CLI_VERSION_HEADER))).toEqual([
      false,
      false,
    ])
  })
})

describe('upgrade hint on HTTP 426', () => {
  it('renders the upgrade line with both versions after a non-zero exit', async () => {
    const t = createVersionCompatTracker({ version: '1.117.0' })
    const res = await t.wrapFetch(
      recordingFetch(() =>
        json(426, {
          error: 'too old',
          code: 'CLI_VERSION_UNSUPPORTED',
          minVersion: '1.120.0',
          cliVersion: '1.117.0',
        })
      )
    )('https://x/api/tasks/me', BEARER)
    // The command can still read the body it was handed.
    expect(((await res.json()) as { error: string }).error).toBe('too old')
    t.noteOutput('Error: task list failed (HTTP 426)\n')
    const line = t.hintFor(1)
    expect(line).toBe(`Hint: ${cliUpgradeRequired('1.120.0', '1.117.0')}`)
    expect(line).toContain('lumo update')
    expect(line).toContain('1.120.0')
  })

  it('still renders when the 426 body is not JSON', async () => {
    const t = createVersionCompatTracker({ version: '1.117.0' })
    await t.wrapFetch(
      recordingFetch(() => new Response('nope', { status: 426 }))
    )('https://x/api/tasks/me', BEARER)
    expect(t.hintFor(1)).toBe(`Hint: ${cliUpgradeRequired(null, '1.117.0')}`)
  })

  it('is not repeated when the command already printed `lumo update`, and silent on exit 0', async () => {
    const said = createVersionCompatTracker({ version: '1.117.0' })
    await said.wrapFetch(
      recordingFetch(() => json(426, { minVersion: '2.0.0' }))
    )('https://x/api/tasks', BEARER)
    said.noteOutput(Buffer.from('Error: … Run `lumo update` to upgrade.\n'))
    expect(said.hintFor(1)).toBeNull()

    const ok = createVersionCompatTracker({ version: '1.117.0' })
    await ok.wrapFetch(recordingFetch(() => json(426, {})))(
      'https://x/api/t',
      BEARER
    )
    expect(ok.hintFor(0)).toBeNull()
  })
})

describe('"server may not have deployed this" hint on a route-missing 404', () => {
  it('names the command when the API answered with an HTML 404 page', async () => {
    const t = createVersionCompatTracker({ version: '1.117.0' })
    t.setCommand('report')
    await t.wrapFetch(recordingFetch(html404))('https://x/api/report', BEARER)
    t.noteOutput('Error: report failed (HTTP 404)\n')
    const line = t.hintFor(1)
    expect(line).toBe(`Hint: ${serverLacksFeature('report')}`)
    expect(line).toContain('`lumo report`')
    expect(line).toContain('may not have deployed this feature yet')
  })

  it('stays silent for a JSON 404 (a resource that does not exist), on exit 0 and without bearer', async () => {
    const notFound = createVersionCompatTracker({ version: '1.117.0' })
    await notFound.wrapFetch(
      recordingFetch(() => json(404, { error: 'Task not found' }))
    )('https://x/api/tasks/LUM-9', BEARER)
    expect(notFound.hintFor(1)).toBeNull()

    const ok = createVersionCompatTracker({ version: '1.117.0' })
    await ok.wrapFetch(recordingFetch(html404))('https://x/api/report', BEARER)
    expect(ok.hintFor(0)).toBeNull()

    const anon = createVersionCompatTracker({ version: '1.117.0' })
    await anon.wrapFetch(recordingFetch(html404))(
      'https://registry.npmjs.org/x'
    )
    expect(anon.hintFor(1)).toBeNull()
  })

  it('prefers the upgrade hint when both happened', async () => {
    const t = createVersionCompatTracker({ version: '1.117.0' })
    await t.wrapFetch(recordingFetch(html404))('https://x/api/a', BEARER)
    await t.wrapFetch(recordingFetch(() => json(426, { minVersion: '2.0.0' })))(
      'https://x/api/b',
      BEARER
    )
    expect(t.hintFor(1)).toContain('lumo update')
  })
})

describe('commandPathOf', () => {
  it('joins the command names below the root program', () => {
    const root = { name: () => 'lumo', parent: null }
    const task = { name: () => 'task', parent: root }
    const testcase = { name: () => 'testcase', parent: task }
    const add = { name: () => 'add', parent: testcase }
    expect(commandPathOf(add)).toBe('task testcase add')
    expect(commandPathOf({ name: () => 'report', parent: root })).toBe('report')
    expect(commandPathOf(root)).toBeNull()
  })
})

describe('scan follow-ups', () => {
  it('does not tag a bearer request to a non-/api/ path', async () => {
    const seen: Seen[] = []
    const t = createVersionCompatTracker({ version: '1.117.0' })
    await t.wrapFetch(recordingFetch(html404, seen))(
      'https://other.example/v1/files',
      BEARER
    )
    expect(seen[0]!.headers.has(CLI_VERSION_HEADER)).toBe(false)
    expect(t.hintFor(1)).toBeNull()
  })

  it('drops the 404 hint once a later Lumo request got another answer (fallback path)', async () => {
    const t = createVersionCompatTracker({ version: '1.117.0' })
    await t.wrapFetch(recordingFetch(html404))('https://x/api/new', BEARER)
    await t.wrapFetch(recordingFetch(() => json(500, { error: 'boom' })))(
      'https://x/api/old',
      BEARER
    )
    expect(t.hintFor(1)).toBeNull()
  })
})

describe('LUM-1116 scan follow-ups (PR #1420 MEDIUMs)', () => {
  it('a later successful Lumo response clears the 426 upgrade hint', async () => {
    const t = createVersionCompatTracker({ version: '1.117.0' })
    await t.wrapFetch(recordingFetch(() => json(426, { minVersion: '2.0.0' })))(
      'https://x/api/a',
      BEARER
    )
    await t.wrapFetch(recordingFetch(() => json(200, { ok: true })))(
      'https://x/api/b',
      BEARER
    )
    expect(t.hintFor(1)).toBeNull()
  })

  it('a non-Lumo response after the 426 does not clear it', async () => {
    const t = createVersionCompatTracker({ version: '1.117.0' })
    await t.wrapFetch(recordingFetch(() => json(426, { minVersion: '2.0.0' })))(
      'https://x/api/a',
      BEARER
    )
    await t.wrapFetch(recordingFetch(() => json(200, {})))(
      'https://registry.npmjs.org/@lumoai%2fcli'
    )
    expect(t.hintFor(1)).toBe(`Hint: ${cliUpgradeRequired('2.0.0', '1.117.0')}`)
  })

  it('never rewrites the headers of a Request passed in, and keeps its method and body', async () => {
    const seen: { method: string; body: string; headers: Headers }[] = []
    const realish = (async (input: RequestInfo | URL, init?: RequestInit) => {
      // What fetch itself does with (Request, init).
      const req = new Request(input as RequestInfo, init)
      seen.push({
        method: req.method,
        body: await req.text(),
        headers: req.headers,
      })
      return json(200, {})
    }) as typeof fetch
    const t = createVersionCompatTracker({ version: '1.117.0' })
    const original = new Request('https://x/api/tasks', {
      method: 'POST',
      headers: { Authorization: 'Bearer c', 'x-other': '1' },
      body: '{"a":1}',
    })
    await t.wrapFetch(realish)(original)
    expect(original.headers.has(CLI_VERSION_HEADER)).toBe(false)
    expect([...original.headers.keys()].sort()).toEqual([
      'authorization',
      'content-type',
      'x-other',
    ])
    expect(seen[0]!.method).toBe('POST')
    expect(seen[0]!.body).toBe('{"a":1}')
    expect(seen[0]!.headers.get(CLI_VERSION_HEADER)).toBe('1.117.0')
    expect(seen[0]!.headers.get('x-other')).toBe('1')
    expect(seen[0]!.headers.get('authorization')).toBe('Bearer c')
  })
})

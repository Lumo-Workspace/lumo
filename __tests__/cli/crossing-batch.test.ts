/**
 * @jest-environment node
 *
 * LUM-845: batch forms of the crossing commands.
 *   - `lumo crossing disposition <id1> <id2> … --false-positive|--confirmed`
 *     walks the LUM-769 three-step handshake for the whole batch: one
 *     envelope per step listing every crossing in full, one receipt per
 *     crossing carried as `--receipt <id>=<token>,…`, every write reported.
 *   - `lumo crossing explain --file <json|->` records one note per crossing
 *     in one call.
 */
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
  })),
}))

import { crossingDisposition } from '@/cli/src/commands/crossing-disposition'
import {
  crossingExplain,
  parseExplainItems,
} from '@/cli/src/commands/crossing-explain'
import { EXIT_CONFIRMATION_REQUIRED } from '@/cli/src/lib/confirmation'
import {
  formatReceiptMap,
  parseReceiptMap,
} from '@/cli/src/lib/crossing-handshake'
import grammarJson from '@/scripts/analysis/lum392-cli-friction/grammar.json'

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function crossing(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    category: 'TEST_FILE_DELETED',
    severity: 'MEDIUM',
    detail: `detail of ${id}`,
    occurrenceCount: 1,
    reversible: true,
    advisory: false,
    disposition: null,
    explanations: [{ note: `why ${id} is fine`, createdAt: '' }],
    ...extra,
  }
}

const IDS = ['cx-a', 'cx-b', 'cx-c']
const r1 = (id: string) => `r1.1000.2000.sig${id.slice(3)}`
const r2 = (id: string) => `r2.1000.1500.2500.sig${id.slice(3)}`
const EXPIRES = '2026-09-26T10:10:00.000Z'

let fetchMock: jest.Mock
let stdout: string[]
let stderr: string[]
const savedArgv = process.argv
const savedIsTTY = process.stdout.isTTY
const savedSession = process.env.CLAUDE_CODE_SESSION_ID

interface RouteOpts {
  crossings?: unknown[]
  receiptFail?: string
  postFail?: string
  explainFail?: string
}

function routeFetch(opts: RouteOpts = {}) {
  const rows = opts.crossings ?? IDS.map(id => crossing(id))
  fetchMock = jest.fn(
    async (url: string, init?: { method?: string; body?: string }) => {
      if (url.includes('/api/sessions/'))
        return jsonResponse(200, { taskIdentifier: 'LUM-845' })
      if (url.endsWith('/status'))
        return jsonResponse(500, { error: 'digest not under test' })
      if (url.endsWith('/boundary-crossings') && !init?.method)
        return jsonResponse(200, { crossings: rows })
      const m = url.match(
        /boundary-crossings\/([^/]+)\/(disposition\/receipt|disposition|explain)$/
      )
      if (!m) throw new Error(`unexpected fetch ${url}`)
      const id = decodeURIComponent(m[1] as string)
      const body = JSON.parse(init?.body ?? '{}') as {
        acknowledge?: string
        receipt?: string
      }
      if (m[2] === 'disposition/receipt') {
        if (id === opts.receiptFail)
          return jsonResponse(409, { error: 'crossing changed' })
        return jsonResponse(200, {
          receipt: body.acknowledge ? r2(id) : r1(id),
          expiresAt: EXPIRES,
          readAt: '2026-09-26T10:00:00.000Z',
          readAcknowledgedAt: body.acknowledge
            ? '2026-09-26T10:01:00.000Z'
            : null,
        })
      }
      if (m[2] === 'disposition') {
        if (id === opts.postFail)
          return jsonResponse(409, { error: 'the read receipt has expired' })
        return jsonResponse(200, {
          crossingId: id,
          disposition: 'FALSE_POSITIVE',
        })
      }
      if (id === opts.explainFail)
        return jsonResponse(404, { error: 'Crossing not found' })
      return jsonResponse(200, {
        crossingId: id,
        explanation: { id: 'e', note: 'n', createdAt: '' },
      })
    }
  )
  global.fetch = fetchMock as unknown as typeof fetch
}

function setArgv(...args: string[]) {
  process.argv = ['node', 'lumo', ...args]
}

beforeEach(() => {
  stdout = []
  stderr = []
  jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk))
    return true
  })
  jest.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    stderr.push(a.map(String).join(' '))
  })
  Object.defineProperty(process.stdout, 'isTTY', {
    value: false,
    configurable: true,
  })
  process.env.CLAUDE_CODE_SESSION_ID = 'sess-1'
  routeFetch()
})

afterEach(() => {
  jest.restoreAllMocks()
  process.argv = savedArgv
  Object.defineProperty(process.stdout, 'isTTY', {
    value: savedIsTTY,
    configurable: true,
  })
  if (savedSession === undefined) delete process.env.CLAUDE_CODE_SESSION_ID
  else process.env.CLAUDE_CODE_SESSION_ID = savedSession
})

function envelope() {
  return JSON.parse(stdout.join('')) as {
    status: string
    changes: string[]
    confirmCommand: string
    receipt?: { token: string; expiresAt: string }
  }
}

function rulingWrites() {
  return fetchMock.mock.calls.filter(
    ([url, init]) =>
      (init as { method?: string } | undefined)?.method === 'POST' &&
      String(url).endsWith('/disposition')
  )
}

/** Pull the `--receipt` value out of an envelope's confirmCommand. */
function receiptArg(cmd: string): string {
  const m = cmd.match(/--receipt (\S+)/)
  return m ? (m[1] as string) : ''
}

describe('batch disposition', () => {
  it('batch disposition settles N crossings in three calls — one envelope per step, every crossing in full', async () => {
    // Call 1 — read step.
    setArgv('crossing', 'disposition', ...IDS, '--false-positive')
    expect(await crossingDisposition(IDS, { falsePositive: true })).toBe(
      EXIT_CONFIRMATION_REQUIRED
    )
    const e1 = envelope()
    expect(e1.status).toBe('confirmation_required')
    const text1 = e1.changes.join('\n')
    for (const id of IDS) {
      // everything the single-crossing envelope shows, per crossing
      expect(text1).toContain(`crossing ${id} ──`)
      expect(text1).toContain(`Will disposition crossing ${id} on LUM-845`)
      expect(text1).toContain(`[MEDIUM] TEST_FILE_DELETED — detail of ${id}`)
      expect(text1).toContain(`why ${id} is fine`)
    }
    expect(text1).toContain('Batch of 3 crossings on LUM-845')
    expect(text1).toContain('drop its id from the command')
    expect(e1.confirmCommand).toMatch(/--confirm-read$/)
    const rec1 = parseReceiptMap(receiptArg(e1.confirmCommand))
    expect(rec1 && [...rec1.keys()]).toEqual(IDS)
    expect(rec1?.get('cx-b')).toBe(r1('cx-b'))
    expect(rulingWrites()).toHaveLength(0)

    // Call 2 — the user confirmed the read.
    stdout = []
    setArgv(...e1.confirmCommand.split(' ').slice(1))
    expect(
      await crossingDisposition(IDS, {
        falsePositive: true,
        confirmRead: true,
        receipt: receiptArg(e1.confirmCommand),
      })
    ).toBe(EXIT_CONFIRMATION_REQUIRED)
    const e2 = envelope()
    expect(e2.confirmCommand).toMatch(/--confirm$/)
    expect(e2.confirmCommand).not.toContain('--confirm-read')
    const text2 = e2.changes.join('\n')
    for (const id of IDS)
      expect(text2).toContain(`Read acknowledged for crossing ${id}`)
    const rec2 = parseReceiptMap(receiptArg(e2.confirmCommand))
    expect(rec2?.get('cx-c')).toBe(r2('cx-c'))
    // the stage-1 receipts were presented as acknowledgements, per crossing
    const acks = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/disposition/receipt'))
      .map(([, init]) => JSON.parse((init as { body: string }).body))
      .filter((b: { acknowledge?: string }) => b.acknowledge)
    expect(acks.map((b: { acknowledge: string }) => b.acknowledge)).toEqual(
      IDS.map(r1)
    )
    expect(rulingWrites()).toHaveLength(0)

    // Call 3 — the user approved the rulings.
    stdout = []
    const code = await crossingDisposition(IDS, {
      falsePositive: true,
      confirm: true,
      note: 'user ruled all three',
      receipt: receiptArg(e2.confirmCommand),
    })
    expect(code).toBeUndefined()
    const writes = rulingWrites()
    expect(writes).toHaveLength(3)
    for (const [i, id] of IDS.entries()) {
      const body = JSON.parse((writes[i]?.[1] as { body: string }).body)
      expect(body).toEqual({
        disposition: 'FALSE_POSITIVE',
        dispositionNote: 'user ruled all three',
        receipt: r2(id),
      })
    }
    const out = stdout.join('')
    expect(out).toContain('Dispositioned 3 of 3 crossings on LUM-845')
    for (const id of IDS) expect(out).toContain(`✓ ${id} → FALSE_POSITIVE`)
    // the status digest is read once for the whole batch
    const statusReads = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith('/status')
    )
    expect(statusReads).toHaveLength(1)
  })

  it('batch disposition lets the user drop a crossing between steps, and refuses mismatched receipts locally', async () => {
    const all = formatReceiptMap(new Map(IDS.map(id => [id, r2(id)])))
    // cx-b dropped from the batch: its receipt is ignored, it is never written
    const code = await crossingDisposition(['cx-a', 'cx-c'], {
      falsePositive: true,
      confirm: true,
      receipt: all,
    })
    expect(code).toBeUndefined()
    const written = rulingWrites().map(([url]) => String(url))
    expect(written).toHaveLength(2)
    expect(written.some(u => u.includes('/cx-b/'))).toBe(false)
    expect(stdout.join('')).toContain(
      'Dropped from the batch (left as they were): cx-b'
    )

    // narrowed down to one id: the single path takes its token from the map
    stdout = []
    fetchMock.mockClear()
    expect(
      await crossingDisposition(['cx-b'], {
        falsePositive: true,
        confirm: true,
        receipt: all,
      })
    ).toBeUndefined()
    const single = rulingWrites()
    expect(single).toHaveLength(1)
    expect(JSON.parse((single[0]?.[1] as { body: string }).body).receipt).toBe(
      r2('cx-b')
    )

    // an id added after the read step has no receipt → refused, nothing sent
    fetchMock.mockClear()
    const partial = formatReceiptMap(
      new Map(['cx-a', 'cx-b'].map(id => [id, r2(id)]))
    )
    expect(
      await crossingDisposition(IDS, {
        falsePositive: true,
        confirm: true,
        receipt: partial,
      })
    ).toBe(1)
    expect(stderr.join('\n')).toMatch(/no receipt for cx-c/)
    expect(rulingWrites()).toHaveLength(0)

    // stage-1 receipts at --confirm, stage-2 at --confirm-read, or a bare
    // token for a batch: refused locally before any request
    for (const [opts, re] of [
      [
        {
          confirm: true,
          receipt: formatReceiptMap(new Map(IDS.map(id => [id, r1(id)]))),
        },
        /read not yet acknowledged/,
      ],
      [
        {
          confirmRead: true,
          receipt: formatReceiptMap(new Map(IDS.map(id => [id, r2(id)]))),
        },
        /already acknowledge the read/,
      ],
      [{ confirm: true, receipt: r2('cx-a') }, /--receipt <id>=<token>/],
      [{ confirm: true }, /--receipt <id>=<token>/],
    ] as const) {
      fetchMock.mockClear()
      stderr = []
      expect(
        await crossingDisposition(IDS, { falsePositive: true, ...opts })
      ).toBe(1)
      expect(stderr.join('\n')).toMatch(re)
      expect(fetchMock).not.toHaveBeenCalled()
    }
  })

  it('batch disposition reports every crossing result — a failed write never hides the others', async () => {
    routeFetch({ postFail: 'cx-b' })
    const code = await crossingDisposition(IDS, {
      falsePositive: true,
      confirm: true,
      receipt: formatReceiptMap(new Map(IDS.map(id => [id, r2(id)]))),
    })
    expect(code).toBe(1)
    // every crossing attempted
    expect(rulingWrites()).toHaveLength(3)
    const out = stdout.join('')
    expect(out).toContain('Dispositioned 2 of 3 crossings')
    expect(out).toContain('✓ cx-a → FALSE_POSITIVE')
    expect(out).toContain(
      '✗ cx-b — rejected (HTTP 409) — the read receipt has expired'
    )
    expect(out).toContain('✓ cx-c → FALSE_POSITIVE')
    expect(out).toContain('1 ruling was not recorded')
  })

  it('batch disposition reports every crossing result at the read step — one failed receipt aborts the envelope', async () => {
    routeFetch({ receiptFail: 'cx-c' })
    expect(await crossingDisposition(IDS, { falsePositive: true })).toBe(1)
    expect(stdout.join('')).toBe('')
    const err = stderr.join('\n')
    expect(err).toMatch(/for 1 of 3 crossings — no envelope issued/)
    expect(err).toContain('✗ cx-c — HTTP 409 — crossing changed')
    expect(rulingWrites()).toHaveLength(0)

    // an unknown id is named, nothing is read further
    routeFetch()
    stderr = []
    expect(
      await crossingDisposition(['cx-a', 'cx-zzz'], { falsePositive: true })
    ).toBe(1)
    expect(stderr.join('\n')).toMatch(/crossing cx-zzz not found on LUM-845/)
  })

  it('batch disposition skips crossings that already carry the ruling and says so', async () => {
    routeFetch({
      crossings: [
        crossing('cx-a'),
        crossing('cx-b', { disposition: 'FALSE_POSITIVE' }),
      ],
    })
    setArgv('crossing', 'disposition', 'cx-a', 'cx-b', '--false-positive')
    expect(
      await crossingDisposition(['cx-a', 'cx-b'], { falsePositive: true })
    ).toBe(EXIT_CONFIRMATION_REQUIRED)
    const e = envelope()
    expect(e.changes.join('\n')).toContain(
      'Skipped — already FALSE_POSITIVE: cx-b'
    )
    expect([
      ...(parseReceiptMap(receiptArg(e.confirmCommand))?.keys() ?? []),
    ]).toEqual(['cx-a'])
  })
})

describe('batch explain', () => {
  it('batch explain records every note from a file, reports each, digest once', async () => {
    routeFetch({ explainFail: 'cx-b' })
    const dir = mkdtempSync(join(tmpdir(), 'lum845-'))
    const file = join(dir, 'notes.json')
    writeFileSync(
      file,
      JSON.stringify(IDS.map(id => ({ id, note: `note for ${id}` })))
    )
    const code = await crossingExplain(undefined, { file })
    expect(code).toBe(1)
    const posts = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith('/explain')
    )
    expect(posts).toHaveLength(3)
    expect(
      posts.map(([, init]) => JSON.parse((init as { body: string }).body).note)
    ).toEqual(IDS.map(id => `note for ${id}`))
    const out = stdout.join('')
    expect(out).toContain('Recorded 2 of 3 explanations on LUM-845')
    expect(out).toContain('✓ cx-a')
    expect(out).toContain('✗ cx-b — explanation rejected (HTTP 404)')
    expect(out).toContain('✓ cx-c')
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/status'))
    ).toHaveLength(1)
  })

  it('batch explain refuses a malformed file or a file mixed with <id> --note', async () => {
    expect(parseExplainItems('nope')).toMatch(/not valid JSON/)
    expect(parseExplainItems('[]')).toMatch(/non-empty JSON array/)
    expect(parseExplainItems('[{"id":"cx-a"}]')).toMatch(/entry 1 needs/)
    expect(parseExplainItems('[{"id":"cx-a","note":" hi "}]')).toEqual([
      { id: 'cx-a', note: 'hi' },
    ])
    expect(await crossingExplain('cx-a', { file: 'x.json', note: 'n' })).toBe(1)
    expect(stderr.join('\n')).toMatch(/either --file or <id> --note/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('batch grammar and docs', () => {
  it('grammar lists the batch forms (disposition <ids...>, explain --file)', () => {
    const cmds = (
      grammarJson as {
        commands: Record<
          string,
          { flags: Record<string, unknown>; args?: unknown }
        >
      }
    ).commands
    expect(Object.keys(cmds['crossing explain']?.flags ?? {})).toContain(
      '--file'
    )
    expect(JSON.stringify(cmds['crossing disposition'])).toMatch(/ids/)
  })
})

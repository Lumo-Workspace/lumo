/**
 * @jest-environment node
 *
 * LUM-974: `lumo task template show / create / edit / rm` and the local
 * Markdown file checks behind `--file`.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
    email: 'me@x.com',
  })),
}))

import {
  builtInRefusal,
  describeTemplateRm,
  taskTemplateCreate,
  taskTemplateEdit,
  taskTemplateRm,
  taskTemplateShow,
} from '@/cli/src/commands/task-template-manage'
import {
  decodeUtf8Strict,
  loadTemplateFile,
  TEMPLATE_CONTENT_MAX,
  type TemplateFileDeps,
} from '@/cli/src/lib/template-file'
import { EXIT_CONFIRMATION_REQUIRED } from '@/cli/src/lib/confirmation'

let out: string
let err: string
let calls: Array<{ url: string; method: string; body: unknown }>

const templates = [
  {
    id: null,
    key: 'agent-brief',
    name: 'Agent brief',
    description: 'Context, goal',
    isSystem: true,
    content: '## Context\n\n_hint_\n',
  },
  {
    id: 'tt_1',
    key: 'bug-report',
    name: 'Bug report',
    description: null,
    isSystem: false,
    content: '## Repro',
  },
]

/** Route-aware fake API: GET list, POST create, PATCH/DELETE by id. */
function serve(
  writes: { status?: number; body?: unknown } = {},
  list: unknown[] = templates
) {
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({
      url: String(url),
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    if (method === 'GET') {
      return new Response(JSON.stringify({ templates: list }), { status: 200 })
    }
    return new Response(JSON.stringify(writes.body ?? {}), {
      status: writes.status ?? 200,
    })
  }) as unknown as typeof fetch
}

/** File deps that never touch the disk: `files` maps path → bytes. */
function fakeFiles(files: Record<string, Buffer>, stdin = Buffer.from('')) {
  const deps: Partial<TemplateFileDeps> = {
    checkFilePath: p =>
      p in files
        ? { ok: true, resolved: p }
        : { ok: false, reason: 'unreadable', detail: 'ENOENT' },
    readFile: async p => files[p] as Buffer,
    readStdin: async () => stdin,
  }
  return deps
}

beforeEach(() => {
  out = ''
  err = ''
  calls = []
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    out += String(s)
    return true
  })
  jest.spyOn(console, 'error').mockImplementation((s: unknown) => {
    err += String(s)
  })
})
afterEach(() => jest.restoreAllMocks())

describe('loadTemplateFile (local --file checks)', () => {
  it('reads a UTF-8 Markdown file and drops a BOM', async () => {
    const r = await loadTemplateFile(
      'a.md',
      fakeFiles({ 'a.md': Buffer.from('﻿## Goal\n', 'utf8') })
    )
    expect(r).toEqual({ ok: true, content: '## Goal\n' })
  })

  it('a missing file is a clear local error', async () => {
    const r = await loadTemplateFile('nope.md', fakeFiles({}))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.message).toContain('could not read file nope.md')
  })

  it('an empty or whitespace-only file is refused', async () => {
    const r = await loadTemplateFile(
      'e.md',
      fakeFiles({ 'e.md': Buffer.from(' \n\t\n') })
    )
    expect(r).toEqual({ ok: false, message: 'file e.md is empty.' })
  })

  it('a file over 20,000 characters is refused, not truncated', async () => {
    const big = 'x'.repeat(TEMPLATE_CONTENT_MAX + 1)
    const r = await loadTemplateFile(
      'big.md',
      fakeFiles({ 'big.md': Buffer.from(big) })
    )
    expect(r.ok).toBe(false)
    expect(!r.ok && r.message).toContain('20,001 characters')
    expect(!r.ok && r.message).toContain('capped at 20,000')
  })

  it('exactly 20,000 characters is accepted', async () => {
    const r = await loadTemplateFile(
      'max.md',
      fakeFiles({ 'max.md': Buffer.from('y'.repeat(TEMPLATE_CONTENT_MAX)) })
    )
    expect(r.ok).toBe(true)
  })

  it('non-UTF-8 bytes are refused', async () => {
    const latin1 = Buffer.from([0x23, 0x20, 0xe9, 0x74, 0xe9]) // "# été" in Latin-1
    const r = await loadTemplateFile('l1.md', fakeFiles({ 'l1.md': latin1 }))
    expect(r).toEqual({
      ok: false,
      message:
        'file l1.md is not valid UTF-8 text — save it as UTF-8 and retry.',
    })
    expect(decodeUtf8Strict(latin1)).toBeNull()
  })

  it('`-` reads stdin', async () => {
    const r = await loadTemplateFile(
      '-',
      fakeFiles({}, Buffer.from('## From stdin'))
    )
    expect(r).toEqual({ ok: true, content: '## From stdin' })
  })

  it('a sensitive path is refused by the path guard', async () => {
    const r = await loadTemplateFile('.env', {
      checkFilePath: () => ({
        ok: false,
        reason: 'sensitive',
        detail: 'matches .env',
      }),
    })
    expect(!r.ok && r.message).toContain('refusing to read .env')
  })
})

describe('lumo task template show', () => {
  it('prints the Markdown body of a built-in template', async () => {
    serve()
    expect(await taskTemplateShow('agent-brief')).toBeUndefined()
    expect(out).toBe('## Context\n\n_hint_\n')
    expect(calls[0]?.url).toBe('https://api.lumo.test/api/task-templates')
  })

  it('adds a trailing newline to a workspace template body', async () => {
    serve()
    await taskTemplateShow('bug-report')
    expect(out).toBe('## Repro\n')
  })

  it('--json prints the template fields', async () => {
    serve()
    await taskTemplateShow('bug-report', { json: true })
    expect(JSON.parse(out)).toEqual({
      key: 'bug-report',
      name: 'Bug report',
      description: null,
      isSystem: false,
      content: '## Repro',
    })
  })

  it('an unknown key exits 1 and points at the list command', async () => {
    serve()
    expect(await taskTemplateShow('missing')).toBe(1)
    expect(err).toContain('no task template "missing"')
    expect(err).toContain('lumo task template list')
  })
})

describe('lumo task template create', () => {
  const files = fakeFiles({ 'b.md': Buffer.from('## Steps\n') })

  it('uploads the file content with key and name', async () => {
    serve({
      status: 201,
      body: {
        template: {
          ...templates[1],
          key: 'triage',
          name: 'Triage',
          content: '## Steps\n',
        },
      },
    })
    expect(
      await taskTemplateCreate(
        'triage',
        { name: 'Triage', file: 'b.md' },
        files
      )
    ).toBeUndefined()
    const post = calls.find(c => c.method === 'POST')
    expect(post?.url).toBe('https://api.lumo.test/api/task-templates')
    expect(post?.body).toEqual({
      key: 'triage',
      name: 'Triage',
      content: '## Steps\n',
    })
    expect(out).toContain('Created task template triage "Triage" (9 chars)\n')
    // LUM-1092: usage advice rides the shared Next: block, not inline prose.
    expect(out).toContain(
      'Next:\n  lumo task create <title> --template triage\n'
    )
    expect(out).not.toContain('Use it with')
  })

  it('a bad file fails locally before any request', async () => {
    serve()
    expect(
      await taskTemplateCreate('triage', { name: 'T', file: 'nope.md' }, files)
    ).toBe(1)
    expect(err).toContain('could not read file nope.md')
    expect(calls).toHaveLength(0)
  })

  it('--name and --file are required', async () => {
    serve()
    expect(await taskTemplateCreate('triage', { file: 'b.md' }, files)).toBe(2)
    expect(err).toContain('--name and --file are required')
    expect(calls).toHaveLength(0)
  })

  it('a built-in key is refused with the show-then-create hint', async () => {
    serve()
    expect(
      await taskTemplateCreate(
        'agent-brief',
        { name: 'X', file: 'b.md' },
        files
      )
    ).toBe(1)
    expect(err).toContain(
      '"agent-brief" is a built-in template and cannot be created'
    )
    expect(err).toContain(
      'lumo task template show agent-brief > agent-brief.md'
    )
    expect(calls.some(c => c.method === 'POST')).toBe(false)
  })

  it('an existing workspace key points at edit', async () => {
    serve()
    expect(
      await taskTemplateCreate('bug-report', { name: 'X', file: 'b.md' }, files)
    ).toBe(1)
    expect(err).toContain('already exists')
    expect(err).toContain('lumo task template edit bug-report')
    expect(calls.some(c => c.method === 'POST')).toBe(false)
  })

  it("surfaces the server's 403 for a non-owner", async () => {
    serve({
      status: 403,
      body: { error: 'Only workspace owners can manage task templates' },
    })
    expect(
      await taskTemplateCreate('triage', { name: 'T', file: 'b.md' }, files)
    ).toBe(1)
    expect(err).toContain('Only workspace owners can manage task templates')
  })
})

describe('lumo task template edit', () => {
  const files = fakeFiles({ 'n.md': Buffer.from('## New body') })

  it('resolves the key to its id and PATCHes name, content and key', async () => {
    serve({
      body: {
        template: {
          ...templates[1],
          key: 'bugs',
          name: 'Bugs',
          content: '## New body',
        },
      },
    })
    expect(
      await taskTemplateEdit(
        'bug-report',
        { name: 'Bugs', file: 'n.md', key: 'bugs' },
        files
      )
    ).toBeUndefined()
    const patch = calls.find(c => c.method === 'PATCH')
    expect(patch?.url).toBe('https://api.lumo.test/api/task-templates/tt_1')
    expect(patch?.body).toEqual({
      name: 'Bugs',
      content: '## New body',
      key: 'bugs',
    })
    expect(out).toContain('Updated task template bug-report: key → bugs')
  })

  it('needs at least one change', async () => {
    serve()
    expect(await taskTemplateEdit('bug-report', {}, files)).toBe(2)
    expect(err).toContain('nothing to change')
    expect(calls).toHaveLength(0)
  })

  it('a built-in key cannot be edited', async () => {
    serve()
    expect(await taskTemplateEdit('agent-brief', { name: 'X' }, files)).toBe(1)
    expect(err).toContain('cannot be edited')
    expect(calls.some(c => c.method === 'PATCH')).toBe(false)
  })

  it('an unknown key exits 1', async () => {
    serve()
    expect(await taskTemplateEdit('missing', { name: 'X' }, files)).toBe(1)
    expect(err).toContain('no task template "missing"')
  })

  it('an oversized replacement file fails locally', async () => {
    serve()
    const big = fakeFiles({
      'big.md': Buffer.from('z'.repeat(TEMPLATE_CONTENT_MAX + 5)),
    })
    expect(await taskTemplateEdit('bug-report', { file: 'big.md' }, big)).toBe(
      1
    )
    expect(err).toContain('capped at 20,000')
    expect(calls).toHaveLength(0)
  })
})

describe('lumo task template rm', () => {
  it('without --confirm exits 4 with an envelope naming key and name', async () => {
    serve()
    expect(await taskTemplateRm('bug-report')).toBe(EXIT_CONFIRMATION_REQUIRED)
    const env = JSON.parse(out)
    expect(env.status).toBe('confirmation_required')
    expect(env.command).toBe('task template rm')
    expect(env.changes[0]).toBe(
      'Will delete workspace task template bug-report "Bug report"'
    )
    expect(env.confirmCommand).toMatch(/--confirm$/)
    expect(calls.some(c => c.method === 'DELETE')).toBe(false)
  })

  it('with --confirm DELETEs by the resolved id', async () => {
    serve({ body: { success: true } })
    expect(
      await taskTemplateRm('bug-report', { confirm: true })
    ).toBeUndefined()
    const del = calls.find(c => c.method === 'DELETE')
    expect(del?.url).toBe('https://api.lumo.test/api/task-templates/tt_1')
    expect(out).toContain('Removed task template bug-report')
  })

  it('a built-in key cannot be removed, even with --confirm', async () => {
    serve()
    expect(await taskTemplateRm('agent-brief', { confirm: true })).toBe(1)
    expect(err).toContain('cannot be removed')
    expect(calls.some(c => c.method === 'DELETE')).toBe(false)
  })

  it('describeTemplateRm escapes quotes in the name', () => {
    expect(describeTemplateRm({ key: 'k', name: 'A "b"' })[0]).toBe(
      'Will delete workspace task template k "A \\"b\\""'
    )
  })

  it('builtInRefusal names the verb', () => {
    expect(builtInRefusal('agent-brief', 'removed')).toContain(
      'cannot be removed'
    )
  })
})

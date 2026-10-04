/**
 * @jest-environment node
 *
 * LUM-970: `lumo task template list`, `task create --template`, `task decide`.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
    email: 'me@x.com',
  })),
}))
jest.mock('@/cli/src/lib/session-id', () => ({
  resolveSessionId: jest.fn(async () => 'sess-1'),
}))

import {
  formatTaskTemplateList,
  taskTemplateList,
} from '@/cli/src/commands/task-template-list'
import { formatDecisionText, taskDecide } from '@/cli/src/commands/task-decide'
import { taskCreate } from '@/cli/src/commands/task-create'

let out: string
let err: string
let calls: Array<{ url: string; init: RequestInit | undefined }>

function serve(body: unknown, status = 200) {
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch
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
  jest.spyOn(process.stderr, 'write').mockImplementation(s => {
    err += String(s)
    return true
  })
})
afterEach(() => jest.restoreAllMocks())

const templates = [
  {
    key: 'agent-brief',
    name: 'Agent brief',
    description: 'Goal, non-goals',
    isSystem: true,
    content: '## Goal',
  },
  {
    key: 'bug-report',
    name: 'Bug report',
    description: null,
    isSystem: false,
    content: '## Repro',
  },
]

describe('lumo task template list', () => {
  it('prints each key, marking built-ins', async () => {
    serve({ templates })
    expect(await taskTemplateList()).toBeUndefined()
    expect(calls[0]?.url).toBe('https://api.lumo.test/api/task-templates')
    expect(out).toContain(
      'agent-brief  Agent brief [built-in] — Goal, non-goals'
    )
    expect(out).toContain('bug-report   Bug report\n')
    expect(out).toContain('--template <key>')
  })

  it('--json includes the Markdown content', async () => {
    serve({ templates })
    await taskTemplateList({ json: true })
    expect(JSON.parse(out)[1]).toEqual(templates[1])
  })

  it('an empty catalog says so', () => {
    expect(formatTaskTemplateList([])).toBe('No task templates.')
  })
})

describe('lumo task create --template', () => {
  it('sends templateKey to the API', async () => {
    serve(
      {
        task: {
          id: 't1',
          identifier: 'LUM-1',
          title: 'T',
          url: 'https://x/LUM-1',
          teamId: 'tm',
        },
      },
      201
    )
    expect(await taskCreate('T', { template: 'agent-brief' })).toBeUndefined()
    const body = JSON.parse(String(calls[0]?.init?.body))
    expect(body.templateKey).toBe('agent-brief')
    expect(body.description).toBeUndefined()
  })

  it('refuses --template together with --description, before any request', async () => {
    serve({})
    expect(
      await taskCreate('T', { template: 'agent-brief', description: 'x' })
    ).toBe(1)
    expect(err).toContain('either --description or --template')
    expect(calls).toHaveLength(0)
  })
})

describe('lumo task decide', () => {
  it('prefixes the local date unless the text already starts with one', () => {
    const now = new Date(2026, 9, 4, 12)
    expect(formatDecisionText(' keep v1 ', now)).toBe('2026-10-04 keep v1')
    expect(formatDecisionText('2026-10-01 keep v1', now)).toBe(
      '2026-10-01 keep v1'
    )
  })

  it('POSTs the decision with the session header and prints the task', async () => {
    serve({
      task: { identifier: 'LUM-42', title: 'T', url: 'https://x/LUM-42' },
    })
    expect(await taskDecide('LUM-42', '2026-10-04 keep v1')).toBeUndefined()
    expect(calls[0]?.url).toBe(
      'https://api.lumo.test/api/tasks/by-identifier/LUM-42/decisions'
    )
    expect(calls[0]?.init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      text: '2026-10-04 keep v1',
    })
    expect(
      (calls[0]?.init?.headers as Record<string, string>)['X-Lumo-Session-Id']
    ).toBe('sess-1')
    expect(out).toBe('Recorded decision on LUM-42 "T"  https://x/LUM-42\n')
  })

  it('missing text is a usage error', async () => {
    serve({})
    expect(await taskDecide('LUM-42', '  ')).toBe(1)
    expect(calls).toHaveLength(0)
  })
})

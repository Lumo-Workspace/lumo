/**
 * @jest-environment node
 */
// LUM-1190 — `sprint show` starts the burnup / team-performance reads in
// parallel with the main reads, and a failed or malformed secondary read
// degrades only its own section.

jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: () => ({
    token: 'test-token',
    apiUrl: 'http://lumo.test',
    workspaceSlug: 'ws',
  }),
}))
jest.mock('@/cli/src/lib/api', () => ({
  resolveAuthedApiUrl: (u: string) => u,
  trimTrailingSlash: (u: string) => u.replace(/\/+$/, ''),
}))
jest.mock('@/cli/src/lib/resolve', () => ({
  resolveSprintId: async () => ({ id: 'sp-1' }),
}))

import { sprintShow } from '@/cli/src/commands/sprint-show'

const sprintBody = {
  sprint: {
    id: 'sp-1',
    number: 3,
    name: 'Sprint 3',
    status: 'ACTIVE',
    startDate: '2026-06-01T00:00:00.000Z',
    endDate: '2026-06-05T00:00:00.000Z',
    startedAt: null,
    closedAt: null,
    team: { id: 't-1', name: 'Engineering' },
  },
  progress: { done: 1, total: 2 },
}

const json = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

describe('sprintShow secondary reads', () => {
  const realFetch = global.fetch
  let out: string
  let writeSpy: jest.SpyInstance
  beforeEach(() => {
    out = ''
    writeSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        out += String(chunk)
        return true
      })
  })
  afterEach(() => {
    global.fetch = realFetch
    writeSpy.mockRestore()
  })

  it('requests all four endpoints before any main read resolves', async () => {
    const requested: string[] = []
    let releaseMain!: () => void
    const mainGate = new Promise<void>(r => (releaseMain = r))
    global.fetch = jest.fn(async (url: string) => {
      requested.push(url)
      if (url.endsWith('/api/sprints/sp-1')) {
        await mainGate
        return json(sprintBody)
      }
      if (url.endsWith('/tasks')) {
        await mainGate
        return json({ tasks: [] })
      }
      if (url.endsWith('/burnup')) return json({ start: 'x' }) // malformed
      return json({ error: 'boom' }, 500)
    }) as unknown as typeof fetch

    const done = sprintShow('3', {})
    // Let the call reach its awaits; the main reads are still gated.
    await new Promise(r => setImmediate(r))
    expect(
      requested.map(u => u.replace('http://lumo.test', '')).sort()
    ).toEqual([
      '/api/sprints/sp-1',
      '/api/sprints/sp-1/burnup',
      '/api/sprints/sp-1/tasks',
      '/api/sprints/sp-1/team-performance',
    ])
    releaseMain()
    await expect(done).resolves.toBeUndefined()

    // Each secondary failure stays inside its own section.
    expect(out).toContain('#3  Sprint 3\nStatus:    ACTIVE')
    expect(out).toContain(
      'Burnup\n  Could not read (unexpected response shape).'
    )
    expect(out).toContain('Team performance\n  Could not read (HTTP 500).')
    expect(out).toContain('Tasks (0)')
  })

  it('a secondary network error does not fail the show', async () => {
    global.fetch = jest.fn(async (url: string) => {
      if (url.endsWith('/burnup') || url.endsWith('/team-performance')) {
        throw new Error('ECONNRESET')
      }
      if (url.endsWith('/tasks')) return json({ tasks: [] })
      return json(sprintBody)
    }) as unknown as typeof fetch
    await expect(sprintShow('3', {})).resolves.toBeUndefined()
    expect(out).toContain('Burnup\n  Could not read (ECONNRESET).')
    expect(out).toContain('Team performance\n  Could not read (ECONNRESET).')
  })
})

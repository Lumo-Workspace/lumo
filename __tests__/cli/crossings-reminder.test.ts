/** @jest-environment node */
import {
  openCrossingReminder,
  formatCrossingReminder,
} from '@/cli/src/commands/wrap/crossings-reminder'
import type { OpenCrossing } from '@/cli/src/lib/open-crossings'

const CREDS = {
  token: 'lum_x',
  apiUrl: 'https://api.test',
  workspaceSlug: 'lumo',
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

/** Attribution unresolved — the reminder doesn't render it; any shape works. */
const NO_ATTRIB = {
  workspaceMemberId: null,
  sessionId: null,
  agent: null,
  worktreeBranch: null,
  model: null,
}

const OPEN: OpenCrossing[] = [
  {
    id: 'a',
    category: 'TEST_TAMPERING',
    severity: 'HIGH',
    detail: 'd1',
    attribution: NO_ATTRIB,
  },
  {
    id: 'b',
    category: 'INFRA_TERMINATION',
    severity: 'LOW',
    detail: 'd2',
    attribution: NO_ATTRIB,
  },
]

const OLD_SESSION = process.env.CLAUDE_CODE_SESSION_ID

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CLAUDE_CODE_SESSION_ID = 'sess-1'
})
afterEach(() => {
  jest.restoreAllMocks()
  if (OLD_SESSION === undefined) delete process.env.CLAUDE_CODE_SESSION_ID
  else process.env.CLAUDE_CODE_SESSION_ID = OLD_SESSION
})

/** Mock fetch: resolve the session→task binding, then serve a crossings body. */
function routedFetch(
  crossingsBody: unknown,
  taskIdentifier: string | null = 'LUM-9'
) {
  return jest.spyOn(global, 'fetch').mockImplementation(async url => {
    const u = String(url)
    if (u.includes('/api/sessions/'))
      return jsonResponse(200, { taskIdentifier })
    if (u.includes('/boundary-crossings'))
      return jsonResponse(200, crossingsBody)
    return jsonResponse(404, {})
  })
}

describe('formatCrossingReminder (LUM-448) — pure', () => {
  it('returns null on an empty list (silent)', () => {
    expect(formatCrossingReminder('LUM-9', [], 'https://x')).toBeNull()
  })

  it('renders count + per-crossing severity when some exist', () => {
    const out = formatCrossingReminder(
      'LUM-9',
      OPEN,
      'https://x#boundary-crossings'
    )!
    expect(out).toContain('2 open boundary crossings on LUM-9')
    expect(out).toContain('[HIGH] TEST_TAMPERING')
    expect(out).toContain('[LOW] INFRA_TERMINATION')
    expect(out).toContain('https://x#boundary-crossings')
  })

  it('singularizes for a single crossing', () => {
    const out = formatCrossingReminder('LUM-9', [OPEN[0]!], 'https://x')!
    expect(out).toContain('1 open boundary crossing on LUM-9')
    expect(out).not.toContain('crossings on')
  })
})

describe('openCrossingReminder (LUM-448)', () => {
  it('session wrap reminds about open crossings only when some exist', async () => {
    // ≥1 open crossing → a reminder string naming the count + severity.
    routedFetch({
      crossings: [
        {
          id: 'a',
          category: 'TEST_TAMPERING',
          severity: 'HIGH',
          detail: 'd',
          disposition: null,
        },
      ],
    })
    const some = await openCrossingReminder(CREDS)
    expect(some).not.toBeNull()
    expect(some).toContain('1 open boundary crossing on LUM-9')
    expect(some).toContain('[HIGH] TEST_TAMPERING')

    // No open crossing (all dispositioned) → null, so wrap stays SILENT.
    routedFetch({
      crossings: [
        {
          id: 'b',
          category: 'TEST_TAMPERING',
          severity: 'HIGH',
          detail: 'd',
          disposition: 'CONFIRMED',
        },
      ],
    })
    expect(await openCrossingReminder(CREDS)).toBeNull()

    // Empty crossing set → null too.
    routedFetch({ crossings: [] })
    expect(await openCrossingReminder(CREDS)).toBeNull()
  })

  it('stays silent when the session is unbound', async () => {
    routedFetch({ crossings: [] }, null)
    expect(await openCrossingReminder(CREDS)).toBeNull()
  })
})

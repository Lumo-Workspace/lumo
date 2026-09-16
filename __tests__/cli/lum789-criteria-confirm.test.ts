/**
 * @jest-environment node
 *
 * LUM-789: `lumo task criteria confirm <task>` records a human's one-time
 * confirmation of the acceptance contract. It is a gated mutation — without
 * `--confirm` it must print a confirmation envelope and exit 4 while sending
 * NO write request (an agent can never confirm on the human's behalf); with
 * `--confirm` it POSTs and reports how many criteria were newly confirmed.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
  })),
}))

import { taskCriteriaConfirm } from '@/cli/src/commands/task-criteria-confirm'

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function listOk(
  criteria: Array<{
    id: string
    statement: string
    verifierType: 'MACHINE' | 'HUMAN'
    confirmedAt: string | null
  }>
) {
  return jsonResponse(200, { criteria, judgeStepsWarning: null })
}

const unconfirmedCriteria = [
  {
    id: 'crit-1',
    statement: '登录页在移动端可用',
    verifierType: 'HUMAN' as const,
    confirmedAt: null,
  },
  {
    id: 'crit-2',
    statement: 'npx tsc --noEmit 通过',
    verifierType: 'MACHINE' as const,
    confirmedAt: null,
  },
]

let fetchMock: jest.Mock
let stdoutBuf: string[]
let stderrBuf: string[]
const savedArgv = process.argv
const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')

function setTTY(
  stream: NodeJS.WriteStream | NodeJS.ReadStream,
  value: boolean
) {
  Object.defineProperty(stream, 'isTTY', {
    value,
    configurable: true,
    writable: true,
  })
}

function stdout(): string {
  return stdoutBuf.join('')
}

beforeEach(() => {
  jest.clearAllMocks()
  stdoutBuf = []
  stderrBuf = []
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    stdoutBuf.push(String(s))
    return true
  })
  jest.spyOn(console, 'error').mockImplementation((...a) => {
    stderrBuf.push(a.join(' '))
  })
  fetchMock = jest.fn()
  global.fetch = fetchMock as unknown as typeof fetch
  // Agent path: nothing is a TTY, JSON envelope.
  setTTY(process.stdin, false)
  setTTY(process.stdout, false)
  process.argv = ['node', 'lumo', 'task', 'criteria', 'confirm', 'LUM-42']
})

afterEach(() => {
  jest.restoreAllMocks()
  process.argv = savedArgv
  for (const [stream, desc] of [
    [process.stdin, stdinTTY],
    [process.stdout, stdoutTTY],
  ] as const) {
    if (desc) Object.defineProperty(stream, 'isTTY', desc)
    else delete (stream as { isTTY?: boolean }).isTTY
  }
})

const postConfirmCalls = () =>
  fetchMock.mock.calls.filter(
    ([url, init]) =>
      String(url).includes('/criteria/confirm') &&
      (init as RequestInit | undefined)?.method === 'POST'
  )

describe('LUM-789 lumo task criteria confirm', () => {
  it('不带 --confirm 时 exit 4、打确认信封、且不发任何写请求', async () => {
    fetchMock.mockResolvedValueOnce(listOk(unconfirmedCriteria))
    const code = await taskCriteriaConfirm('LUM-42', {})
    expect(code).toBe(4)
    const out = stdout()
    expect(out).toContain('confirmation_required')
    expect(out).toContain('lumo task criteria confirm LUM-42 --confirm')
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/criteria/confirm'),
      expect.objectContaining({ method: 'POST' })
    )
    expect(postConfirmCalls()).toHaveLength(0)
  })

  it('信封逐条列出合同,每条带 verifierType', async () => {
    fetchMock.mockResolvedValueOnce(listOk(unconfirmedCriteria))
    await taskCriteriaConfirm('LUM-42', {})
    const out = stdout()
    expect(out).toContain('[HUMAN]')
    expect(out).toContain('登录页在移动端可用')
  })

  it('带 --confirm 时发 POST 并回报确认条数', async () => {
    fetchMock
      .mockResolvedValueOnce(listOk(unconfirmedCriteria))
      .mockResolvedValueOnce(jsonResponse(201, { confirmedCount: 2 }))
    const code = await taskCriteriaConfirm('LUM-42', { confirm: true })
    expect(code).toBeUndefined()
    expect(stdout()).toContain('Confirmed the acceptance contract on LUM-42')
    expect(postConfirmCalls()).toHaveLength(1)
    expect(stderrBuf).toEqual([])
  })

  it('混合合同（一条已确认一条未确认）：信封标注 already confirmed 且 N-of-M 计数正确', async () => {
    const mixedCriteria = [
      {
        id: 'crit-1',
        statement: '登录页在移动端可用',
        verifierType: 'HUMAN' as const,
        confirmedAt: '2026-09-01T00:00:00.000Z',
      },
      {
        id: 'crit-2',
        statement: 'npx tsc --noEmit 通过',
        verifierType: 'MACHINE' as const,
        confirmedAt: null,
      },
    ]
    fetchMock.mockResolvedValueOnce(listOk(mixedCriteria))
    const code = await taskCriteriaConfirm('LUM-42', {})
    expect(code).toBe(4)
    const out = stdout()
    expect(out).toContain('1 of 2 criteria are not yet confirmed')
    expect(out).toContain('[HUMAN] 登录页在移动端可用 (already confirmed)')
    expect(out).not.toContain(
      '[MACHINE] npx tsc --noEmit 通过 (already confirmed)'
    )
    expect(postConfirmCalls()).toHaveLength(0)
  })

  it('401 on the GET: actionable message, not a bare HTTP 401', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: 'unauthorized' })
    )
    const code = await taskCriteriaConfirm('LUM-42', {})
    expect(code).toBe(1)
    expect(stderrBuf.join('\n')).toContain(
      'API key invalid or revoked. Run `lumo auth login`.'
    )
    expect(stdout()).toBe('')
  })

  it('401 on the POST (--confirm): same actionable message', async () => {
    fetchMock
      .mockResolvedValueOnce(listOk(unconfirmedCriteria))
      .mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }))
    const code = await taskCriteriaConfirm('LUM-42', { confirm: true })
    expect(code).toBe(1)
    expect(stderrBuf.join('\n')).toContain(
      'API key invalid or revoked. Run `lumo auth login`.'
    )
  })
})

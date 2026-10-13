/**
 * @jest-environment node
 *
 * LUM-1097 — `/lumo` / `@Lumo` replies are posted in a channel, so they are
 * written in the workspace's default language: errors, help, results.
 */
const mockForWorkspace = jest.fn()
jest.mock('@/lib/services/slack-locale.service', () => ({
  slackLocaleService: {
    forWorkspace: (...a: unknown[]) => mockForWorkspace(...a),
  },
}))
const mockService = {
  findMemberByEmail: jest.fn(),
  findTask: jest.fn(),
  setStatus: jest.fn(),
  assign: jest.fn(),
  createTask: jest.fn(),
  listOpenTasks: jest.fn(),
}
jest.mock('@/lib/services/slack-command.service', () => ({
  slackCommandService: {
    findMemberByEmail: (...a: unknown[]) => mockService.findMemberByEmail(...a),
    findTask: (...a: unknown[]) => mockService.findTask(...a),
    setStatus: (...a: unknown[]) => mockService.setStatus(...a),
    assign: (...a: unknown[]) => mockService.assign(...a),
    createTask: (...a: unknown[]) => mockService.createTask(...a),
    listOpenTasks: (...a: unknown[]) => mockService.listOpenTasks(...a),
  },
}))

import zh from '@/lib/i18n/zh-CN.json'
import en from '@/lib/i18n/en.json'
import { handleCommand } from '@/lib/integrations/slack/commands'

const ZH = zh as Record<string, string>
const EN = en as Record<string, string>

const member = {
  memberId: 'wm_1',
  clerkId: 'user_1',
  actorId: 'a1',
  name: 'Dev',
}
const task = {
  id: 't1',
  identifier: 'ENG-1',
  number: 1,
  title: 'Fix',
  status: 'TODO',
  priority: 'LOW',
  projectId: 'p1',
  projectName: 'Web',
  teamIdentifier: 'ENG',
  workspaceSlug: 'acme',
  assigneeName: 'Ada',
}

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn(async () => ({
    json: async () => ({ ok: true, user: { profile: { email: 'd@x.io' } } }),
  })) as unknown as typeof fetch
  mockService.findMemberByEmail.mockResolvedValue(member)
  mockService.findTask.mockResolvedValue(task)
})

const run = (text: string) => handleCommand(text, 'U1', 'xoxb', 'ws_1')

describe.each([
  ['zh-CN', ZH],
  ['en', EN],
] as const)('workspace default language %s', (locale, catalogue) => {
  beforeEach(() => mockForWorkspace.mockResolvedValue(locale))

  it('reads the language of the command’s workspace', async () => {
    await run('help')
    expect(mockForWorkspace).toHaveBeenCalledWith('ws_1')
  })

  it('help', async () => {
    const r = await run('help')
    expect(JSON.stringify(r)).toContain(catalogue['slack.msg.cmd.help.title'])
  })

  it('status result', async () => {
    const r = await run('status ENG-1')
    expect(JSON.stringify(r)).toContain(
      catalogue['slack.msg.cmd.assigneeField']!.replace('{assignee}', 'Ada')
    )
  })

  it('not linked', async () => {
    mockService.findMemberByEmail.mockResolvedValue(null)
    const r = await run('status ENG-1')
    expect(r.text).toBe(catalogue['slack.msg.cmd.notLinked'])
  })

  it('task not found', async () => {
    mockService.findTask.mockResolvedValue(null)
    const r = await run('done ENG-9')
    expect(r.text).toBe(
      catalogue['slack.msg.cmd.taskNotFound']!.replace('{task}', '`ENG-9`')
    )
  })

  it('a refused write names the action in the same language', async () => {
    mockService.setStatus.mockRejectedValue(
      Object.assign(new Error('blocked'), { status: 409 })
    )
    const r = await run('done ENG-1')
    const action = catalogue['slack.msg.cmd.actionMove']!.replace(
      '{task}',
      'ENG-1'
    ).replace('{status}', catalogue['slack.msg.status.DONE']!)
    expect(r.text).toBe(
      catalogue['slack.msg.cmd.refused']!.replace('{action}', action).replace(
        '{reason}',
        'blocked'
      )
    )
    expect(r.visibility).toBe('ephemeral')
  })

  it('create usage', async () => {
    const r = await run('create oops')
    expect(r.text).toContain(
      catalogue['slack.msg.cmd.createUsage']!.split('{usage}')[0]
    )
    expect(r.text).toContain('`create "title" in TEAM`')
  })

  it('unexpected error', async () => {
    mockService.findTask.mockRejectedValue(new Error('db down'))
    const r = await run('status ENG-1')
    expect(r.text).toBe(catalogue['slack.msg.cmd.error'])
  })
})

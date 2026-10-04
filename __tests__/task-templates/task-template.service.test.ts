/**
 * @jest-environment node
 *
 * LUM-970: template list / resolve / OWNER-only CRUD.
 */
jest.mock('@/lib/repositories/task-template.repository', () => ({
  taskTemplateRepository: {
    listByWorkspace: jest.fn(),
    findByKey: jest.fn(),
    findInWorkspace: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/preference.repository', () => ({
  preferenceRepository: { findByMemberId: jest.fn() },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findMemberRoleById: jest.fn() },
}))

import { taskTemplateRepository } from '@/lib/repositories/task-template.repository'
import { preferenceRepository } from '@/lib/repositories/preference.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { taskTemplateService } from '@/lib/services/task-template.service'

const repo = taskTemplateRepository as unknown as Record<string, jest.Mock>
const prefs = preferenceRepository as unknown as Record<string, jest.Mock>

const row = {
  id: 'tt_1',
  key: 'bug-report',
  name: 'Bug report',
  content: '## Repro\n\n- steps',
  updatedAt: new Date(),
}

beforeEach(() => {
  jest.clearAllMocks()
  repo.listByWorkspace!.mockResolvedValue([row])
  prefs.findByMemberId!.mockResolvedValue(null)
})

describe('taskTemplateService.listTemplates', () => {
  it('lists built-ins first, then the workspace templates, each with prefill HTML', async () => {
    const list = await taskTemplateService.listTemplates('ws_1', {
      locale: 'en',
    })
    expect(list.map(t => [t.key, t.isSystem])).toEqual([
      ['agent-brief', true],
      ['bug-report', false],
    ])
    expect(list[0]?.contentHtml).toContain('<h2>Goal</h2>')
    expect(list[1]?.contentHtml).toContain('<h2>Repro</h2>')
    expect(repo.listByWorkspace).toHaveBeenCalledWith('ws_1')
  })

  it("falls back to the member's saved language when no locale is passed", async () => {
    prefs.findByMemberId!.mockResolvedValue({ locale: 'de' })
    const [brief] = await taskTemplateService.listTemplates('ws_1', {
      memberId: 'mem_1',
    })
    expect(brief?.name).toBe('Agent-Briefing')
  })

  it('agent-brief v2 copy snapshot is the same English body whatever the viewer locale', async () => {
    // LUM-972's "copy to workspace" pre-fills from the listed `content`.
    const [en] = await taskTemplateService.listTemplates('ws_1', {
      locale: 'en',
    })
    const [zh] = await taskTemplateService.listTemplates('ws_1', {
      locale: 'zh-CN',
    })
    expect(zh?.content).toBe(en?.content)
    expect(zh?.contentHtml).toBe(en?.contentHtml)
    expect(zh?.content).toMatch(/^## Context\n/)
    expect(zh?.name).not.toBe(en?.name)
  })
})

describe('taskTemplateService.resolveContent', () => {
  it('returns the built-in Markdown for agent-brief', async () => {
    const md = await taskTemplateService.resolveContent('ws_1', 'agent-brief')
    expect(md).toMatch(/^## Context\n/)
    expect(repo.findByKey).not.toHaveBeenCalled()
  })

  it("returns a workspace template's Markdown", async () => {
    repo.findByKey!.mockResolvedValue(row)
    await expect(
      taskTemplateService.resolveContent('ws_1', 'bug-report')
    ).resolves.toBe(row.content)
    expect(repo.findByKey).toHaveBeenCalledWith('ws_1', 'bug-report')
  })

  it('404s an unknown key and names the list command', async () => {
    repo.findByKey!.mockResolvedValue(null)
    await expect(
      taskTemplateService.resolveContent('ws_1', 'nope')
    ).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining('lumo task template list'),
    })
  })
})

describe('taskTemplateService CRUD', () => {
  const input = { key: 'bug-report', name: 'Bug report', content: '## R' }

  it('only OWNERs can create, update or delete', async () => {
    await expect(
      taskTemplateService.createTemplate('ws_1', 'MEMBER', input)
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      taskTemplateService.updateTemplate('ws_1', 'MEMBER', 'tt_1', {
        name: 'x',
      })
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      taskTemplateService.deleteTemplate('ws_1', 'MEMBER', 'tt_1')
    ).rejects.toMatchObject({ status: 403 })
    expect(repo.create).not.toHaveBeenCalled()
    expect(repo.update).not.toHaveBeenCalled()
    expect(repo.delete).not.toHaveBeenCalled()
  })

  it('an OWNER creates a workspace template', async () => {
    repo.create!.mockResolvedValue(row)
    const t = await taskTemplateService.createTemplate('ws_1', 'OWNER', input)
    expect(repo.create).toHaveBeenCalledWith({ workspaceId: 'ws_1', ...input })
    expect(t).toMatchObject({ id: 'tt_1', isSystem: false })
  })

  it('a built-in key is refused (409)', async () => {
    await expect(
      taskTemplateService.createTemplate('ws_1', 'OWNER', {
        ...input,
        key: 'agent-brief',
      })
    ).rejects.toMatchObject({ status: 409 })
  })

  it('a duplicate key in the workspace is a 409', async () => {
    repo.create!.mockRejectedValue(
      Object.assign(new Error('unique'), { code: 'P2002' })
    )
    await expect(
      taskTemplateService.createTemplate('ws_1', 'OWNER', input)
    ).rejects.toMatchObject({ status: 409 })
  })

  it("another workspace's template reads as missing (404) on update and delete", async () => {
    repo.findInWorkspace!.mockResolvedValue(null)
    await expect(
      taskTemplateService.updateTemplate('ws_1', 'OWNER', 'tt_x', {
        name: 'x',
      })
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      taskTemplateService.deleteTemplate('ws_1', 'OWNER', 'tt_x')
    ).rejects.toMatchObject({ status: 404 })
    expect(repo.findInWorkspace).toHaveBeenCalledWith('ws_1', 'tt_x')
  })

  it('an OWNER updates and deletes their workspace template', async () => {
    repo.findInWorkspace!.mockResolvedValue(row)
    repo.update!.mockResolvedValue({ ...row, name: 'Bugs' })
    const t = await taskTemplateService.updateTemplate(
      'ws_1',
      'OWNER',
      'tt_1',
      { name: 'Bugs' }
    )
    expect(t.name).toBe('Bugs')
    await taskTemplateService.deleteTemplate('ws_1', 'OWNER', 'tt_1')
    expect(repo.delete).toHaveBeenCalledWith('tt_1')
  })
})

describe('taskTemplateService.memberRole (LUM-974)', () => {
  const misc = miscRepository as unknown as Record<string, jest.Mock>

  it("returns the member's workspace role", async () => {
    misc.findMemberRoleById!.mockResolvedValue('OWNER')
    await expect(taskTemplateService.memberRole('m_1')).resolves.toBe('OWNER')
    expect(misc.findMemberRoleById).toHaveBeenCalledWith('m_1')
  })

  it('a member that no longer exists is a 403', async () => {
    misc.findMemberRoleById!.mockResolvedValue(null)
    await expect(
      taskTemplateService.memberRole('m_gone')
    ).rejects.toMatchObject({ status: 403 })
  })
})

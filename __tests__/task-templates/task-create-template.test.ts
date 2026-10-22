/**
 * @jest-environment node
 *
 * LUM-970: `task create --template <key>` pre-fills the description server-side.
 */
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: { findByWorkspaceNonIdea: jest.fn() },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findByWorkspaceAndClerkId: jest.fn(),
    findActorByMemberId: jest.fn(),
  },
}))
jest.mock('@/lib/services/task.service', () => ({
  taskService: { createTask: jest.fn() },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { findForMemberWithBinding: jest.fn() },
}))
jest.mock('@/lib/repositories/task-template.repository', () => ({
  taskTemplateRepository: { findByKey: jest.fn() },
}))
jest.mock('@/lib/repositories/preference.repository', () => ({
  preferenceRepository: { findByMemberId: jest.fn() },
}))

// LUM-1286: no LLM duplicate check in these template tests.
jest.mock('@/lib/services/duplicate-check.service', () => ({
  suggestDuplicateEdges: jest.fn(async () => undefined),
}))

import { taskCliService } from '@/lib/services/task-cli.service'
import { projectRepository } from '@/lib/repositories/project.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { taskService } from '@/lib/services/task.service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { taskTemplateRepository } from '@/lib/repositories/task-template.repository'
import { preferenceRepository } from '@/lib/repositories/preference.repository'
import { cliCreateTaskSchema } from '@/lib/validation/schemas'

const createTask = taskService.createTask as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  ;(projectRepository.findByWorkspaceNonIdea as jest.Mock).mockResolvedValue([
    { id: 'p-1', name: 'Lumo', description: null },
  ])
  ;(memberRepository.findByWorkspaceAndClerkId as jest.Mock).mockResolvedValue({
    id: 'mem-1',
  })
  ;(memberRepository.findActorByMemberId as jest.Mock).mockResolvedValue({
    id: 'actor-1',
  })
  ;(sessionRepository.findForMemberWithBinding as jest.Mock).mockResolvedValue(
    null
  )
  ;(preferenceRepository.findByMemberId as jest.Mock).mockResolvedValue({
    locale: 'en',
  })
  createTask.mockResolvedValue({
    task: {
      id: 't1',
      title: 'T',
      teamIdentifier: 'LUM',
      teamId: 'tm',
      number: 1,
    },
    taskTags: [],
  })
})

const create = (input: Record<string, unknown>) =>
  taskCliService.createFromCli({
    workspaceId: 'ws-1',
    workspaceSlug: 'lumo',
    callerClerkId: 'clerk-1',
    memberId: 'mem-1',
    input: { title: 'T', priority: 'LOW', ...input },
  })

describe('createFromCli — templateKey', () => {
  it('agent-brief becomes the description Markdown', async () => {
    await create({ templateKey: 'agent-brief' })
    const description = createTask.mock.calls[0][1].description as string
    expect(description).toMatch(/^## Context\n/)
    expect(description).toContain('## Decisions')
  })

  it('a workspace template key resolves in the caller workspace', async () => {
    ;(taskTemplateRepository.findByKey as jest.Mock).mockResolvedValue({
      content: '## Repro',
    })
    await create({ templateKey: 'bug-report' })
    expect(taskTemplateRepository.findByKey).toHaveBeenCalledWith(
      'ws-1',
      'bug-report'
    )
    expect(createTask.mock.calls[0][1].description).toBe('## Repro')
  })

  it('with both --description and --template nothing is created (400)', async () => {
    await expect(
      create({ templateKey: 'agent-brief', description: 'x' })
    ).rejects.toMatchObject({ status: 400 })
    expect(createTask).not.toHaveBeenCalled()
  })

  it('without a template the description passes through unchanged', async () => {
    await create({ description: 'plain' })
    expect(createTask.mock.calls[0][1].description).toBe('plain')
  })

  it('the API schema accepts a slug key and rejects anything else', () => {
    expect(
      cliCreateTaskSchema.safeParse({ title: 'T', templateKey: 'agent-brief' })
        .success
    ).toBe(true)
    expect(
      cliCreateTaskSchema.safeParse({ title: 'T', templateKey: 'Bad Key' })
        .success
    ).toBe(false)
  })
})

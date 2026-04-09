import {
  QUICK_DISPATCH_SYSTEM_PROMPT,
  QuickDispatchResponseSchema,
  buildQuickDispatchPrompt,
  QUICK_DISPATCH_V2_SYSTEM_PROMPT,
  QuickDispatchV2ResponseSchema,
  buildQuickDispatchV2Prompt,
} from '@/lib/prompts/quick-dispatch'
import { quickDispatchSchema } from '@/lib/validation/schemas'

describe('QUICK_DISPATCH_SYSTEM_PROMPT', () => {
  it('includes priority mapping keywords', () => {
    expect(QUICK_DISPATCH_SYSTEM_PROMPT).toContain('URGENT')
    expect(QUICK_DISPATCH_SYSTEM_PROMPT).toContain('HIGH')
    expect(QUICK_DISPATCH_SYSTEM_PROMPT).toContain('MEDIUM')
    expect(QUICK_DISPATCH_SYSTEM_PROMPT).toContain('LOW')
  })
})

describe('buildQuickDispatchPrompt', () => {
  const projects = [
    { id: 'p1', name: 'Lumo Backend', description: 'API server' },
    { id: 'p2', name: 'Lumo Frontend', description: null },
  ]
  const members = [
    { name: 'Chao', actorId: 'a1' },
    { name: 'Alice', actorId: 'a2' },
  ]

  it('includes user input in prompt', () => {
    const result = buildQuickDispatchPrompt({
      input: '帮 Chao 做一个 P1 的 OAuth 集成',
      projects,
      members,
      currentDate: '2026-04-07',
    })
    expect(result).toContain('帮 Chao 做一个 P1 的 OAuth 集成')
  })

  it('includes project list with IDs', () => {
    const result = buildQuickDispatchPrompt({
      input: 'test',
      projects,
      members,
      currentDate: '2026-04-07',
    })
    expect(result).toContain('p1')
    expect(result).toContain('Lumo Backend')
    expect(result).toContain('p2')
    expect(result).toContain('Lumo Frontend')
  })

  it('includes member list with actor IDs', () => {
    const result = buildQuickDispatchPrompt({
      input: 'test',
      projects,
      members,
      currentDate: '2026-04-07',
    })
    expect(result).toContain('a1')
    expect(result).toContain('Chao')
    expect(result).toContain('a2')
    expect(result).toContain('Alice')
  })

  it('includes current date for relative date resolution', () => {
    const result = buildQuickDispatchPrompt({
      input: 'test',
      projects,
      members,
      currentDate: '2026-04-07',
    })
    expect(result).toContain('2026-04-07')
  })
})

describe('QuickDispatchResponseSchema', () => {
  it('accepts a fully populated response', () => {
    const valid = {
      title: 'OAuth 集成',
      description: '<p>实现 OAuth 2.0 登录集成</p>',
      priority: 'URGENT',
      projectId: 'p1',
      projectName: 'Lumo Backend',
      assigneeActorId: 'a1',
      assigneeName: 'Chao',
      dueDate: '2026-04-08T00:00:00.000Z',
      status: 'TODO',
      titleTooVague: false,
      missingProject: false,
    }
    expect(QuickDispatchResponseSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts response with null optional fields', () => {
    const valid = {
      title: 'Fix bug',
      description: '<p>Fix the bug</p>',
      priority: 'MEDIUM',
      projectId: 'p1',
      projectName: 'Lumo Backend',
      assigneeActorId: null,
      assigneeName: null,
      dueDate: null,
      status: 'TODO',
      titleTooVague: false,
      missingProject: false,
    }
    expect(QuickDispatchResponseSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts a vague title response', () => {
    const valid = {
      title: 'new task',
      description: '',
      priority: 'MEDIUM',
      projectId: null,
      projectName: null,
      assigneeActorId: null,
      assigneeName: null,
      dueDate: null,
      status: 'TODO',
      titleTooVague: true,
      missingProject: true,
    }
    expect(QuickDispatchResponseSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects invalid priority', () => {
    const invalid = {
      title: 'Test',
      description: '',
      priority: 'CRITICAL',
      projectId: null,
      projectName: null,
      assigneeActorId: null,
      assigneeName: null,
      dueDate: null,
      status: 'TODO',
      titleTooVague: false,
      missingProject: false,
    }
    expect(QuickDispatchResponseSchema.safeParse(invalid).success).toBe(false)
  })
})

describe('QUICK_DISPATCH_V2_SYSTEM_PROMPT', () => {
  it("includes 'update' and 'create' action types", () => {
    expect(QUICK_DISPATCH_V2_SYSTEM_PROMPT).toContain('update')
    expect(QUICK_DISPATCH_V2_SYSTEM_PROMPT).toContain('create')
  })

  it('includes all 4 status values', () => {
    expect(QUICK_DISPATCH_V2_SYSTEM_PROMPT).toContain('IN_PROGRESS')
    expect(QUICK_DISPATCH_V2_SYSTEM_PROMPT).toContain('IN_REVIEW')
    expect(QUICK_DISPATCH_V2_SYSTEM_PROMPT).toContain('DONE')
    expect(QUICK_DISPATCH_V2_SYSTEM_PROMPT).toContain('TODO')
  })
})

describe('QuickDispatchV2ResponseSchema', () => {
  it('accepts an update action', () => {
    const valid = {
      actions: [
        {
          type: 'update' as const,
          taskId: 't1',
          taskIdentifier: 'LUM-1',
          taskTitle: 'Fix login bug',
          fields: {
            status: 'DONE',
          },
        },
      ],
    }
    expect(QuickDispatchV2ResponseSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts a create action', () => {
    const valid = {
      actions: [
        {
          type: 'create' as const,
          title: 'New feature',
          status: 'TODO',
          priority: 'MEDIUM',
          projectId: 'p1',
          projectName: 'Lumo Backend',
          assigneeActorId: 'a1',
          assigneeName: 'Chao',
          description: '<p>Implement the new feature</p>',
          dueDate: '2026-04-10T00:00:00.000Z',
        },
      ],
    }
    expect(QuickDispatchV2ResponseSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts mixed actions', () => {
    const valid = {
      actions: [
        {
          type: 'update' as const,
          taskId: 't1',
          taskIdentifier: 'LUM-1',
          taskTitle: 'Fix login bug',
          fields: { status: 'DONE' },
        },
        {
          type: 'create' as const,
          title: 'Write tests',
          status: 'TODO',
          priority: 'HIGH',
          projectId: null,
          projectName: null,
          assigneeActorId: null,
          assigneeName: null,
          description: '<p>Add unit tests</p>',
          dueDate: null,
        },
      ],
    }
    expect(QuickDispatchV2ResponseSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects invalid action type', () => {
    const invalid = {
      actions: [
        {
          type: 'delete',
          taskId: 't1',
        },
      ],
    }
    expect(QuickDispatchV2ResponseSchema.safeParse(invalid).success).toBe(false)
  })
})

describe('buildQuickDispatchV2Prompt', () => {
  it('includes user tasks in context', () => {
    const result = buildQuickDispatchV2Prompt({
      input: '把登录bug标记为完成',
      projects: [{ id: 'p1', name: 'Lumo', description: null }],
      members: [{ name: 'Chao', actorId: 'a1' }],
      userTasks: [
        {
          id: 't1',
          identifier: 'LUM-1',
          title: 'Fix login bug',
          status: 'IN_PROGRESS',
        },
        {
          id: 't2',
          identifier: 'LUM-2',
          title: 'Add OAuth',
          status: 'TODO',
        },
      ],
      currentDate: '2026-04-08',
    })
    expect(result).toContain('<user_tasks>')
    expect(result).toContain('identifier="LUM-1"')
    expect(result).toContain('title="Fix login bug"')
    expect(result).toContain('status="IN_PROGRESS"')
    expect(result).toContain('identifier="LUM-2"')
    expect(result).toContain('title="Add OAuth"')
    expect(result).toContain('status="TODO"')
  })
})

describe('quickDispatchSchema', () => {
  it('accepts valid input', () => {
    const valid = {
      input: '帮 Chao 做一个 P1 的 OAuth 集成，明天截止',
      workspaceUrl: 'my-workspace',
    }
    expect(quickDispatchSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects empty input', () => {
    const invalid = { input: '', workspaceUrl: 'my-workspace' }
    expect(quickDispatchSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects missing workspaceUrl', () => {
    const invalid = { input: 'some task' }
    expect(quickDispatchSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects input over 500 chars', () => {
    const invalid = { input: 'a'.repeat(501), workspaceUrl: 'ws' }
    expect(quickDispatchSchema.safeParse(invalid).success).toBe(false)
  })
})

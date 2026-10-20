import {
  STATUS_KEYWORDS,
  PRIORITY_KEYWORDS,
  parseQuickDispatch,
} from '@/lib/quick-dispatch/rule-parser'
import { Mention } from '@/lib/quick-dispatch/types'

describe('STATUS_KEYWORDS', () => {
  it('maps all Chinese and English keywords correctly', () => {
    expect(STATUS_KEYWORDS['完成']).toBe('DONE')
    expect(STATUS_KEYWORDS['done']).toBe('DONE')
    expect(STATUS_KEYWORDS['搞定']).toBe('DONE')
    expect(STATUS_KEYWORDS['关闭']).toBe('DONE')
    expect(STATUS_KEYWORDS['close']).toBe('DONE')

    expect(STATUS_KEYWORDS['进行中']).toBe('IN_PROGRESS')
    expect(STATUS_KEYWORDS['doing']).toBe('IN_PROGRESS')
    expect(STATUS_KEYWORDS['开始']).toBe('IN_PROGRESS')
    expect(STATUS_KEYWORDS['start']).toBe('IN_PROGRESS')
    expect(STATUS_KEYWORDS['开工']).toBe('IN_PROGRESS')

    expect(STATUS_KEYWORDS['评审']).toBe('IN_REVIEW')
    expect(STATUS_KEYWORDS['review']).toBe('IN_REVIEW')
    expect(STATUS_KEYWORDS['提审']).toBe('IN_REVIEW')

    expect(STATUS_KEYWORDS['待办']).toBe('TODO')
    expect(STATUS_KEYWORDS['todo']).toBe('TODO')
    expect(STATUS_KEYWORDS['回退']).toBe('TODO')
    expect(STATUS_KEYWORDS['reopen']).toBe('TODO')

    expect(STATUS_KEYWORDS['backlog']).toBe('BACKLOG')
    expect(STATUS_KEYWORDS['待规划']).toBe('BACKLOG')
    expect(STATUS_KEYWORDS['搁置']).toBe('BACKLOG')
    expect(STATUS_KEYWORDS['someday']).toBe('BACKLOG')
  })
})

describe('PRIORITY_KEYWORDS', () => {
  it('maps all keywords correctly', () => {
    expect(PRIORITY_KEYWORDS['P0']).toBe('URGENT')
    expect(PRIORITY_KEYWORDS['紧急']).toBe('URGENT')
    expect(PRIORITY_KEYWORDS['urgent']).toBe('URGENT')

    expect(PRIORITY_KEYWORDS['P1']).toBe('HIGH')
    expect(PRIORITY_KEYWORDS['高']).toBe('HIGH')
    expect(PRIORITY_KEYWORDS['high']).toBe('HIGH')

    expect(PRIORITY_KEYWORDS['P2']).toBe('MEDIUM')
    expect(PRIORITY_KEYWORDS['中']).toBe('MEDIUM')
    expect(PRIORITY_KEYWORDS['medium']).toBe('MEDIUM')

    expect(PRIORITY_KEYWORDS['P3']).toBe('LOW')
    expect(PRIORITY_KEYWORDS['低']).toBe('LOW')
    expect(PRIORITY_KEYWORDS['low']).toBe('LOW')
  })
})

describe('parseQuickDispatch', () => {
  const taskMention: Mention = {
    type: 'task',
    id: 't1',
    identifier: 'LUM-42',
    title: 'Fix login bug',
    position: [0, 6],
  }

  const memberMention: Mention = {
    type: 'member',
    actorId: 'a1',
    name: 'Chao',
    position: [10, 14],
  }

  const projectMention: Mention = {
    type: 'project',
    id: 'p1',
    name: 'Lumo Backend',
    position: [20, 32],
  }

  it('parses task mention + status keyword into update action', () => {
    const result = parseQuickDispatch('LUM-42 完成', [taskMention])

    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toEqual({
      type: 'update',
      taskId: 't1',
      taskIdentifier: 'LUM-42',
      taskTitle: 'Fix login bug',
      fields: { status: 'DONE' },
      confidence: 'high',
    })
    expect(result.unparsed).toBe('')
    expect(result.needsConfirmation).toBe(false)
  })

  it('parses "someday" into a BACKLOG status update, matching the LLM prompt (LUM-1057)', () => {
    const result = parseQuickDispatch('LUM-42 someday', [taskMention])

    expect(result.actions[0]).toMatchObject({
      type: 'update',
      fields: { status: 'BACKLOG' },
    })
  })

  it('parses a backlog keyword into a BACKLOG status update (LUM-1057)', () => {
    const result = parseQuickDispatch('LUM-42 待规划', [taskMention])

    expect(result.actions[0]).toMatchObject({
      type: 'update',
      taskId: 't1',
      fields: { status: 'BACKLOG' },
    })
  })

  it('parses task mention + member mention into assign action', () => {
    const result = parseQuickDispatch('LUM-42 分配给 Chao', [
      taskMention,
      memberMention,
    ])

    expect(result.actions).toHaveLength(1)
    const action = result.actions[0]!
    expect(action.type).toBe('update')
    const updateAction = action as Extract<typeof action, { type: 'update' }>
    expect(updateAction.fields.assigneeActorId).toBe('a1')
  })

  it('parses create keyword + title + project mention into create action', () => {
    const result = parseQuickDispatch('创建 OAuth集成 Lumo Backend', [
      projectMention,
    ])

    expect(result.actions).toHaveLength(1)
    const action = result.actions[0]!
    expect(action.type).toBe('create')
    const createAction = action as Extract<typeof action, { type: 'create' }>
    expect(createAction.title).toContain('OAuth集成')
    expect(createAction.projectId).toBe('p1')
    expect(createAction.projectName).toBe('Lumo Backend')
    expect(createAction.status).toBe('TODO')
    // LUM-1284: no priority keyword → NONE (not assessed).
    expect(createAction.priority).toBe('NONE')
  })

  describe('create title keyword stripping (LUM-1057)', () => {
    const titleOf = (text: string) => {
      const action = parseQuickDispatch(text, []).actions[0] as Extract<
        ReturnType<typeof parseQuickDispatch>['actions'][number],
        { type: 'create' }
      >
      expect(action.type).toBe('create')
      return action.title
    }

    it('keeps English words that merely contain a keyword', () => {
      expect(titleOf('add address book')).toBe('address book')
      expect(titleOf('create highlight panel')).toBe('highlight panel')
      expect(titleOf('create restart worker')).toBe('restart worker')
    })

    it('still strips whole-word English keywords', () => {
      expect(titleOf('create login page high')).toBe('login page')
      expect(titleOf('create login page someday')).toBe('login page')
    })

    it('still strips CJK keywords inside the text', () => {
      expect(titleOf('创建 部署脚本 紧急')).toBe('部署脚本')
    })
  })

  it('returns unparsed text when no mentions or keywords match', () => {
    const result = parseQuickDispatch('今天天气不错', [])

    expect(result.actions).toHaveLength(0)
    expect(result.unparsed).toBe('今天天气不错')
    expect(result.needsConfirmation).toBe(false)
  })

  it('parses multiple comma-separated actions', () => {
    const taskMention2: Mention = {
      type: 'task',
      id: 't2',
      identifier: 'LUM-43',
      title: 'Add dark mode',
      position: [10, 16],
    }

    const result = parseQuickDispatch('LUM-42 完成，LUM-43 开始', [
      taskMention,
      taskMention2,
    ])

    expect(result.actions).toHaveLength(2)
    expect(result.actions[0]!).toMatchObject({
      type: 'update',
      taskId: 't1',
      fields: { status: 'DONE' },
    })
    expect(result.actions[1]!).toMatchObject({
      type: 'update',
      taskId: 't2',
      fields: { status: 'IN_PROGRESS' },
    })
    expect(result.needsConfirmation).toBe(true)
  })

  it('parses task mention + status + priority together', () => {
    const result = parseQuickDispatch('LUM-42 开始 P0', [taskMention])

    expect(result.actions).toHaveLength(1)
    const action = result.actions[0]!
    expect(action.type).toBe('update')
    const updateAction = action as Extract<typeof action, { type: 'update' }>
    expect(updateAction.fields.status).toBe('IN_PROGRESS')
    expect(updateAction.fields.priority).toBe('URGENT')
  })

  it('parses create with assignee and priority', () => {
    const result = parseQuickDispatch('创建 部署脚本 P1 Chao Lumo Backend', [
      memberMention,
      projectMention,
    ])

    expect(result.actions).toHaveLength(1)
    const action = result.actions[0]!
    expect(action.type).toBe('create')
    const createAction = action as Extract<typeof action, { type: 'create' }>
    expect(createAction.title).toContain('部署脚本')
    expect(createAction.priority).toBe('HIGH')
    expect(createAction.assigneeActorId).toBe('a1')
    expect(createAction.assigneeName).toBe('Chao')
    expect(createAction.projectId).toBe('p1')
  })
})

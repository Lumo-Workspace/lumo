/** @jest-environment node */
// LUM-680: every idea lifecycle mutation records an IdeaActivity, and the
// activity service reads the timeline back. Drives the real idea /
// idea-comment / idea-activity services with the repos + team mocked.
jest.mock('@/lib/team', () => ({ getDefaultTeam: jest.fn() }))
jest.mock('@/lib/repositories/idea.repository', () => ({
  ideaRepository: {
    createCaptured: jest.fn(),
    updateStatementInTeam: jest.fn(),
    updateStatusInTeam: jest.fn(),
    findByNumber: jest.fn(),
    findByIdInTeam: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/comment.repository', () => ({
  commentRepository: { createForIdea: jest.fn(), findByIdeaId: jest.fn() },
}))
jest.mock('@/lib/repositories/idea-activity.repository', () => ({
  ideaActivityRepository: { create: jest.fn(), listByIdea: jest.fn() },
}))

import { ideaService } from '@/lib/services/idea.service'
import { ideaCommentService } from '@/lib/services/idea-comment.service'
import { ideaActivityService } from '@/lib/services/idea-activity.service'
import { getDefaultTeam } from '@/lib/team'
import { ideaRepository } from '@/lib/repositories/idea.repository'
import { commentRepository } from '@/lib/repositories/comment.repository'
import { ideaActivityRepository } from '@/lib/repositories/idea-activity.repository'

const TEAM = { id: 'team-1', identifier: 'LUM' }

const row = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  number: 8,
  statement: 'ship it',
  status: 'CAPTURED',
  sourceContext: null,
  sourceSessionId: null,
  sourceTaskId: null,
  proposedByMemberId: 'm1',
  teamId: 'team-1',
  workspaceId: 'w1',
  createdAt: new Date(0),
  planRunId: null,
  initiative: null,
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(getDefaultTeam as jest.Mock).mockResolvedValue(TEAM)
})

describe('records idea lifecycle activity', () => {
  it('capture -> IDEA_CAPTURED', async () => {
    ;(ideaRepository.createCaptured as jest.Mock).mockResolvedValue(row())
    await ideaService.capture({
      workspaceId: 'w1',
      memberId: 'm1',
      input: { statement: 'ship it' },
      actorId: 'actor-1',
    })
    expect(ideaActivityRepository.create).toHaveBeenCalledWith({
      ideaId: 'i1',
      actorId: 'actor-1',
      type: 'IDEA_CAPTURED',
      payload: null,
    })
  })

  it('updateStatement -> STATEMENT_CHANGED', async () => {
    ;(ideaRepository.updateStatementInTeam as jest.Mock).mockResolvedValue(
      row({ statement: 'sharpened' })
    )
    await ideaService.updateStatement({
      workspaceId: 'w1',
      ideaId: 'i1',
      input: { statement: 'sharpened' },
      actorId: 'actor-1',
    })
    expect(ideaActivityRepository.create).toHaveBeenCalledWith({
      ideaId: 'i1',
      actorId: 'actor-1',
      type: 'STATEMENT_CHANGED',
      payload: null,
    })
  })

  it('updateStatus -> STATUS_CHANGED with {from,to}', async () => {
    ;(ideaRepository.findByNumber as jest.Mock).mockResolvedValue(
      row({ status: 'CAPTURED' })
    )
    ;(ideaRepository.updateStatusInTeam as jest.Mock).mockResolvedValue(
      row({ status: 'DEVELOPING' })
    )
    await ideaService.updateStatus({
      workspaceId: 'w1',
      ideaRef: 'LUM-I8',
      status: 'DEVELOPING',
      actorId: 'actor-1',
    })
    expect(ideaActivityRepository.create).toHaveBeenCalledWith({
      ideaId: 'i1',
      actorId: 'actor-1',
      type: 'STATUS_CHANGED',
      payload: { from: 'CAPTURED', to: 'DEVELOPING' },
    })
  })

  it('comment -> COMMENT_ADDED', async () => {
    ;(ideaRepository.findByNumber as jest.Mock).mockResolvedValue(row())
    ;(commentRepository.createForIdea as jest.Mock).mockResolvedValue({
      id: 'c9',
      ideaId: 'i1',
      taskId: null,
      authorActorId: 'actor-1',
      body: 'note',
      createdAt: new Date(0),
    })
    await ideaCommentService.createComment({
      workspaceId: 'w1',
      ideaRef: 'LUM-I8',
      authorActorId: 'actor-1',
      body: 'note',
    })
    expect(ideaActivityRepository.create).toHaveBeenCalledWith({
      ideaId: 'i1',
      actorId: 'actor-1',
      type: 'COMMENT_ADDED',
      payload: { commentId: 'c9' },
    })
  })

  it('GET returns the trail mapped to timeline entries', async () => {
    ;(ideaRepository.findByNumber as jest.Mock).mockResolvedValue(row())
    ;(ideaActivityRepository.listByIdea as jest.Mock).mockResolvedValue([
      {
        id: 'a1',
        type: 'IDEA_CAPTURED',
        payload: null,
        actorId: 'actor-1',
        createdAt: new Date(0),
      },
      {
        id: 'a2',
        type: 'STATUS_CHANGED',
        payload: { from: 'CAPTURED', to: 'DEVELOPING' },
        actorId: 'actor-1',
        createdAt: new Date(1),
      },
    ])

    const trail = await ideaActivityService.listForIdea({
      workspaceId: 'w1',
      ideaRef: 'LUM-I8',
    })

    expect(ideaActivityRepository.listByIdea).toHaveBeenCalledWith('i1')
    expect(trail.map(e => e.type)).toEqual(['IDEA_CAPTURED', 'STATUS_CHANGED'])
    expect(trail[1]).toMatchObject({
      id: 'a2',
      payload: { from: 'CAPTURED', to: 'DEVELOPING' },
    })
  })
})

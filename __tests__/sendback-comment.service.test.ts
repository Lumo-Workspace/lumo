import {
  summarizeSendBackNote,
  postSendBackComment,
} from '@/lib/services/sendback-comment.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { commentService } from '@/lib/services/comment.service'

jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: (p: unknown) => p }))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findForComment: jest.fn() },
}))
jest.mock('@/lib/services/comment.service', () => ({
  commentService: { createCommentWithSideEffects: jest.fn() },
}))

const findForComment = taskRepository.findForComment as jest.Mock
const createComment = commentService.createCommentWithSideEffects as jest.Mock

const TASK = {
  id: 't-1',
  projectId: 'p-1',
  number: 42,
  title: 'Ship it',
  team: { identifier: 'LUM' },
  project: { name: 'Core', workspaceId: 'w-1', workspace: { slug: 'lumo' } },
}

beforeEach(() => {
  jest.clearAllMocks()
  findForComment.mockResolvedValue(TASK)
  createComment.mockResolvedValue({ id: 'cmt-1' })
})

describe('summarizeSendBackNote', () => {
  it('returns a trimmed plain-text summary for a plain note', () => {
    expect(summarizeSendBackNote('  redo the retry path  ')).toBe(
      'redo the retry path'
    )
  })

  it('strips HTML tags from a rich-text note', () => {
    expect(
      summarizeSendBackNote('<p>redo the <strong>retry</strong> path</p>')
    ).toBe('redo the retry path')
  })

  it('strips control characters (LUM-346 口径) and collapses whitespace', () => {
    expect(summarizeSendBackNote('bad \x1b[31mANSI\x1b[0m\n\n  output')).toBe(
      'bad [31mANSI[0m output'
    )
  })

  it('returns null for empty / whitespace / tag-only notes', () => {
    expect(summarizeSendBackNote(null)).toBeNull()
    expect(summarizeSendBackNote('   ')).toBeNull()
    expect(summarizeSendBackNote('<p></p>')).toBeNull()
  })

  it('truncates very long notes', () => {
    const summary = summarizeSendBackNote('x'.repeat(5000))
    expect(summary!.length).toBeLessThanOrEqual(2001)
    expect(summary!.endsWith('…')).toBe(true)
  })
})

describe('postSendBackComment', () => {
  it('converts a markdown note to HTML and posts it as a comment, returning the id', async () => {
    const id = await postSendBackComment({
      taskId: 't-1',
      rawNote: 'redo **now**',
      authorActorId: 'actor-1',
      authorClerkId: 'clerk-1',
    })
    expect(id).toBe('cmt-1')
    const arg = createComment.mock.calls[0]![0]
    expect(arg.body).toContain('<strong>now</strong>')
    expect(arg).toMatchObject({
      taskId: 't-1',
      authorActorId: 'actor-1',
      authorClerkId: 'clerk-1',
      workspaceId: 'w-1',
      projectId: 'p-1',
      taskNumber: 42,
      teamIdentifier: 'LUM',
      workspaceSlug: 'lumo',
      projectName: 'Core',
    })
  })

  it('passes already-HTML notes through without double-conversion', async () => {
    await postSendBackComment({
      taskId: 't-1',
      rawNote: '<p>redo it</p>',
      authorActorId: 'actor-1',
      authorClerkId: 'clerk-1',
    })
    expect(createComment.mock.calls[0]![0].body).toBe('<p>redo it</p>')
  })

  it('returns null (no comment) when the note is empty', async () => {
    const id = await postSendBackComment({
      taskId: 't-1',
      rawNote: '   ',
      authorActorId: 'actor-1',
      authorClerkId: 'clerk-1',
    })
    expect(id).toBeNull()
    expect(createComment).not.toHaveBeenCalled()
  })

  it('returns null when the task cannot be loaded for comment context', async () => {
    findForComment.mockResolvedValue(null)
    const id = await postSendBackComment({
      taskId: 't-1',
      rawNote: 'redo',
      authorActorId: 'actor-1',
      authorClerkId: 'clerk-1',
    })
    expect(id).toBeNull()
    expect(createComment).not.toHaveBeenCalled()
  })
})

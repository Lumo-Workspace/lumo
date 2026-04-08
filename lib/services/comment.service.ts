// lib/services/comment.service.ts
import { commentRepository } from '@/lib/repositories/comment.repository'

interface CreateCommentInput {
  taskId: string
  authorActorId: string
  body: string
  parentId: string | null
  quotedCommentId: string | null
}

export const commentService = {
  /** Get all top-level comments with replies for a task. */
  async getComments(taskId: string) {
    return commentRepository.findByTaskId(taskId)
  },

  /** Create a comment or reply with validation. Throws on validation errors. */
  async createComment(input: CreateCommentInput) {
    if (input.parentId) {
      const parent = await commentRepository.findById(input.parentId)
      if (!parent || parent.taskId !== input.taskId) {
        throw Object.assign(new Error('Parent comment not found'), {
          status: 404,
        })
      }
      if (parent.parentId !== null) {
        throw Object.assign(new Error('Cannot reply to a reply'), {
          status: 400,
        })
      }
    }
    return commentRepository.create(input)
  },

  /** Parse @mention clerkIds from comment body HTML. Excludes author and __agent__. */
  parseMentionedClerkIds(body: string, authorClerkId: string): string[] {
    const mentionRegex = /data-type="mention"[^>]*data-id="([^"]+)"/g
    const ids: string[] = []
    let match: RegExpExecArray | null
    while ((match = mentionRegex.exec(body)) !== null) {
      const clerkId = match[1]
      if (
        clerkId &&
        clerkId !== authorClerkId &&
        clerkId !== '__agent__' &&
        !ids.includes(clerkId)
      ) {
        ids.push(clerkId)
      }
    }
    return ids
  },

  /** Check if comment body contains an @agent mention. */
  hasAgentMention(body: string): boolean {
    return body.includes('data-id="__agent__"')
  },
}

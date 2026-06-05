import {
  buildCreateCommentPayload,
  newCommentId,
} from '@/app/workspace/[workspaceUrl]/components/document/comments/useCreateDocComment'

describe('buildCreateCommentPayload', () => {
  it('selects the captured range, applies the mark, returns payload incl. content', () => {
    const chain = {
      setTextSelection: jest.fn().mockReturnThis(),
      setComment: jest.fn().mockReturnThis(),
      run: jest.fn().mockReturnValue(true),
    }
    const editor = {
      chain: () => chain,
      getHTML: () => '<p><span data-comment-id="ID">hi</span></p>',
    } as never
    const payload = buildCreateCommentPayload(editor, {
      id: 'ID',
      body: 'nice',
      from: 1,
      to: 3,
      quotedText: 'hi',
    })
    expect(chain.setTextSelection).toHaveBeenCalledWith({ from: 1, to: 3 })
    expect(chain.setComment).toHaveBeenCalledWith('ID')
    expect(chain.run).toHaveBeenCalled()
    expect(payload).toEqual({
      id: 'ID',
      body: 'nice',
      from: 1,
      to: 3,
      quotedText: 'hi',
      content: '<p><span data-comment-id="ID">hi</span></p>',
    })
  })
})

describe('newCommentId', () => {
  it('returns a non-empty unique string', () => {
    const a = newCommentId()
    const b = newCommentId()
    expect(typeof a).toBe('string')
    expect(a.length).toBeGreaterThan(7)
    expect(a).not.toBe(b)
  })
})

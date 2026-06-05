// __tests__/lib/validation/documentComment.schema.test.ts
import {
  createDocumentCommentSchema,
  updateDocumentCommentSchema,
  resolveDocumentCommentSchema,
} from '@/lib/validation/schemas'

describe('createDocumentCommentSchema', () => {
  it('accepts a valid top-level anchored comment', () => {
    const r = createDocumentCommentSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      body: 'hi',
      from: 1,
      to: 5,
      quotedText: 'brave',
      content: '<p><span data-comment-id="x">brave</span></p>',
    })
    expect(r.success).toBe(true)
  })

  it('accepts a reply (parentId, no anchor)', () => {
    const r = createDocumentCommentSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      body: 'reply',
      parentId: '550e8400-e29b-41d4-a716-446655440001',
    })
    expect(r.success).toBe(true)
  })

  it('rejects empty body', () => {
    const r = createDocumentCommentSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      body: '',
    })
    expect(r.success).toBe(false)
  })

  it('rejects to < from', () => {
    const r = createDocumentCommentSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      body: 'x',
      from: 5,
      to: 1,
    })
    expect(r.success).toBe(false)
  })

  it('accepts a client-generated uuid as id', () => {
    const r = createDocumentCommentSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      body: 'hi',
    })
    expect(r.success).toBe(true)
  })

  it('rejects an empty id', () => {
    expect(
      createDocumentCommentSchema.safeParse({ id: '', body: 'x' }).success
    ).toBe(false)
  })
})

describe('updateDocumentCommentSchema', () => {
  it('accepts a non-empty body', () => {
    expect(
      updateDocumentCommentSchema.safeParse({ body: 'updated' }).success
    ).toBe(true)
  })
  it('rejects empty body', () => {
    expect(updateDocumentCommentSchema.safeParse({ body: '' }).success).toBe(
      false
    )
  })
})

describe('resolveDocumentCommentSchema', () => {
  it('accepts OPEN/RESOLVED', () => {
    expect(
      resolveDocumentCommentSchema.safeParse({ status: 'RESOLVED' }).success
    ).toBe(true)
  })
  it('rejects junk status', () => {
    expect(
      resolveDocumentCommentSchema.safeParse({ status: 'NOPE' }).success
    ).toBe(false)
  })
})

import {
  updateDocumentSchema,
  updateTaskSchema,
  cliUpdateTaskSchema,
} from '@/lib/validation/schemas'

const CUID_A = 'cl000000000000000000000a'
const CUID_B = 'cl000000000000000000000b'

describe.each([
  ['updateDocumentSchema', updateDocumentSchema],
  ['updateTaskSchema', updateTaskSchema],
  ['cliUpdateTaskSchema', cliUpdateTaskSchema],
])('%s — tag mutex', (_, schema) => {
  it('rejects tagIds + addTagIds', () => {
    const r = schema.safeParse({ tagIds: [], addTagIds: [CUID_A] })
    expect(r.success).toBe(false)
  })
  it('rejects tagIds + removeTagIds', () => {
    const r = schema.safeParse({ tagIds: [], removeTagIds: [CUID_A] })
    expect(r.success).toBe(false)
  })
  it('accepts only tagIds', () => {
    const r = schema.safeParse({ tagIds: [CUID_A] })
    expect(r.success).toBe(true)
  })
  it('accepts only addTagIds + removeTagIds', () => {
    const r = schema.safeParse({ addTagIds: [CUID_A], removeTagIds: [CUID_B] })
    expect(r.success).toBe(true)
  })
})

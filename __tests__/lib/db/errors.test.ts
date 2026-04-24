import { isPrismaUniqueViolation } from '@/lib/db/errors'

describe('isPrismaUniqueViolation', () => {
  it('returns true for objects with code=P2002', () => {
    expect(isPrismaUniqueViolation({ code: 'P2002' })).toBe(true)
  })

  it('returns true for Error objects with code=P2002', () => {
    const err = Object.assign(new Error('unique'), { code: 'P2002' })
    expect(isPrismaUniqueViolation(err)).toBe(true)
  })

  it('returns false for other Prisma codes', () => {
    expect(isPrismaUniqueViolation({ code: 'P2025' })).toBe(false)
  })

  it('returns false for plain Error', () => {
    expect(isPrismaUniqueViolation(new Error('boom'))).toBe(false)
  })

  it('returns false for null/undefined/string', () => {
    expect(isPrismaUniqueViolation(null)).toBe(false)
    expect(isPrismaUniqueViolation(undefined)).toBe(false)
    expect(isPrismaUniqueViolation('P2002')).toBe(false)
  })
})

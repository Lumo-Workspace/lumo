/** @jest-environment node */
import { createArtifactBodySchema } from '@/lib/validation/task-artifact'

describe('createArtifactBodySchema', () => {
  it('accepts a full valid body', () => {
    const r = createArtifactBodySchema.safeParse({
      kind: 'spec',
      title: 'Spec',
      content: '## Requirements',
      source: 'superpowers',
    })
    expect(r.success).toBe(true)
  })

  it('accepts a body without source (optional)', () => {
    const r = createArtifactBodySchema.safeParse({
      kind: 'plan',
      title: 'Plan',
      content: 'x',
    })
    expect(r.success).toBe(true)
  })

  it('rejects empty kind / title / content', () => {
    expect(
      createArtifactBodySchema.safeParse({ kind: '', title: 'T', content: 'c' })
        .success
    ).toBe(false)
    expect(
      createArtifactBodySchema.safeParse({ kind: 'k', title: '', content: 'c' })
        .success
    ).toBe(false)
    expect(
      createArtifactBodySchema.safeParse({ kind: 'k', title: 'T', content: '' })
        .success
    ).toBe(false)
  })

  it('rejects unknown keys (strict)', () => {
    const r = createArtifactBodySchema.safeParse({
      kind: 'k',
      title: 'T',
      content: 'c',
      status: 'APPROVED',
    })
    expect(r.success).toBe(false)
  })
})

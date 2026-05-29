/** @jest-environment node */
import {
  createArtifactBodySchema,
  updateArtifactBodySchema,
} from '@/lib/validation/task-artifact'

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

  it('rejects a body without source (now required)', () => {
    const r = createArtifactBodySchema.safeParse({
      kind: 'plan',
      title: 'Plan',
      content: 'x',
    })
    expect(r.success).toBe(false)
  })

  it('rejects empty source', () => {
    const r = createArtifactBodySchema.safeParse({
      kind: 'plan',
      title: 'Plan',
      content: 'x',
      source: '',
    })
    expect(r.success).toBe(false)
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

describe('updateArtifactBodySchema', () => {
  it('accepts a single editable field', () => {
    expect(updateArtifactBodySchema.safeParse({ kind: 'plan' }).success).toBe(
      true
    )
    expect(
      updateArtifactBodySchema.safeParse({ source: 'spec-kit' }).success
    ).toBe(true)
    expect(
      updateArtifactBodySchema.safeParse({ title: 'New title' }).success
    ).toBe(true)
  })

  it('accepts multiple editable fields', () => {
    const r = updateArtifactBodySchema.safeParse({
      kind: 'plan',
      title: 'Final',
      source: 'openspec',
    })
    expect(r.success).toBe(true)
  })

  it('rejects an empty body (at least one field required)', () => {
    expect(updateArtifactBodySchema.safeParse({}).success).toBe(false)
  })

  it('rejects empty-string field values', () => {
    expect(updateArtifactBodySchema.safeParse({ kind: '' }).success).toBe(false)
    expect(updateArtifactBodySchema.safeParse({ source: '' }).success).toBe(
      false
    )
  })

  it('rejects content (not editable) and unknown keys (strict)', () => {
    expect(
      updateArtifactBodySchema.safeParse({ content: 'new body' }).success
    ).toBe(false)
    expect(
      updateArtifactBodySchema.safeParse({ kind: 'plan', status: 'APPROVED' })
        .success
    ).toBe(false)
  })
})

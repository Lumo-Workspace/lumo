/**
 * @jest-environment node
 *
 * LUM-1084 — the model-catalog check, without the network.
 */
import {
  checkModels,
  collectModelRefs,
  hasProblems,
} from '../../scripts/check-model-catalog'

describe('collectModelRefs', () => {
  it('takes every *_MODEL string export, grouped by id', () => {
    expect(
      collectModelRefs({
        FAST_MODEL: 'deepseek/deepseek-v4-flash',
        TRANSLATION_MODEL: 'deepseek/deepseek-v4-flash',
        HUNT_MODEL: 'anthropic/claude-haiku-4.5',
        MODEL_PROVIDER_PINS: { x: ['y'] },
        SOMETHING_ELSE: 'not/a-model-constant',
      })
    ).toEqual([
      { id: 'anthropic/claude-haiku-4.5', constants: ['HUNT_MODEL'] },
      {
        id: 'deepseek/deepseek-v4-flash',
        constants: ['FAST_MODEL', 'TRANSLATION_MODEL'],
      },
    ])
  })
})

describe('checkModels', () => {
  const refs = [
    { id: 'alibaba/qwen3-coder-plus', constants: ['HUNT_MODEL'] },
    { id: 'anthropic/claude-sonnet-5.5', constants: ['CODE_REVIEW_MODEL'] },
    { id: 'openai/gpt-5.5', constants: ['REASONING_MODEL'] },
  ]
  const catalog = new Set(['anthropic/claude-sonnet-5.5', 'openai/gpt-5.5'])
  const pins = { 'anthropic/claude-sonnet-5.5': ['anthropic'] }

  it('flags a model that left the catalog (the LUM-1084 incident)', () => {
    const out = checkModels(
      refs,
      catalog,
      pins,
      new Map([['anthropic/claude-sonnet-5.5', ['anthropic', 'bedrock']]])
    )
    expect(out.find(c => c.id === 'alibaba/qwen3-coder-plus')).toMatchObject({
      inCatalog: false,
    })
    expect(out.find(c => c.id === 'anthropic/claude-sonnet-5.5')).toMatchObject(
      { inCatalog: true, pinUnserved: false }
    )
    expect(hasProblems(out)).toBe(true)
  })

  it('flags a pinned model no pinned host serves any more', () => {
    const out = checkModels(
      refs.slice(1),
      catalog,
      pins,
      new Map([['anthropic/claude-sonnet-5.5', ['bedrock']]])
    )
    expect(out[0]).toMatchObject({ pinUnserved: true, hosts: ['bedrock'] })
    expect(hasProblems(out)).toBe(true)
  })

  it('is clean when every id is listed and every pin is served', () => {
    const out = checkModels(
      refs.slice(1),
      catalog,
      pins,
      new Map([['anthropic/claude-sonnet-5.5', ['anthropic']]])
    )
    expect(hasProblems(out)).toBe(false)
    expect(out[1]).toEqual({
      id: 'openai/gpt-5.5',
      constants: ['REASONING_MODEL'],
      inCatalog: true,
    })
  })
})

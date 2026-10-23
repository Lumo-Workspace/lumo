import { repairPreMergeChecksText } from '@/ee/security/llm/pre-merge-checks-repair'
import { PreMergeChecksAnswerSchema } from '@/ee/security/llm/pre-merge-checks-client'

jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@/lib/ai/gateway', () => ({ gateway: (id: string) => ({ id }) }))

const valid = (text: string | null) =>
  text !== null &&
  PreMergeChecksAnswerSchema.safeParse(JSON.parse(text)).success

const CHECK = {
  id: 'title',
  verdict: 'passed',
  explanation: 'Concise.',
  resolution: '',
  requirements: [],
}

describe('LUM-1304 pre-merge checks envelope repair', () => {
  it('strips a ```json fence around a valid answer', () => {
    const text =
      'Here you go:\n```json\n' + JSON.stringify({ results: [CHECK] }) + '\n```'
    const out = repairPreMergeChecksText(text)
    expect(valid(out)).toBe(true)
    expect(JSON.parse(out!).results[0]).toEqual(CHECK)
  })

  it('wraps a bare array of results', () => {
    const out = repairPreMergeChecksText(JSON.stringify([CHECK]))
    expect(valid(out)).toBe(true)
  })

  it('moves swapped enum keys: outcome on a check, verdict on a requirement', () => {
    const out = repairPreMergeChecksText(
      JSON.stringify({
        results: [
          {
            id: 'issue_assessment',
            outcome: 'failed',
            explanation: 'x',
            resolution: 'y',
            requirements: [{ id: 'task:goal', verdict: 'not_addressed' }],
          },
        ],
      })
    )
    expect(valid(out)).toBe(true)
    const r = JSON.parse(out!).results[0]
    expect(r.verdict).toBe('failed')
    expect(r.outcome).toBeUndefined()
    expect(r.requirements[0]).toEqual({
      id: 'task:goal',
      outcome: 'not_addressed',
      explanation: '',
    })
  })

  it('fills only the missing prose fields, never a verdict', () => {
    const out = repairPreMergeChecksText(
      JSON.stringify({ results: [{ id: 'title', verdict: 'passed' }] })
    )
    expect(valid(out)).toBe(true)
    // No verdict written by the model ⇒ none invented: still invalid.
    const none = repairPreMergeChecksText(
      JSON.stringify({ results: [{ id: 'title', outcome: 'addressed' }] })
    )
    expect(valid(none)).toBe(false)
  })

  it('leaves what it cannot read alone', () => {
    expect(repairPreMergeChecksText('')).toBeNull()
    expect(repairPreMergeChecksText('I think every check passed.')).toBeNull()
    expect(repairPreMergeChecksText('{"answer": "passed"}')).toBeNull()
    expect(repairPreMergeChecksText('{"results": [')).toBeNull()
  })
})

/** @jest-environment node */
import type { ModelMessage } from 'ai'
import {
  elideOlderToolResults,
  elisionStub,
} from '@/lib/security-scan/hunt/transcript'
import {
  HUNT_ELIDE_KEEP_STEPS,
  HUNT_ELIDE_MIN_CHARS,
} from '@/lib/services/security-hunt.config'

/** One completed step: the assistant's call and the tool's answer. */
function step(id: string, output: string, error?: string): ModelMessage[] {
  return [
    {
      role: 'assistant',
      content: [
        { type: 'text', text: `reading ${id}` },
        {
          type: 'tool-call',
          toolCallId: id,
          toolName: 'run_shell',
          input: { command: `sed -n '1,80p' ${id}.ts` },
        },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: id,
          toolName: 'run_shell',
          output: {
            type: 'json',
            value: error === undefined ? { output } : { output, error },
          },
        },
      ],
    },
  ]
}

const resultOf = (m: ModelMessage): { output: string; error?: string } =>
  (m.content as Array<{ output: { value: unknown } }>)[0]!.output.value as {
    output: string
    error?: string
  }

// LUM-787 — what the model is SENT: older tool results become stubs, the
// latest step's results stay whole, and the transcript handed in is never
// mutated (the SDK's own copy, and the audit, keep every byte).
describe('LUM-787 transcript elision (pure)', () => {
  const big = (c: string) => c.repeat(2_000)

  it('stubs long results older than the latest step and keeps the latest whole', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'task' },
      ...step('a', big('a')),
      ...step('b', big('b')),
      ...step('c', big('c')),
    ]
    const before = JSON.stringify(messages)

    const out = elideOlderToolResults(messages)

    expect(HUNT_ELIDE_KEEP_STEPS).toBe(1)
    expect(out.elided).toBe(2)
    expect(out.elidedChars).toBe(4_000)
    // Message count and roles are unchanged — only the two older results.
    expect(out.messages.map(m => m.role)).toEqual(messages.map(m => m.role))
    expect(resultOf(out.messages[2]!)).toEqual({ output: elisionStub(2_000) })
    expect(resultOf(out.messages[4]!)).toEqual({ output: elisionStub(2_000) })
    expect(resultOf(out.messages[6]!)).toEqual({ output: big('c') })
    // The assistant's own text between steps survives: that is where what it
    // learned from the elided output lives now.
    expect(JSON.stringify(out.messages[1])).toContain('reading a')
    // Input untouched.
    expect(JSON.stringify(messages)).toBe(before)
  })

  it('keeps a short result whole at any age — a stub longer than the hit saves nothing', () => {
    const hit = 'lib/a.ts:12: prisma.$queryRawUnsafe(sql)'
    expect(hit.length).toBeLessThanOrEqual(HUNT_ELIDE_MIN_CHARS)
    const messages: ModelMessage[] = [
      { role: 'user', content: 'task' },
      ...step('a', hit),
      ...step('b', big('b')),
      ...step('c', 'latest'),
    ]
    const out = elideOlderToolResults(messages)
    expect(out.elided).toBe(1)
    expect(out.elidedChars).toBe(2_000)
    expect(resultOf(out.messages[2]!)).toEqual({ output: hit })
  })

  it('carries a refusal through the stub — the error is the part the model must still see', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'task' },
      ...step('a', big('a'), 'git is not allowed'),
      ...step('b', 'latest'),
    ]
    const out = elideOlderToolResults(messages)
    expect(resultOf(out.messages[2]!)).toEqual({
      output: elisionStub(2_000),
      error: 'git is not allowed',
    })
  })

  it('elides a text-typed tool output the same way, and leaves unknown shapes alone', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'task' },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 't',
            toolName: 'run_shell',
            output: { type: 'text', value: big('t') },
          },
          {
            type: 'tool-result',
            toolCallId: 'u',
            toolName: 'submit_candidates',
            output: { type: 'json', value: { accepted: 0 } },
          },
        ],
      },
      ...step('b', 'latest'),
    ]
    const out = elideOlderToolResults(messages)
    const parts = out.messages[1]!.content as Array<{
      output: { type: string; value: unknown }
    }>
    expect(parts[0]!.output).toEqual({
      type: 'text',
      value: elisionStub(2_000),
    })
    expect(parts[1]!.output).toEqual({ type: 'json', value: { accepted: 0 } })
    expect(out.elided).toBe(1)
  })

  it('elides nothing while the transcript has no step older than the kept ones', () => {
    const one: ModelMessage[] = [
      { role: 'user', content: 'task' },
      ...step('a', big('a')),
    ]
    expect(elideOlderToolResults(one)).toEqual({
      messages: one,
      elided: 0,
      elidedChars: 0,
    })
    expect(
      elideOlderToolResults([{ role: 'user', content: 'task' }]).elided
    ).toBe(0)
  })

  it('keepSteps is the number of latest steps kept whole', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'task' },
      ...step('a', big('a')),
      ...step('b', big('b')),
      ...step('c', big('c')),
    ]
    expect(elideOlderToolResults(messages, 2).elided).toBe(1)
    expect(elideOlderToolResults(messages, 0).elided).toBe(3)
    expect(elideOlderToolResults(messages, 5).elided).toBe(0)
  })
})

import { HookEventType } from '@prisma/client'
import {
  HOOK_PAYLOAD_SCHEMAS,
  HOOK_FREE_TEXT_CAP,
  validateHookPayload,
} from '@/lib/validation/hook-payload'

const ALL_TYPES = Object.values(HookEventType)

const hugeText = 'x'.repeat(HOOK_FREE_TEXT_CAP + 100)

function marker(payload: Record<string, unknown>) {
  return payload['_lumo_validation'] as
    | { truncated?: string[]; dropped?: string[] }
    | undefined
}

describe('HOOK_PAYLOAD_SCHEMAS', () => {
  it('covers every HookEventType', () => {
    for (const type of ALL_TYPES) {
      expect(HOOK_PAYLOAD_SCHEMAS[type]).toBeDefined()
    }
    expect(Object.keys(HOOK_PAYLOAD_SCHEMAS).sort()).toEqual(
      [...ALL_TYPES].sort()
    )
  })
})

describe('validateHookPayload', () => {
  describe('passthrough', () => {
    it('returns an in-cap well-formed payload as the same reference with no marker', () => {
      const payload = {
        session_id: 'sess_1',
        cwd: '/repo',
        tool_name: 'Read',
        tool_input: { file_path: '/repo/a.ts' },
        hook_event_name: 'PreToolUse',
      }
      const result = validateHookPayload('PRE_TOOL_USE', payload)
      expect(result.modified).toBe(false)
      expect(result.payload).toBe(payload)
      expect(marker(result.payload)).toBeUndefined()
    })

    it.each(ALL_TYPES)(
      'passes a typical %s payload through unchanged',
      type => {
        const payload = {
          session_id: 'sess_1',
          cwd: '/repo',
          transcript_path: '/tmp/t.jsonl',
          extra_unknown_field: { nested: ['kept', 1, true, null] },
        }
        const result = validateHookPayload(type, payload)
        expect(result.modified).toBe(false)
        expect(result.payload).toBe(payload)
      }
    )

    it('keeps unknown fields (schemas are loose, not stripping)', () => {
      const payload = { session_id: 's', some_future_field: 'kept' }
      const result = validateHookPayload('STOP', payload)
      expect(result.payload).toBe(payload)
      expect(
        (result.payload as Record<string, unknown>)['some_future_field']
      ).toBe('kept')
    })

    it('accepts a well-formed _lumo_usage object on STOP', () => {
      const payload = {
        session_id: 's',
        _lumo_usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          byModel: { 'claude-fable-5': { input: 10, output: 5 } },
        },
      }
      const result = validateHookPayload('STOP', payload)
      expect(result.modified).toBe(false)
      expect(result.payload).toBe(payload)
    })
  })

  describe('truncates', () => {
    it('truncates an oversized last_assistant_message on STOP and marks the path', () => {
      const payload = { session_id: 's', last_assistant_message: hugeText }
      const result = validateHookPayload('STOP', payload)
      expect(result.modified).toBe(true)
      const stored = result.payload as Record<string, unknown>
      expect((stored['last_assistant_message'] as string).length).toBe(
        HOOK_FREE_TEXT_CAP
      )
      expect(marker(stored)?.truncated).toContain('last_assistant_message')
    })

    it('truncates oversized strings nested inside tool_input on PRE_TOOL_USE', () => {
      const payload = {
        session_id: 's',
        tool_name: 'Write',
        tool_input: { file_path: '/a.ts', content: hugeText },
      }
      const result = validateHookPayload('PRE_TOOL_USE', payload)
      const stored = result.payload as Record<string, unknown>
      const toolInput = stored['tool_input'] as Record<string, unknown>
      expect((toolInput['content'] as string).length).toBe(HOOK_FREE_TEXT_CAP)
      expect(toolInput['file_path']).toBe('/a.ts')
      expect(marker(stored)?.truncated).toContain('tool_input.content')
    })

    it('truncates oversized strings nested inside tool_response on POST_TOOL_USE', () => {
      const payload = {
        session_id: 's',
        tool_name: 'Read',
        tool_response: { output: hugeText },
      }
      const result = validateHookPayload('POST_TOOL_USE', payload)
      const stored = result.payload as Record<string, unknown>
      const toolResponse = stored['tool_response'] as Record<string, unknown>
      expect((toolResponse['output'] as string).length).toBe(HOOK_FREE_TEXT_CAP)
      expect(marker(stored)?.truncated).toContain('tool_response.output')
    })

    it('truncates an oversized prompt on USER_PROMPT_SUBMIT', () => {
      const payload = { session_id: 's', prompt: hugeText }
      const result = validateHookPayload('USER_PROMPT_SUBMIT', payload)
      const stored = result.payload as Record<string, unknown>
      expect((stored['prompt'] as string).length).toBe(HOOK_FREE_TEXT_CAP)
      expect(marker(stored)?.truncated).toContain('prompt')
    })

    it('truncates strings inside arrays and records the indexed path', () => {
      const payload = {
        session_id: 's',
        tool_response: [{ text: hugeText }, 'short'],
      }
      const result = validateHookPayload('POST_TOOL_USE', payload)
      const stored = result.payload as Record<string, unknown>
      const arr = stored['tool_response'] as Array<unknown>
      expect(
        ((arr[0] as Record<string, unknown>)['text'] as string).length
      ).toBe(HOOK_FREE_TEXT_CAP)
      expect(arr[1]).toBe('short')
      expect(marker(stored)?.truncated).toContain('tool_response.0.text')
    })

    it.each(ALL_TYPES)('truncates an oversized free-text field on %s', type => {
      const payload = { session_id: 's', details: hugeText }
      const result = validateHookPayload(type, payload)
      const stored = result.payload as Record<string, unknown>
      expect((stored['details'] as string).length).toBe(HOOK_FREE_TEXT_CAP)
      expect(marker(stored)?.truncated).toContain('details')
    })

    it('does not mutate the caller-provided payload object', () => {
      const payload = { session_id: 's', prompt: hugeText }
      validateHookPayload('USER_PROMPT_SUBMIT', payload)
      expect(payload.prompt.length).toBe(HOOK_FREE_TEXT_CAP + 100)
      expect(marker(payload)).toBeUndefined()
    })
  })

  describe('wrong-typed key fields', () => {
    it('drops a non-string session_id and marks it, keeping the rest', () => {
      const payload = { session_id: 42, cwd: '/repo', tool_name: 'Read' }
      const result = validateHookPayload('PRE_TOOL_USE', payload)
      expect(result.modified).toBe(true)
      const stored = result.payload as Record<string, unknown>
      expect(stored['session_id']).toBeUndefined()
      expect(stored['cwd']).toBe('/repo')
      expect(stored['tool_name']).toBe('Read')
      expect(marker(stored)?.dropped).toContain('session_id')
    })

    it('drops a non-object _lumo_usage on STOP', () => {
      const payload = { session_id: 's', _lumo_usage: 'garbage' }
      const result = validateHookPayload('STOP', payload)
      const stored = result.payload as Record<string, unknown>
      expect(stored['_lumo_usage']).toBeUndefined()
      expect(marker(stored)?.dropped).toContain('_lumo_usage')
    })

    it('drops a non-object tool_input', () => {
      const payload = { session_id: 's', tool_input: 'not-an-object' }
      const result = validateHookPayload('PRE_TOOL_USE', payload)
      const stored = result.payload as Record<string, unknown>
      expect(stored['tool_input']).toBeUndefined()
      expect(marker(stored)?.dropped).toContain('tool_input')
    })

    it('drops a non-string cwd without touching session linkage fields', () => {
      const payload = { session_id: 's', cwd: ['not', 'a', 'string'] }
      const result = validateHookPayload('SESSION_START', payload)
      const stored = result.payload as Record<string, unknown>
      expect(stored['cwd']).toBeUndefined()
      expect(stored['session_id']).toBe('s')
      expect(marker(stored)?.dropped).toContain('cwd')
    })

    it('rejects a client-supplied _lumo_validation marker (reserved key)', () => {
      const payload = {
        session_id: 's',
        _lumo_validation: { truncated: ['fake'] },
      }
      const result = validateHookPayload('STOP', payload)
      const stored = result.payload as Record<string, unknown>
      expect(marker(stored)?.truncated).toBeUndefined()
      expect(marker(stored)?.dropped).toContain('_lumo_validation')
    })

    it('rejects a client-supplied _lumo_context_metrics key (LUM-402 reserved key)', () => {
      const payload = {
        session_id: 's',
        _lumo_context_metrics: { totalTokens: 999_999, forged: true },
      }
      const result = validateHookPayload('SESSION_START', payload)
      const stored = result.payload as Record<string, unknown>
      expect(stored['_lumo_context_metrics']).toBeUndefined()
      expect(stored['session_id']).toBe('s')
      expect(marker(stored)?.dropped).toContain('_lumo_context_metrics')
    })
  })

  describe('non-object payloads', () => {
    it.each([
      ['array', ['a', 'b']],
      ['string', 'just-a-string'],
      ['number', 42],
      ['null', null],
    ])('replaces a %s body with a marked empty object', (_label, raw) => {
      const result = validateHookPayload('STOP', raw)
      expect(result.modified).toBe(true)
      expect(marker(result.payload)?.dropped).toContain('$root')
    })
  })
})

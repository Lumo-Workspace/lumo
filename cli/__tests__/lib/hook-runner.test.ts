import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  augmentBodyWithUsage,
  augmentBodyWithGitTask,
} from '../../src/lib/hook-runner'

function writeTranscript(lines: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'lumo-hook-runner-'))
  const path = join(dir, 'transcript.jsonl')
  writeFileSync(path, lines.map(l => JSON.stringify(l)).join('\n'))
  return path
}

describe('augmentBodyWithUsage', () => {
  it('injects _lumo_usage for a stop hook with a valid transcript_path', () => {
    const transcriptPath = writeTranscript([
      { type: 'user', message: {} },
      {
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cache_read_input_tokens: 5,
            cache_creation_input_tokens: 3,
          },
        },
      },
      {
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 50,
            output_tokens: 10,
            cache_read_input_tokens: 2,
            cache_creation_input_tokens: 1,
          },
        },
      },
    ])

    const input = JSON.stringify({
      session_id: 'sess-abc',
      transcript_path: transcriptPath,
    })

    const result = JSON.parse(augmentBodyWithUsage('stop', input))

    expect(result._lumo_usage).toEqual({
      inputTokens: 150,
      outputTokens: 30,
      cacheReadTokens: 7,
      cacheCreationTokens: 4,
      byModel: {
        unknown: { input: 150, output: 30, cacheRead: 7, cacheCreation: 4 },
      },
    })
    // original fields preserved
    expect(result.session_id).toBe('sess-abc')
    expect(result.transcript_path).toBe(transcriptPath)
  })

  it('injects _lumo_usage for a stop-failure hook with a valid transcript_path', () => {
    const transcriptPath = writeTranscript([
      {
        type: 'assistant',
        message: {
          usage: { input_tokens: 42, output_tokens: 7 },
        },
      },
    ])

    const input = JSON.stringify({ transcript_path: transcriptPath })
    const result = JSON.parse(augmentBodyWithUsage('stop-failure', input))

    expect(result._lumo_usage).toEqual({
      inputTokens: 42,
      outputTokens: 7,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      byModel: {
        unknown: { input: 42, output: 7, cacheRead: 0, cacheCreation: 0 },
      },
    })
  })

  it('injects _lumo_usage for a post-tool-batch hook so the server can surface live burn (LUM-345)', () => {
    const transcriptPath = writeTranscript([
      {
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cache_read_input_tokens: 5,
            cache_creation_input_tokens: 3,
          },
        },
      },
    ])

    const input = JSON.stringify({
      session_id: 'sess-abc',
      transcript_path: transcriptPath,
    })

    const result = JSON.parse(augmentBodyWithUsage('post-tool-batch', input))

    expect(result._lumo_usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 5,
      cacheCreationTokens: 3,
      byModel: {
        unknown: { input: 100, output: 20, cacheRead: 5, cacheCreation: 3 },
      },
    })
  })

  it('returns body unchanged for non-stop paths (identity)', () => {
    const body = JSON.stringify({ transcript_path: '/some/path.jsonl', foo: 1 })
    expect(augmentBodyWithUsage('pre-tool-use', body)).toBe(body)
    expect(augmentBodyWithUsage('session-start', body)).toBe(body)
    expect(augmentBodyWithUsage('post-tool-use', body)).toBe(body)
  })

  it('returns body unchanged when transcript_path is absent', () => {
    const body = JSON.stringify({ session_id: 'abc' })
    expect(augmentBodyWithUsage('stop', body)).toBe(body)
  })

  it('returns body unchanged when transcript_path points to a nonexistent file', () => {
    const body = JSON.stringify({
      transcript_path: '/no/such/file.jsonl',
    })
    expect(augmentBodyWithUsage('stop', body)).toBe(body)
  })

  it('returns body unchanged when transcript has no assistant usage', () => {
    const transcriptPath = writeTranscript([{ type: 'user', message: {} }])
    const body = JSON.stringify({ transcript_path: transcriptPath })
    expect(augmentBodyWithUsage('stop', body)).toBe(body)
  })

  it('returns body unchanged when the body is invalid JSON (no throw)', () => {
    expect(() => augmentBodyWithUsage('stop', 'not json {')).not.toThrow()
    expect(augmentBodyWithUsage('stop', 'not json {')).toBe('not json {')
  })

  it('returns body unchanged when transcript_path is an empty string', () => {
    const body = JSON.stringify({ transcript_path: '' })
    expect(augmentBodyWithUsage('stop', body)).toBe(body)
  })

  it('groups _lumo_usage by model when assistant entries carry model strings', () => {
    const transcriptPath = writeTranscript([
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-4-8',
          usage: {
            input_tokens: 100,
            output_tokens: 10,
            cache_read_input_tokens: 5,
            cache_creation_input_tokens: 2,
          },
        },
      },
      {
        type: 'assistant',
        message: {
          model: 'claude-sonnet-4-6',
          usage: {
            input_tokens: 30,
            output_tokens: 3,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      },
    ])
    const result = JSON.parse(
      augmentBodyWithUsage(
        'stop',
        JSON.stringify({ transcript_path: transcriptPath })
      )
    )
    expect(result._lumo_usage.byModel).toEqual({
      'claude-opus-4-8': {
        input: 100,
        output: 10,
        cacheRead: 5,
        cacheCreation: 2,
      },
      'claude-sonnet-4-6': {
        input: 30,
        output: 3,
        cacheRead: 0,
        cacheCreation: 0,
      },
    })
    expect(result._lumo_usage.inputTokens).toBe(130)
  })
})

describe('augmentBodyWithUsage bySubagent', () => {
  it('keeps totals inclusive and adds one cumulative entry per subagent file', () => {
    const main = writeTranscript([
      {
        type: 'assistant',
        message: {
          model: 'opus',
          usage: { input_tokens: 200, output_tokens: 20 },
        },
      },
    ])
    const subDir = join(main.slice(0, -'.jsonl'.length), 'subagents')
    mkdirSync(subDir, { recursive: true })
    writeFileSync(
      join(subDir, 'agent-abeaba01ea909a7ee.jsonl'),
      JSON.stringify({
        type: 'assistant',
        message: {
          model: 'sonnet',
          usage: { input_tokens: 100, output_tokens: 10 },
        },
      })
    )
    const out = JSON.parse(
      augmentBodyWithUsage('stop', JSON.stringify({ transcript_path: main }))
    )
    expect(out._lumo_usage.inputTokens).toBe(300)
    expect(out._lumo_usage.bySubagent).toEqual({
      abeaba01ea909a7ee: {
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        byModel: {
          sonnet: { input: 100, output: 10, cacheRead: 0, cacheCreation: 0 },
        },
      },
    })
  })

  it('omits bySubagent when there are no subagent transcripts', () => {
    const main = writeTranscript([
      {
        type: 'assistant',
        message: {
          model: 'opus',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      },
    ])
    const out = JSON.parse(
      augmentBodyWithUsage('stop', JSON.stringify({ transcript_path: main }))
    )
    expect(out._lumo_usage).not.toHaveProperty('bySubagent')
  })

  it('skips subagent files whose id would be rejected by the server', () => {
    const main = writeTranscript([
      {
        type: 'assistant',
        message: {
          model: 'opus',
          usage: { input_tokens: 5, output_tokens: 1 },
        },
      },
    ])
    const subDir = join(main.slice(0, -'.jsonl'.length), 'subagents')
    mkdirSync(subDir, { recursive: true })
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        model: 'sonnet',
        usage: { input_tokens: 7, output_tokens: 1 },
      },
    })
    writeFileSync(join(subDir, 'agent-good_id-1.jsonl'), line)
    writeFileSync(join(subDir, 'agent-bad id!.jsonl'), line)
    const out = JSON.parse(
      augmentBodyWithUsage('stop', JSON.stringify({ transcript_path: main }))
    )
    expect(Object.keys(out._lumo_usage.bySubagent)).toEqual(['good_id-1'])
    // inclusive totals still count both files
    expect(out._lumo_usage.inputTokens).toBe(19)
  })
})

describe('augmentBodyWithGitTask', () => {
  const body = JSON.stringify({ session_id: 's1', cwd: '/repo' })
  const hit = () => ({ identifier: 'LUM-12', source: 'branch' as const })

  it('adds _lumo_git_task on session-start', () => {
    const out = JSON.parse(augmentBodyWithGitTask('session-start', body, hit))
    expect(out._lumo_git_task).toBe('LUM-12')
    expect(out.session_id).toBe('s1')
  })

  it('leaves other paths untouched', () => {
    expect(augmentBodyWithGitTask('pre-tool-use', body, hit)).toBe(body)
  })

  it('returns the body unchanged when extract throws', () => {
    const boom = () => {
      throw new Error('git exploded')
    }
    expect(augmentBodyWithGitTask('session-start', body, boom)).toBe(body)
  })

  it('returns the body unchanged without cwd or on no match', () => {
    const noCwd = JSON.stringify({ session_id: 's1' })
    expect(augmentBodyWithGitTask('session-start', noCwd, hit)).toBe(noCwd)
    expect(augmentBodyWithGitTask('session-start', body, () => null)).toBe(body)
  })
})

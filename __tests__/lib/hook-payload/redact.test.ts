import { createHash } from 'crypto'
import {
  FAILURE_ERROR_CAP,
  REDACTED_FIELD,
  hasRedactedContent,
  readRedactedPatch,
  readRedactedStats,
  stripCodeFromHookPayload,
} from '@/lib/hook-payload/redact'

const CODE = 'export const secret = compute()\nconsole.info(secret)\n'
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

describe('stripCodeFromHookPayload', () => {
  it('redaction keeps written code only for test files', () => {
    const write = stripCodeFromHookPayload('POST_TOOL_USE', {
      tool_name: 'Write',
      tool_input: { file_path: '/repo/lib/billing.ts', content: CODE },
      tool_response: {
        type: 'create',
        filePath: '/repo/lib/billing.ts',
        content: CODE,
      },
    })
    expect(write.tool_input).toEqual({ file_path: '/repo/lib/billing.ts' })
    expect(write.tool_response).toEqual({
      type: 'create',
      filePath: '/repo/lib/billing.ts',
    })
    expect(readRedactedStats(write, 'tool_input.content')).toEqual({
      bytes: Buffer.byteLength(CODE),
      lines: 3,
      sha256: sha(CODE),
    })
    expect(JSON.stringify(write)).not.toContain('compute()')

    const edit = stripCodeFromHookPayload('POST_TOOL_USE', {
      tool_name: 'Edit',
      tool_input: {
        file_path: '/repo/lib/billing.ts',
        old_string: 'const a = 1',
        new_string: 'const a = 2',
      },
      tool_response: {
        filePath: '/repo/lib/billing.ts',
        originalFile: CODE,
        structuredPatch: [
          { oldStart: 1, lines: ['-const a = 1', '+const a = 2', ' ctx'] },
        ],
      },
    })
    expect(edit.tool_input).toEqual({ file_path: '/repo/lib/billing.ts' })
    expect(edit.tool_response).toEqual({ filePath: '/repo/lib/billing.ts' })
    expect(readRedactedPatch(edit, 'tool_response.structuredPatch')).toEqual({
      added: 1,
      removed: 1,
    })
    expect(JSON.stringify(edit)).not.toMatch(/const a = [12]|compute\(\)/)

    const multi = stripCodeFromHookPayload('PRE_TOOL_USE', {
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: '/repo/lib/billing.ts',
        edits: [
          { old_string: 'x = 1', new_string: 'x = 2', replace_all: true },
        ],
      },
    })
    expect(multi.tool_input).toEqual({
      file_path: '/repo/lib/billing.ts',
      edits: [{ replace_all: true }],
    })

    const notebook = stripCodeFromHookPayload('POST_TOOL_USE', {
      tool_name: 'NotebookEdit',
      tool_input: { notebook_path: '/repo/a.ipynb', new_source: 'print(1)' },
    })
    expect(notebook.tool_input).toEqual({ notebook_path: '/repo/a.ipynb' })

    // PostToolBatch nests each call under tool_calls[] — the shape production
    // stored raw before the TC5 fix (LUM-855). Every call is stripped by the
    // same rules, test-file edits still kept per call.
    const batch = stripCodeFromHookPayload('POST_TOOL_BATCH', {
      session_id: 's1',
      tool_calls: [
        {
          tool_name: 'Write',
          tool_use_id: 'tu_1',
          tool_input: { file_path: '/repo/lib/billing.ts', content: CODE },
          tool_response: `File created successfully: ${CODE}`,
        },
        {
          tool_name: 'Edit',
          tool_use_id: 'tu_2',
          tool_input: {
            file_path: '/repo/__tests__/billing.test.ts',
            old_string: 'toBe(3)',
            new_string: 'toBe(4)',
          },
          tool_response: { filePath: '/repo/__tests__/billing.test.ts' },
        },
        'raw string call body with compute()',
      ],
    })
    expect(JSON.stringify(batch)).not.toContain('compute()')
    const calls = batch.tool_calls as Record<string, unknown>[]
    expect(calls[0]).toEqual({
      tool_name: 'Write',
      tool_use_id: 'tu_1',
      tool_input: { file_path: '/repo/lib/billing.ts' },
    })
    expect(readRedactedStats(batch, 'tool_calls.0.tool_input.content')).toEqual(
      { bytes: Buffer.byteLength(CODE), lines: 3, sha256: sha(CODE) }
    )
    expect(
      readRedactedStats(batch, 'tool_calls.0.tool_response')
    ).not.toBeNull()
    expect(calls[1]!.tool_input).toEqual({
      file_path: '/repo/__tests__/billing.test.ts',
      old_string: 'toBe(3)',
      new_string: 'toBe(4)',
    })
    expect(calls[2]).toBeNull()

    // Test files keep old/new — tampering crossings are judged on that diff.
    const testEdit = {
      tool_name: 'Edit',
      tool_input: {
        file_path: '/repo/__tests__/billing.test.ts',
        old_string: 'expect(total).toBe(3)',
        new_string: 'expect(total).toBeDefined()',
      },
      tool_response: {
        filePath: '/repo/__tests__/billing.test.ts',
        originalFile: CODE,
        structuredPatch: [{ lines: ['-a', '+b'] }],
      },
    }
    const kept = stripCodeFromHookPayload('POST_TOOL_USE', testEdit)
    expect(kept.tool_input).toEqual(testEdit.tool_input)
    expect(kept.tool_response).toEqual({
      filePath: '/repo/__tests__/billing.test.ts',
      structuredPatch: [{ lines: ['-a', '+b'] }],
    })
  })

  it('redaction drops tool output but keeps a capped failure error', () => {
    const read = stripCodeFromHookPayload('POST_TOOL_USE', {
      tool_name: 'Read',
      tool_input: { file_path: '/repo/lib/billing.ts' },
      tool_response: {
        type: 'text',
        file: { filePath: '/repo/lib/billing.ts', content: CODE, numLines: 3 },
      },
    })
    expect(read.tool_response).toEqual({
      type: 'text',
      file: { filePath: '/repo/lib/billing.ts', numLines: 3 },
    })
    expect(readRedactedStats(read, 'tool_response.file.content')?.lines).toBe(3)

    const bash = stripCodeFromHookPayload('POST_TOOL_USE', {
      tool_name: 'Bash',
      tool_input: { command: 'cat lib/billing.ts', description: 'show' },
      tool_response: { stdout: CODE, stderr: 'warn', interrupted: false },
    })
    expect(bash.tool_input).toEqual({
      command: 'cat lib/billing.ts',
      description: 'show',
    })
    expect(bash.tool_response).toEqual({ interrupted: false })
    expect(readRedactedStats(bash, 'tool_response.stderr')?.bytes).toBe(4)

    const grep = stripCodeFromHookPayload('POST_TOOL_USE', {
      tool_name: 'Grep',
      tool_input: { pattern: 'secret' },
      tool_response: { mode: 'content', content: CODE, numLines: 2 },
    })
    expect(grep.tool_response).toEqual({ mode: 'content', numLines: 2 })

    const glob = stripCodeFromHookPayload('POST_TOOL_USE', {
      tool_name: 'Glob',
      tool_input: { pattern: '**/*.ts' },
      tool_response: { filenames: ['a.ts', 'b.ts'], numFiles: 2 },
    })
    expect(glob.tool_response).toEqual({
      filenames: ['a.ts', 'b.ts'],
      numFiles: 2,
    })

    const fetched = stripCodeFromHookPayload('POST_TOOL_USE', {
      tool_name: 'WebFetch',
      tool_input: { url: 'https://x.dev', prompt: 'summarize' },
      tool_response: 'page body with code',
    })
    expect(fetched.tool_response).toBeUndefined()
    expect(readRedactedStats(fetched, 'tool_response')).not.toBeNull()

    const longError = 'E'.repeat(FAILURE_ERROR_CAP + 500)
    const failure = stripCodeFromHookPayload('POST_TOOL_USE_FAILURE', {
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      error: longError,
      tool_response: { stderr: longError, stdout: CODE },
    })
    expect(failure.error).toBe(longError.slice(0, FAILURE_ERROR_CAP))
    expect(failure.tool_response).toEqual({
      stderr: longError.slice(0, FAILURE_ERROR_CAP),
    })

    const bareFailure = stripCodeFromHookPayload('POST_TOOL_USE_FAILURE', {
      tool_name: 'Edit',
      tool_response: longError,
    })
    expect(bareFailure.tool_response).toBe(
      longError.slice(0, FAILURE_ERROR_CAP)
    )

    // Conversation fields are not repository content — untouched.
    const stop = stripCodeFromHookPayload('STOP', {
      last_assistant_message: 'done',
    })
    expect(stop).toEqual({ last_assistant_message: 'done' })
    expect(hasRedactedContent(stop)).toBe(false)
  })

  it('drops a client-supplied redaction marker and never mutates its input', () => {
    const input = {
      tool_name: 'Write',
      tool_input: { file_path: '/repo/a.ts', content: 'x' },
      [REDACTED_FIELD]: { forged: { bytes: 1 } },
    }
    const snapshot = JSON.parse(JSON.stringify(input))
    const out = stripCodeFromHookPayload('POST_TOOL_USE', input)
    expect(input).toEqual(snapshot)
    expect(Object.keys(out[REDACTED_FIELD] as object)).toEqual([
      'tool_input.content',
    ])
    const clean = stripCodeFromHookPayload('STOP', {
      [REDACTED_FIELD]: { x: 1 },
    })
    expect(clean).toEqual({})
  })
})

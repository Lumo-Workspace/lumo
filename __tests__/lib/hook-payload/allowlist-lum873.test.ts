/**
 * LUM-873 — in a used-up workspace the stored tool_input / tool_response keep
 * an ALLOWLIST (paths, URLs, patterns, enums, ids, numbers, booleans and a
 * Bash command summary); every other string is replaced by its stats. Also
 * LUM-938 (merged in): response metadata is kept and not counted as content.
 */
import { createHash } from 'crypto'
import {
  COMMAND_SUMMARY_CAP,
  FAILURE_ERROR_CAP,
  isCommandSummarized,
  readRedactedStats,
  stripCodeFromHookPayload,
  sumRedactedStats,
  summarizeCommand,
} from '@/lib/hook-payload/redact'

const CODE = 'export const secret = compute()\nconsole.info(secret)\n'
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

const HEREDOC = [
  "cat > lib/billing.ts <<'EOF'",
  'export const secret = compute()',
  'console.info(secret)',
  'EOF',
  'npx jest __tests__/billing.test.ts',
].join('\n')

describe('LUM-873 Bash command summary', () => {
  it('drops heredoc bodies, keeps intro and delimiter, records full stats', () => {
    const stored = stripCodeFromHookPayload('PRE_TOOL_USE', {
      tool_name: 'Bash',
      tool_input: {
        command: HEREDOC,
        description: 'write billing',
        timeout: 5,
      },
    })
    expect(stored.tool_input).toEqual({
      command: [
        "cat > lib/billing.ts <<'EOF'",
        '…',
        'EOF',
        'npx jest __tests__/billing.test.ts',
      ].join('\n'),
      description: 'write billing',
      timeout: 5,
    })
    expect(readRedactedStats(stored, 'tool_input.command')).toEqual({
      bytes: Buffer.byteLength(HEREDOC),
      lines: 5,
      sha256: sha(HEREDOC),
    })
    expect(isCommandSummarized(stored)).toBe(true)
    expect(JSON.stringify(stored)).not.toContain('compute()')
  })

  it('keeps a short command verbatim with no stats', () => {
    const stored = stripCodeFromHookPayload('PRE_TOOL_USE', {
      tool_name: 'Bash',
      tool_input: { command: 'git status && npm test' },
    })
    expect(stored.tool_input).toEqual({ command: 'git status && npm test' })
    expect(isCommandSummarized(stored)).toBe(false)
    expect(stored._lumo_redacted).toBeUndefined()
  })

  it('caps a long inline command and the summary is idempotent', () => {
    const long = `python -c "${'x = 1; '.repeat(200)}"`
    const summary = summarizeCommand(long)
    expect(summary.length).toBe(COMMAND_SUMMARY_CAP)
    expect(summary.endsWith('…')).toBe(true)
    expect(summarizeCommand(summary)).toBe(summary)
    expect(summarizeCommand(summarizeCommand(HEREDOC))).toBe(
      summarizeCommand(HEREDOC)
    )
    // an unterminated heredoc still loses its body; a here-string is not one
    expect(summarizeCommand('cat <<EOF\nbody line')).toBe('cat <<EOF\n…')
    expect(summarizeCommand('grep x <<<"$v"\nnext')).toBe(
      'grep x <<<"$v"\nnext'
    )
  })
})

describe('LUM-873 tool_input allowlist', () => {
  it('MCP and unknown tool fields are stripped by default and counted', () => {
    const stored = stripCodeFromHookPayload('POST_TOOL_USE', {
      tool_name: 'mcp__fs__edit_file',
      tool_input: {
        path: '/repo/lib/billing.ts',
        edits: [{ oldText: 'a = 1', newText: CODE }],
        patch: '--- a\n+++ b\n',
        body: 'pull request body',
        dryRun: false,
      },
    })
    expect(stored.tool_input).toEqual({
      path: '/repo/lib/billing.ts',
      edits: [{}],
      dryRun: false,
    })
    expect(readRedactedStats(stored, 'tool_input.edits.0.newText')).toEqual({
      bytes: Buffer.byteLength(CODE),
      lines: 3,
      sha256: sha(CODE),
    })
    expect(readRedactedStats(stored, 'tool_input.patch')).not.toBeNull()
    expect(readRedactedStats(stored, 'tool_input.body')).not.toBeNull()

    const applyPatch = stripCodeFromHookPayload('PRE_TOOL_USE', {
      tool_name: 'apply_patch',
      tool_input: { input: `*** Begin Patch\n${CODE}*** End Patch` },
    })
    expect(applyPatch.tool_input).toEqual({})
    expect(JSON.stringify(applyPatch)).not.toContain('compute()')
  })

  it('keeps paths, patterns, urls, enums, numbers and booleans', () => {
    const read = stripCodeFromHookPayload('PRE_TOOL_USE', {
      tool_name: 'Read',
      tool_input: { file_path: '/repo/a.ts', offset: 10, limit: 20 },
    })
    expect(read.tool_input).toEqual({
      file_path: '/repo/a.ts',
      offset: 10,
      limit: 20,
    })
    const grep = stripCodeFromHookPayload('PRE_TOOL_USE', {
      tool_name: 'Grep',
      tool_input: {
        pattern: 'compute\\(',
        path: '/repo/lib',
        glob: '*.ts',
        output_mode: 'content',
        '-n': true,
      },
    })
    expect(grep.tool_input).toEqual({
      pattern: 'compute\\(',
      path: '/repo/lib',
      glob: '*.ts',
      output_mode: 'content',
      '-n': true,
    })
    expect(grep._lumo_redacted).toBeUndefined()
  })

  it('conversation fields stay: Task prompt, WebFetch prompt and todo text', () => {
    const task = stripCodeFromHookPayload('PRE_TOOL_USE', {
      tool_name: 'Task',
      tool_input: {
        description: 'Explore billing',
        subagent_type: 'Explore',
        prompt: 'Find where LUM-13 charges',
      },
    })
    expect(task.tool_input).toEqual({
      description: 'Explore billing',
      subagent_type: 'Explore',
      prompt: 'Find where LUM-13 charges',
    })
    const fetched = stripCodeFromHookPayload('PRE_TOOL_USE', {
      tool_name: 'WebFetch',
      tool_input: { url: 'https://x.dev/doc', prompt: 'summarize' },
    })
    expect(fetched.tool_input).toEqual({
      url: 'https://x.dev/doc',
      prompt: 'summarize',
    })
    const todos = stripCodeFromHookPayload('PRE_TOOL_USE', {
      tool_name: 'TodoWrite',
      tool_input: {
        todos: [
          { id: '1', content: 'fix it', activeForm: 'Fixing', status: 'done' },
        ],
      },
    })
    expect(todos.tool_input).toEqual({
      todos: [
        { id: '1', content: 'fix it', activeForm: 'Fixing', status: 'done' },
      ],
    })
  })
})

describe('LUM-873 tool_response metadata', () => {
  it('Task response keeps status and agentId and counts only the content', () => {
    const text = 'line one\nline two\nline three'
    const stored = stripCodeFromHookPayload('POST_TOOL_USE', {
      tool_name: 'Task',
      tool_input: { description: 'd', prompt: 'p' },
      tool_response: {
        status: 'completed',
        agentId: 'abeaba01ea909a7ee',
        content: [{ type: 'text', text }],
        totalDurationMs: 5,
        usage: { input_tokens: 3, service_tier: 'standard' },
      },
    })
    expect(stored.tool_response).toEqual({
      status: 'completed',
      agentId: 'abeaba01ea909a7ee',
      content: [{ type: 'text' }],
      totalDurationMs: 5,
      usage: { input_tokens: 3, service_tier: 'standard' },
    })
    expect(sumRedactedStats(stored, 'tool_response')).toEqual({
      bytes: Buffer.byteLength(text),
      lines: 3,
    })
  })

  it('NotebookEdit response keeps notebook_path and cell metadata', () => {
    const stored = stripCodeFromHookPayload('POST_TOOL_USE', {
      tool_name: 'NotebookEdit',
      tool_input: {
        notebook_path: '/repo/n.ipynb',
        cell_id: 'c1',
        new_source: CODE,
        edit_mode: 'replace',
      },
      tool_response: {
        notebook_path: '/repo/n.ipynb',
        cell_id: 'c1',
        cell_type: 'code',
        language: 'python',
        edit_mode: 'replace',
        new_source: CODE,
        original_file: '{"cells":[]}',
      },
    })
    expect(stored.tool_input).toEqual({
      notebook_path: '/repo/n.ipynb',
      cell_id: 'c1',
      edit_mode: 'replace',
    })
    expect(stored.tool_response).toEqual({
      notebook_path: '/repo/n.ipynb',
      cell_id: 'c1',
      cell_type: 'code',
      language: 'python',
      edit_mode: 'replace',
    })
    expect(sumRedactedStats(stored, 'tool_response')).toEqual({
      bytes: Buffer.byteLength(CODE) + '{"cells":[]}'.length,
      lines: 4,
    })
  })

  it('WebFetch response keeps url, code and codeText, strips the result', () => {
    const stored = stripCodeFromHookPayload('POST_TOOL_USE', {
      tool_name: 'WebFetch',
      tool_input: { url: 'https://x.dev' },
      tool_response: {
        url: 'https://x.dev',
        code: 200,
        codeText: 'OK',
        result: CODE,
        bytes: 99,
      },
    })
    expect(stored.tool_response).toEqual({
      url: 'https://x.dev',
      code: 200,
      codeText: 'OK',
      bytes: 99,
    })
  })

  it('failure array strings are stripped, not kept as error text', () => {
    const items = Array.from({ length: 5 }, (_, i) => `${CODE} item ${i}`)
    const stored = stripCodeFromHookPayload('POST_TOOL_USE_FAILURE', {
      tool_name: 'mcp__x__run',
      tool_response: { error: 'E'.repeat(FAILURE_ERROR_CAP + 10), items },
    })
    expect(stored.tool_response).toEqual({
      error: 'E'.repeat(FAILURE_ERROR_CAP),
      items: [],
    })
    expect(JSON.stringify(stored)).not.toContain('compute()')
    expect(sumRedactedStats(stored, 'tool_response.items')?.lines).toBe(15)

    const bareArray = stripCodeFromHookPayload('POST_TOOL_USE_FAILURE', {
      tool_name: 'Edit',
      tool_response: [CODE, CODE],
    })
    expect(bareArray.tool_response).toEqual([])
  })
})

describe('LUM-873 test files under the tightened rule', () => {
  it('keeps tool_input only for real test files', () => {
    const edit = (file: string) =>
      stripCodeFromHookPayload('PRE_TOOL_USE', {
        tool_name: 'Edit',
        tool_input: { file_path: file, old_string: CODE, new_string: 'x' },
      }).tool_input as Record<string, unknown>
    expect(edit('/repo/pkg/billing_test.go').old_string).toBe(CODE)
    expect(edit('/repo/tests/test_billing.py').old_string).toBe(CODE)
    expect(edit('/repo/src/a.spec.ts').old_string).toBe(CODE)
    expect(edit('/repo/openapi.spec.yaml').old_string).toBeUndefined()
    expect(edit('/repo/.env.test.local').old_string).toBeUndefined()
    expect(edit('/repo/foo.test.config.js').old_string).toBeUndefined()
  })
})

/**
 * @jest-environment node
 *
 * LUM-1150 follow-up — a committable suggestion must not introduce a name
 * that is not in scope in its file. Production (probe PR 41): a HIGH
 * command-injection comment suggested `execFile(...)` in a file that only
 * imports `exec`; committing it as GitHub would broke compilation, and the
 * next review flagged the missing import as a HIGH bug. Such a suggestion is
 * dropped (the comment stays).
 */
import {
  validateCodeSuggestion,
  type ValidateCodeSuggestionInput,
} from '@/ee/security/security-scan/code-suggestion'
import { SecurityJudgeSchema } from '@/ee/security/llm/security-judge-client'

// The probe file exactly as it was at e10d2ce (a new file: every line added).
const PROBE = [
  '// probe (do not merge)',
  'export function parseCount(raw: string): number {',
  '  const n = parseInt(raw)',
  '  return n',
  '}',
  '',
  "import { exec } from 'child_process'",
  '',
  'export function listDir(dir: string): void {',
  "  exec('ls -la ' + dir)",
  '}',
]
const PROBE_FILES = [
  {
    path: 'src/probe/suggest.ts',
    lines: PROBE.map((text, i) => ({ lineNo: i + 1, text })),
  },
]

function probe(
  over: Partial<ValidateCodeSuggestionInput> = {}
): ValidateCodeSuggestionInput {
  return {
    suggestion: {
      startLine: 10,
      endLine: 10,
      code: "  execFile('ls', ['-la', '--', dir])",
    },
    line: 10,
    severity: 'HIGH',
    filePath: 'src/probe/suggest.ts',
    evidence: "exec('ls -la ' + dir)",
    files: PROBE_FILES,
    ...over,
  }
}

describe('LUM-1150 suggestions never introduce names out of scope', () => {
  it('drops the production case: execFile in a file that only imports exec', () => {
    expect(validateCodeSuggestion(probe())).toBeNull()
  })

  it('drops it too when the whole head file is known (fileText)', () => {
    expect(
      validateCodeSuggestion(probe({ fileText: PROBE.join('\n') }))
    ).toBeNull()
  })

  it('keeps a fix that brings its own import inside the replaced range', () => {
    const s = validateCodeSuggestion(
      probe({
        suggestion: {
          startLine: 7,
          endLine: 11,
          code: [
            "import { execFile } from 'child_process'",
            '',
            'export function listDir(dir: string): void {',
            "  execFile('ls', ['-la', '--', dir])",
            '}',
          ].join('\n'),
        },
      })
    )
    expect(s).toEqual(expect.objectContaining({ startLine: 7, endLine: 11 }))
  })

  it('keeps a fix that only uses what the file already imports', () => {
    const s = validateCodeSuggestion(
      probe({
        suggestion: {
          startLine: 10,
          endLine: 10,
          code: "  exec('ls -la -- ' + JSON.stringify(dir))",
        },
      })
    )
    expect(s).not.toBeNull()
  })

  it('accepts an import that sits outside the diff when the head file is known', () => {
    const fileText = [
      "import { execFile } from 'child_process'",
      ...PROBE,
    ].join('\n')
    // Only the listDir body is an added line in this PR.
    const files = [
      {
        path: 'src/probe/suggest.ts',
        lines: [{ lineNo: 11, text: "  exec('ls -la ' + dir)" }],
      },
    ]
    const input = probe({
      files,
      line: 11,
      suggestion: {
        startLine: 11,
        endLine: 11,
        code: "  execFile('ls', ['-la', '--', dir])",
      },
    })
    // Without the file the import is unknown: dropped, when unsure.
    expect(validateCodeSuggestion(input)).toBeNull()
    expect(validateCodeSuggestion({ ...input, fileText })).not.toBeNull()
  })

  it('keeps language built-ins (parseInt with a radix)', () => {
    const s = validateCodeSuggestion(
      probe({
        line: 3,
        evidence: 'const n = parseInt(raw)',
        suggestion: {
          startLine: 3,
          endLine: 3,
          code: '  const n = Number.parseInt(raw, 10)',
        },
      })
    )
    expect(s).not.toBeNull()
  })

  it('drops a module root that is never imported (fs.readdirSync)', () => {
    expect(
      validateCodeSuggestion(
        probe({
          suggestion: {
            startLine: 10,
            endLine: 10,
            code: '  fs.readdirSync(dir)',
          },
        })
      )
    ).toBeNull()
  })
})

describe('LUM-1150 the model is told to stay within existing imports', () => {
  it("says so in the suggestion field's description", () => {
    const finding = (
      SecurityJudgeSchema.shape.findings as unknown as {
        element: { shape: { suggestion: { description?: string } } }
      }
    ).element.shape.suggestion
    expect(finding.description).toMatch(/already imported or defined/)
  })
})

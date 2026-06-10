/**
 * LUM-413: result-layer five-class attribution + Winston root-cause
 * suggestions. Fixtures model real session shapes: status-walking chains,
 * ceremonial repeats, masked failures, sibling-misattributed errors.
 */
import {
  classifySession,
  clusteringStats,
  REDUNDANT_WINDOW_MS,
  type AttributionInput,
  type ResultClass,
} from '../attribute'
import { suggestRootCause } from '../rootcause'

let seq = 0
const at = (offsetMs: number) =>
  new Date(Date.UTC(2026, 5, 1, 10, 0, 0) + offsetMs).toISOString()

function rec(partial: Partial<AttributionInput>): AttributionInput {
  seq += 1
  return {
    eventId: `evt${seq}`,
    createdAt: at(seq * 1000),
    commandPath: 'task show',
    known: true,
    flags: [],
    target: 'LUM-1',
    raw: `lumo task show LUM-1`,
    errored: false,
    errorKind: null,
    evidence: null,
    stdoutChars: 1200,
    astVerdict: 'valid',
    astOffending: null,
    ...partial,
  }
}

beforeEach(() => {
  seq = 0
})

describe('five-class result layer', () => {
  it('assigns exactly one class to every record', () => {
    const records = [
      rec({}),
      rec({ astVerdict: 'unknown-flag', astOffending: '--verbose' }),
      rec({ errored: true, errorKind: 'cli-error', evidence: 'Error: boom' }),
    ]
    const out = classifySession(records)
    expect(out).toHaveLength(records.length)
    for (const o of out) {
      expect([
        'usage-error',
        'selection-error',
        'invalid-result',
        'valid-result',
        'redundant-valid',
      ]).toContain(o.resultClass)
    }
  })

  it('maps AST flag hallucination / illegal enum on failed runs to usage-error', () => {
    const out = classifySession([
      rec({
        astVerdict: 'unknown-flag',
        astOffending: '--verbose',
        errored: true,
        errorKind: 'usage-error',
        raw: 'lumo session attach LUM-43 --verbose',
      }),
      rec({
        astVerdict: 'illegal-enum',
        astOffending: 'DECISION',
        errored: true,
        errorKind: 'cli-error',
        raw: 'lumo task memory add LUM-352 --category DECISION x',
      }),
    ])
    expect(out.map(o => o.resultClass)).toEqual(['usage-error', 'usage-error'])
  })

  it('keeps structural violations that succeeded at run time out of the failure classes', () => {
    // Commander enforces no enum: `--source Superpowers` is illegal per help
    // text yet accepted — that is a doc-drift finding, not a usage error.
    const out = classifySession([
      rec({
        commandPath: 'task artifact add',
        astVerdict: 'illegal-enum',
        astOffending: 'Superpowers',
        raw: 'lumo task artifact add LUM-122 --kind spec --source Superpowers',
        stdoutChars: 240,
      }),
    ])
    expect(out[0]!.resultClass).toBe('valid-result')
  })

  it('maps a hallucinated subcommand to selection-error, a bare group to usage-error', () => {
    const out = classifySession([
      rec({
        commandPath: 'unknown:task delete',
        known: false,
        astVerdict: 'unknown-command',
        astOffending: 'delete',
        errored: true,
        errorKind: 'usage-error',
      }),
      rec({
        commandPath: 'unknown:task',
        known: false,
        astVerdict: 'unknown-command',
        astOffending: null,
        errored: true,
        errorKind: 'usage-error',
      }),
    ])
    expect(out[0]!.resultClass).toBe('selection-error')
    expect(out[1]!.resultClass).toBe('usage-error')
  })

  it('classifies runtime failures: commander usage vs validation vs tool-side', () => {
    const out = classifySession([
      rec({
        errored: true,
        errorKind: 'usage-error',
        evidence: "error: missing required argument 'title'",
      }),
      rec({
        errored: true,
        errorKind: 'cli-error',
        evidence: 'Error: Provide at least one of --title, --description',
      }),
      rec({
        errored: true,
        errorKind: 'cli-error',
        evidence: 'Error: Request failed with status 500',
      }),
      rec({ errored: true, errorKind: 'interrupted' }),
      rec({ errored: true, errorKind: 'not-found' }),
    ])
    expect(out.map(o => o.resultClass)).toEqual([
      'usage-error',
      'usage-error',
      'invalid-result',
      'invalid-result',
      'invalid-result',
    ])
  })

  it('detects masked failures: exit 0 with empty stdout, hook commands exempt', () => {
    const out = classifySession([
      rec({ stdoutChars: 0 }),
      rec({ commandPath: 'hook session-start', stdoutChars: 0, target: null }),
    ])
    expect(out[0]).toMatchObject({
      resultClass: 'invalid-result',
      maskedFailure: true,
    })
    expect(out[1]).toMatchObject({
      resultClass: 'valid-result',
      maskedFailure: false,
    })
  })
})

describe('fifth class: redundant/ceremonial valid calls', () => {
  const statusWrite = (status: string, offsetMs: number, target = 'LUM-7') =>
    rec({
      commandPath: 'task update',
      flags: ['--status'],
      target,
      raw: `lumo task update ${target} --status ${status}`,
      createdAt: at(offsetMs),
    })

  it('marks intermediate steps of a status walk redundant, the final one valid', () => {
    const out = classifySession([
      statusWrite('in_progress', 0),
      statusWrite('in_review', 60_000),
      statusWrite('done', 120_000),
    ])
    expect(out.map(o => o.resultClass)).toEqual([
      'redundant-valid',
      'redundant-valid',
      'valid-result',
    ])
    expect(out[0]!.reason).toBe('redundant:status-walk-superseded')
  })

  it('does not link status writes beyond the window or across targets', () => {
    const out = classifySession([
      statusWrite('in_progress', 0),
      statusWrite('done', REDUNDANT_WINDOW_MS + 60_000),
      statusWrite('in_progress', REDUNDANT_WINDOW_MS + 120_000, 'LUM-8'),
    ])
    expect(out.map(o => o.resultClass)).toEqual([
      'valid-result',
      'valid-result',
      'valid-result',
    ])
  })

  it('marks an identical successful repeat redundant (ceremonial re-read)', () => {
    const whoami = () =>
      rec({
        commandPath: 'whoami',
        target: null,
        raw: 'lumo whoami',
      })
    const out = classifySession([whoami(), whoami()])
    expect(out.map(o => o.resultClass)).toEqual([
      'valid-result',
      'redundant-valid',
    ])
    expect(out[1]!.reason).toBe('redundant:identical-repeat')
  })

  it('does not mark a repeat redundant when the first attempt failed', () => {
    const out = classifySession([
      rec({
        errored: true,
        errorKind: 'cli-error',
        evidence: 'Error: Request failed with status 500',
        raw: 'lumo task show LUM-1',
      }),
      rec({ raw: 'lumo task show LUM-1' }),
    ])
    expect(out.map(o => o.resultClass)).toEqual([
      'invalid-result',
      'valid-result',
    ])
  })

  it('treats different targets / different text as non-redundant', () => {
    const out = classifySession([
      rec({ raw: 'lumo task show LUM-1', target: 'LUM-1' }),
      rec({ raw: 'lumo task show LUM-2', target: 'LUM-2' }),
    ])
    expect(out.map(o => o.resultClass)).toEqual([
      'valid-result',
      'valid-result',
    ])
  })
})

describe('self-conditioning clustering stats', () => {
  const V: ResultClass = 'valid-result'
  const R: ResultClass = 'redundant-valid'

  it('reports late clustering when redundancy sits at session tails', () => {
    const stats = clusteringStats([
      [V, V, V, R, R],
      [V, V, V, V, R],
    ])
    expect(stats.sessions).toBe(2)
    expect(stats.redundantCalls).toBe(3)
    expect(stats.meanPosRedundant).toBeGreaterThan(0.7)
    expect(stats.lateHalfShareRedundant).toBe(1)
  })

  it('skips short sessions and handles the no-redundancy case', () => {
    const stats = clusteringStats([
      [V, R], // below minLength, ignored
      [V, V, V, V, V],
    ])
    expect(stats.sessions).toBe(1)
    expect(stats.redundantCalls).toBe(0)
    expect(stats.meanPosRedundant).toBeNull()
    expect(stats.lateHalfShareRedundant).toBeNull()
  })
})

describe('Winston root-cause suggestions', () => {
  it('routes a hallucinated flag to R2, or R5 when the docs mention it', () => {
    const base = {
      resultClass: 'usage-error' as const,
      reason: 'ast:unknown-flag "--verbose"',
      errorKind: 'usage-error',
      evidence: "error: unknown option '--verbose'",
      maskedFailure: false,
      astOffending: '--verbose',
    }
    expect(
      suggestRootCause({ ...base, offendingInSkillDocs: false })
    ).toMatchObject({ cause: 'R2_INPUT_CONSTRUCTION', confidence: 'auto' })
    expect(
      suggestRootCause({ ...base, offendingInSkillDocs: true })
    ).toMatchObject({ cause: 'R5_TOOLSET_DOCS', confidence: 'auto' })
  })

  it('routes selection errors to R1 (R5 when docs advertise the command)', () => {
    const base = {
      resultClass: 'selection-error' as const,
      reason: 'ast:unknown-command "delete"',
      errorKind: 'usage-error',
      evidence: "error: unknown command 'delete'",
      maskedFailure: false,
      astOffending: 'delete',
    }
    expect(
      suggestRootCause({ ...base, offendingInSkillDocs: false })?.cause
    ).toBe('R1_TOOL_SELECTION')
    expect(
      suggestRootCause({ ...base, offendingInSkillDocs: true })?.cause
    ).toBe('R5_TOOLSET_DOCS')
  })

  it('flags unhelpful tool errors as R6 with an R5 candidate note', () => {
    const s = suggestRootCause({
      resultClass: 'invalid-result',
      reason: 'output:cli-error',
      errorKind: 'cli-error',
      evidence: 'Error: Request failed',
      maskedFailure: false,
      astOffending: null,
      offendingInSkillDocs: false,
    })
    expect(s).toMatchObject({ cause: 'R6_TOOL_ERROR', confidence: 'needs-review' })
    expect(s!.rationale).toContain('R5 candidate')
  })

  it('returns null for valid, redundant and interrupted records (no component to fix)', () => {
    expect(
      suggestRootCause({
        resultClass: 'valid-result',
        reason: 'ok',
        errorKind: null,
        evidence: null,
        maskedFailure: false,
        astOffending: null,
        offendingInSkillDocs: false,
      })
    ).toBeNull()
    expect(
      suggestRootCause({
        resultClass: 'redundant-valid',
        reason: 'redundant:identical-repeat',
        errorKind: null,
        evidence: null,
        maskedFailure: false,
        astOffending: null,
        offendingInSkillDocs: false,
      })
    ).toBeNull()
    expect(
      suggestRootCause({
        resultClass: 'invalid-result',
        reason: 'output:interrupted',
        errorKind: 'interrupted',
        evidence: null,
        maskedFailure: false,
        astOffending: null,
        offendingInSkillDocs: false,
      })
    ).toBeNull()
  })

  it('never auto-suggests R4 (no constrained decoding on a shell CLI surface)', () => {
    const classes = ['usage-error', 'selection-error', 'invalid-result'] as const
    for (const resultClass of classes) {
      const s = suggestRootCause({
        resultClass,
        reason: 'x',
        errorKind: 'cli-error',
        evidence: 'Error: x',
        maskedFailure: false,
        astOffending: null,
        offendingInSkillDocs: false,
      })
      expect(s?.cause).not.toBe('R4_CONSTRAINED_DECODING')
    }
  })
})

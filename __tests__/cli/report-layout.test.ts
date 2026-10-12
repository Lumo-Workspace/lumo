/**
 * @jest-environment node
 *
 * LUM-1091 — the layout helpers of the CLI's long reports, and the
 * labelled-row form of the shared scan grammar.
 */
import {
  bulletLines,
  commandLine,
  fieldLines,
  labelWidth,
  reportWidth,
  sectionHeading,
  wrapLines,
} from '@/cli/src/lib/report-layout'
import {
  formatHuntCoverageLines,
  formatScanLayerTail,
  scanFields,
  scanLayerNotes,
  scanLayerRows,
  type ScanLayerLineInput,
} from '@/cli/src/lib/scan-format'

describe('report-layout', () => {
  it('reportWidth clamps the terminal width to 40–100 columns', () => {
    expect(reportWidth()).toBe(100)
    expect(reportWidth({ width: 240 })).toBe(100)
    expect(reportWidth({ width: 72 })).toBe(72)
    expect(reportWidth({ width: 10 })).toBe(40)
  })

  it('sectionHeading is a blank line plus the title, bold only when asked', () => {
    expect(sectionHeading('Cost')).toEqual(['', 'Cost'])
    expect(sectionHeading('Cost', { color: true })).toEqual([
      '',
      '\u001b[1mCost\u001b[22m',
    ])
  })

  it('wrapLines wraps prose at the width, every line at the indent', () => {
    const lines = wrapLines('aaa bbb ccc ddd', 2, { width: 40 })
    expect(lines).toEqual(['  aaa bbb ccc ddd'])
    const long = wrapLines('word '.repeat(30).trim(), 4, { width: 40 })
    expect(long.length).toBeGreaterThan(1)
    for (const l of long) {
      expect(l.startsWith('    ')).toBe(true)
      expect(l.length).toBeLessThanOrEqual(40)
    }
  })

  it('bulletLines hangs continuation lines under the text', () => {
    const lines = bulletLines('word '.repeat(20).trim(), 2, { width: 40 })
    expect(lines[0]!.startsWith('  • word')).toBe(true)
    for (const l of lines.slice(1)) expect(l.startsWith('    word')).toBe(true)
  })

  it('commandLine never wraps or styles a command', () => {
    const cmd = `lumo task update LUM-1 ${'--flag '.repeat(30)}`.trim()
    expect(commandLine(cmd, 4)).toBe(`    ${cmd}`)
  })

  it('fieldLines pads labels to one width and keeps short values inline', () => {
    expect(
      fieldLines(
        [
          { label: 'Rule', value: 'secret:x' },
          { label: 'Where', value: 'a.ts:1' },
        ],
        4
      )
    ).toEqual(['    Rule:   secret:x', '    Where:  a.ts:1'])
  })

  it('fieldLines moves a value that does not fit under its label, wrapped one level deeper', () => {
    const value = 'word '.repeat(30).trim()
    const lines = fieldLines([{ label: 'Detail', value }], 4, { width: 60 })
    expect(lines[0]).toBe('    Detail:')
    for (const l of lines.slice(1)) {
      expect(l.startsWith('      word')).toBe(true)
      expect(l.length).toBeLessThanOrEqual(60)
    }
    expect(lines.slice(1).join(' ').replace(/\s+/g, ' ').trim()).toBe(value)
  })

  it('fieldLines prints sub lines one level under the row, unwrapped', () => {
    expect(
      fieldLines([{ label: 'AI review', value: 'checked', sub: ['x y'] }], 2)
    ).toEqual(['  AI review:  checked', '    x y'])
  })

  it('fieldLines aligns to a shared labelWidth and dims labels only with colour on', () => {
    const a = [{ label: 'A', value: '1' }]
    const b = [{ label: 'Longer', value: '2' }]
    const w = labelWidth([...a, ...b])
    expect(fieldLines(a, 0, {}, w)).toEqual(['A:       1'])
    expect(fieldLines(b, 0, { color: true }, w)).toEqual([
      '\u001b[2mLonger:\u001b[22m  2',
    ])
  })
})

describe('scan-format labelled rows (LUM-1091)', () => {
  const base: ScanLayerLineInput = {
    status: 'FINDINGS',
    stages: {
      hunt: 'RAN',
      judge: 'RAN',
      secrets: 'RAN',
      external: 'FAILED',
      supplyChain: 'RAN',
    },
    partial: true,
    externalFindings: 2,
    dependencyFindings: 1,
    persistingFindings: 1,
    queueExits: { RESOLVED_ON_MAIN: 2 },
    externalFailureReason: 'gitleaks exit 2',
  }

  it('scanLayerRows: one row per present layer, stage order, same decorations as the line', () => {
    expect(scanLayerRows(base)).toEqual([
      { key: 'secrets', label: 'Secrets', value: 'checked' },
      {
        key: 'external',
        label: 'Code scan',
        value: "⚠ didn't finish (2 external findings)",
      },
      {
        key: 'supplyChain',
        label: 'Dependencies',
        value: 'checked (1 dependency finding, 1 already on main)',
      },
      { key: 'judge', label: 'AI review', value: 'checked' },
      { key: 'hunt', label: 'Exploit paths', value: 'checked' },
    ])
    expect(scanLayerNotes(base)).toEqual([
      "part of this scan hasn't finished on our side — not counted as checked",
      '2 left the queue (2 resolved on main)',
    ])
  })

  it('formatScanLayerTail still prints the one-line grammar it always did', () => {
    expect(formatScanLayerTail(base)).toBe(
      " · Secrets: checked · Code scan: ⚠ didn't finish (2 external findings) · Dependencies: checked (1 dependency finding, 1 already on main) · AI review: checked · Exploit paths: checked · part of this scan hasn't finished on our side — not counted as checked · 2 left the queue (2 resolved on main) — gitleaks exit 2"
    )
  })

  it('scanFields puts the reason on Code scan, the budget under AI review, notes last', () => {
    const fields = scanFields(base, {
      judgeBudget: null,
      truncated: true,
      hunt: {
        total: 1,
        done: 1,
        categories: [
          {
            category: 'idor',
            stopped: 'done',
            elapsedMs: 1000,
            tokens: 1,
            candidates: 0,
            attempts: 1,
          },
        ],
      },
    })
    expect(fields.map(f => f.label)).toEqual([
      'Secrets',
      'Code scan',
      'Dependencies',
      'AI review',
      'Exploit paths',
      'Note',
      'Queue',
    ])
    expect(fields[1]!.value).toBe(
      "⚠ didn't finish (2 external findings) — gitleaks exit 2"
    )
    expect(fields[3]!.sub).toEqual([
      'AI review has not covered every file yet',
      'AI review budget: not recorded on this scan',
    ])
    expect(fields[4]!.sub).toEqual([
      '1/1 planned tasks done',
      'idor  1.0s  done',
    ])
  })

  it('scanFields keeps a reason with no Code scan row, and the truncation note with no AI review row', () => {
    const fields = scanFields(
      { ...base, stages: { secrets: 'RAN' }, partial: false, queueExits: {} },
      { truncated: true }
    )
    expect(fields).toEqual([
      { label: 'Secrets', value: 'checked' },
      { label: 'Note', value: 'AI review has not covered every file yet' },
      { label: 'Scanner error', value: 'gitleaks exit 2' },
    ])
  })

  it('formatHuntCoverageLines: a done line plus an aligned row per task, id column only when ids exist', () => {
    expect(
      formatHuntCoverageLines({
        total: 2,
        done: 1,
        categories: [
          {
            taskId: 't1',
            category: 'idor',
            stopped: 'done',
            elapsedMs: 41200,
            tokens: 1,
            candidates: 0,
            attempts: 1,
          },
          {
            taskId: 't2',
            category: 'race',
            stopped: 'skipped',
            elapsedMs: 0,
            tokens: 0,
            candidates: 0,
            attempts: 3,
          },
        ],
      })
    ).toEqual([
      '1/2 planned tasks done',
      't1  idor  41.2s  done',
      't2  race         skipped (3 attempts)',
    ])
  })
})

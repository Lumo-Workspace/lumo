/**
 * @jest-environment node
 *
 * LUM-1104 — CLI milestone acceptance follow-ups:
 *  1. the TTY rendering of a confirmation envelope strips terminal control
 *     characters from member-writable text (a test-case title / note carrying
 *     ESC sequences could otherwise hide the "⚠ clears the DONE block" line);
 *     the non-TTY JSON stays byte-identical.
 *  2. `testcase list` keeps one tab-separated line per case even when a title
 *     carries `\n` / `\t`.
 *  3. `flexColumnCap` measures cells the way `renderTable` prints them (tabs
 *     become spaces), so a row with a tab still fits the terminal.
 */
import { buildEnvelope, renderConfirmation } from '@/cli/src/lib/confirmation'
import {
  describeDefectRead,
  describeDefectRuling,
  type DefectSubject,
} from '@/cli/src/lib/test-case-disposition'
import { flexColumnCap, renderListTable } from '@/cli/src/lib/list-table'
import { stringWidth } from '@/cli/src/lib/ui'

const ESC = '\x1b'
const CSI8 = '\x9b'

describe('disposition confirmation — TTY rendering is sanitized', () => {
  const subject: DefectSubject = {
    caseHandle: 'LUM-1/TC2',
    caseTitle: `Footer${ESC}[2K${ESC}[1A${CSI8}31m hidden`,
    runId: 'run_1',
    recordedAt: '2026-10-13T00:00:00Z',
    evidenceCount: 1,
  }
  const note = `looked${ESC}[8m and decided`

  it('read envelope: no ESC / C1 bytes reach the terminal, the warning survives', () => {
    const envelope = buildEnvelope({
      command: 'task testcase disposition',
      changes: describeDefectRead(subject, 'KNOWN_DEFECT', note),
      argv: ['task', 'testcase', 'disposition', 'LUM-1/TC2', '--known-defect'],
      confirmFlag: '--confirm-read',
    })
    const out = renderConfirmation(envelope, true)
    expect(out).not.toContain(ESC)
    expect(out).not.toContain(CSI8)
    expect(out).toContain('Footer[2K[1A31m hidden')
    expect(out).toContain('Note: looked[8m and decided')
    expect(out).toContain("⚠ Approving this clears that run's block on DONE.")
  })

  it('ruling envelope: no ESC / C1 bytes reach the terminal', () => {
    const envelope = buildEnvelope({
      command: 'task testcase disposition',
      changes: describeDefectRuling(subject, 'NOT_A_DEFECT', {
        readAt: 'a',
        readAcknowledgedAt: 'b',
        note,
      }),
      argv: ['task', 'testcase', 'disposition', 'LUM-1/TC2', '--not-a-defect'],
    })
    const out = renderConfirmation(envelope, true)
    expect(out).not.toContain(ESC)
    expect(out).not.toContain(CSI8)
    expect(out).toContain('⚠ This clears the DONE block for that run.')
  })

  it('a newline in the title cannot forge an extra change line', () => {
    const envelope = buildEnvelope({
      command: 'task testcase disposition',
      changes: describeDefectRead(
        { ...subject, caseTitle: 'T\n  - Ruling to record: nothing' },
        'KNOWN_DEFECT'
      ),
      argv: ['task', 'testcase', 'disposition', 'LUM-1/TC2', '--known-defect'],
    })
    const out = renderConfirmation(envelope, true)
    const bullets = out.split('\n').filter(l => l.startsWith('  - '))
    expect(bullets).toHaveLength(4)
  })

  it('non-TTY JSON is unchanged: changes carry the raw text', () => {
    const envelope = buildEnvelope({
      command: 'task testcase disposition',
      changes: describeDefectRead(subject, 'KNOWN_DEFECT', note),
      argv: ['task', 'testcase', 'disposition', 'LUM-1/TC2', '--known-defect'],
    })
    const out = renderConfirmation(envelope, false)
    expect(out).toBe(JSON.stringify(envelope, null, 2) + '\n')
    expect(JSON.parse(out).changes[0]).toContain(subject.caseTitle)
  })
})

describe('flexColumnCap — tabs are measured as printed', () => {
  it('a tab in a fixed column counts as one column', () => {
    // renderTable prints 'a\tb' as 'a b' (3 columns), so the flex cap must
    // leave room for 3, not for stringWidth('a\tb') = 2.
    expect(flexColumnCap([['a\tb', 'y']], 1, 40)).toBe(40 - 3 - 2)
  })

  it('TTY: a row whose non-flex column carries tabs fits the terminal', () => {
    const rows = [['id\t\t\t\t\t\t\t\t\t\t1', 'T'.repeat(200)]]
    const out = renderListTable(rows, {
      header: ['ID', 'TITLE'],
      flex: 1,
      tty: true,
      width: 60,
      color: false,
    })
    for (const line of out.split('\n')) {
      expect(stringWidth(line)).toBeLessThanOrEqual(60)
    }
  })
})

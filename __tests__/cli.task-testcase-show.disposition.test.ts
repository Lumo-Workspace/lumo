/** @jest-environment node */
/**
 * LUM-812: `lumo task testcase show` 的裁定行。
 *
 * LUM-812/TC1 复验 1 在生产上挂在这里：API 早就发了 `runs[].disposition`，
 * CLI 从来不读，已裁定的 run 看起来和没裁定的一模一样。
 */
import { formatDispositionLine } from '@/cli/src/lib/test-case-disposition'

/** 故意不写字面转义：源文件里不留控制符（仓库红线）。 */
const ESC = String.fromCharCode(27)

const ruled = {
  id: 'd-1',
  disposition: 'KNOWN_DEFECT',
  note: 'tracked in LUM-900',
  channel: 'CLI',
  dispositionedAt: '2026-09-23T07:19:49.778Z',
}

describe('formatDispositionLine', () => {
  it('names the ruling, the channel it came through and the day', () => {
    expect(formatDispositionLine(ruled)).toBe(
      '      ✓ ruled KNOWN_DEFECT via CLI 2026-09-23  — tracked in LUM-900'
    )
    expect(
      formatDispositionLine({
        ...ruled,
        disposition: 'NOT_A_DEFECT',
        channel: 'WEB',
        note: null,
      })
    ).toBe('      ✓ ruled NOT_A_DEFECT via WEB 2026-09-23')
  })

  it('prints nothing for an unruled run, an old server, or a shape it does not know', () => {
    for (const value of [
      null,
      undefined,
      {},
      'KNOWN_DEFECT',
      { disposition: 'MAYBE' },
    ])
      expect(formatDispositionLine(value)).toBeNull()
  })

  it('strips terminal control characters out of the note', () => {
    const line = formatDispositionLine({ ...ruled, note: `a${ESC}[31mb` })
    expect(line).not.toContain(ESC)
  })
})

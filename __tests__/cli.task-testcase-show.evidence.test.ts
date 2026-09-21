/** @jest-environment node */
/**
 * LUM-805: `lumo task testcase show` 的证据行。
 *
 * 之前这里只打 `[2 evidence]` —— 在终端里那等于打不开。这组测试钉住的就是
 * 「每条证据都带着自己的 url 出现」，外加两条终端安全的边界。
 */
import { formatEvidenceLines } from '@/cli/src/lib/test-case-evidence'

const SHOT = 'https://blob.example.com/test-evidence/t/c/abc.png'
const LOG = 'https://blob.example.com/test-evidence/t/c/def.log'

/** 故意不写字面转义：源文件里不留控制符（仓库红线）。 */
const ESC = String.fromCharCode(27)
const NEWLINE = String.fromCharCode(10)

const screenshot = {
  type: 'file',
  url: SHOT,
  filename: 'footer.png',
  contentType: 'image/png',
  size: 1234,
}

const logFile = {
  type: 'file',
  url: LOG,
  filename: 'jest.log',
  contentType: 'text/plain',
  size: 99,
}

describe('formatEvidenceLines', () => {
  it('prints one line per evidence entry with filename and url', () => {
    const lines = formatEvidenceLines([screenshot, logFile])

    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('footer.png')
    expect(lines[0]).toContain(SHOT)
    expect(lines[1]).toContain('jest.log')
    expect(lines[1]).toContain(LOG)
    // 缩进跟着 run 行走，读起来是挂在那条 run 底下的。
    for (const line of lines) expect(line.startsWith('      ')).toBe(true)
  })

  it('prints a labelled link once, not label plus identical url', () => {
    expect(
      formatEvidenceLines([
        { type: 'link', url: 'https://ci.example.com/7', label: 'CI run' },
      ])
    ).toEqual(['      CI run  https://ci.example.com/7'])

    expect(
      formatEvidenceLines([{ type: 'link', url: 'https://ci.example.com/7' }])
    ).toEqual(['      https://ci.example.com/7'])
  })

  it('prints nothing for a run with no usable evidence', () => {
    for (const value of [
      null,
      undefined,
      [],
      {},
      'nope',
      ['junk', { type: 'x' }],
    ])
      expect(formatEvidenceLines(value)).toEqual([])
  })

  it('strips terminal control characters out of an uploaded filename', () => {
    const line = formatEvidenceLines([
      { ...screenshot, filename: `foo${ESC}[31mter.png` },
    ])[0]

    expect(line).not.toContain(ESC)
    expect(line).toContain('foo[31mter.png')
  })

  it('keeps one entry on one line even if the filename carries a newline', () => {
    const lines = formatEvidenceLines([
      { ...screenshot, filename: `foo${NEWLINE}ter.png` },
    ])

    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain(NEWLINE)
    expect(lines[0]).toContain('foo ter.png')
  })
})

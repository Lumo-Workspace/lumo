import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')

describe('radius tokens (LUM-261)', () => {
  it('--radius base is the 0.625rem default (LUM-1251)', () => {
    expect(css).toMatch(/--radius:\s*0\.625rem;/)
  })

  // Default derivation: sm=-4px(6px), md=-2px(8px), lg=base(10px), xl=+4px(14px)
  it('--radius-sm = calc(var(--radius) - 4px)', () => {
    expect(css).toMatch(/--radius-sm:\s*calc\(var\(--radius\)\s*-\s*4px\);/)
  })
  it('--radius-md = calc(var(--radius) - 2px)', () => {
    expect(css).toMatch(/--radius-md:\s*calc\(var\(--radius\)\s*-\s*2px\);/)
  })
  it('--radius-lg = var(--radius)', () => {
    expect(css).toMatch(/--radius-lg:\s*var\(--radius\);/)
  })
  it('--radius-xl = calc(var(--radius) + 4px)', () => {
    expect(css).toMatch(/--radius-xl:\s*calc\(var\(--radius\)\s*\+\s*4px\);/)
  })
})

describe('elevation tokens (LUM-261)', () => {
  const defs = (name: string) =>
    [...css.matchAll(new RegExp(`--${name}:\\s*([^;]+);`, 'g'))].map(m =>
      (m[1] ?? '').trim()
    )

  it.each(['elevation-1', 'elevation-2', 'elevation-3'])(
    '--%s is defined in both :root and .dark',
    name => {
      expect(defs(name).length).toBe(2)
    }
  )

  it('dark elevations are stronger (higher max alpha) than light', () => {
    const maxAlpha = (v: string) =>
      Math.max(
        ...[...v.matchAll(/rgb\(0 0 0 \/ ([\d.]+)\)/g)].map(m =>
          parseFloat(m[1] ?? '0')
        )
      )
    for (const name of ['elevation-1', 'elevation-2', 'elevation-3']) {
      const [light, dark] = defs(name)
      expect(maxAlpha(dark ?? '')).toBeGreaterThan(maxAlpha(light ?? ''))
    }
  })

  it('--elevation-1 is a single hairline layer (LUM-1241)', () => {
    const [light, dark] = defs('elevation-1')
    expect(light).toBe('0 1px 2px 0 rgb(0 0 0 / 0.05)')
    expect(dark).toBe('0 1px 2px 0 rgb(0 0 0 / 0.3)')
  })

  it.each(['1', '2', '3'])(
    '@theme registers --shadow-elevation-%s -> utility',
    n => {
      expect(css).toMatch(
        new RegExp(`--shadow-elevation-${n}:\\s*var\\(--elevation-${n}\\);`)
      )
    }
  )
})

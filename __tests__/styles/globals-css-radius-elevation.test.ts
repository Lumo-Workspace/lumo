import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')

describe('radius tokens (LUM-261)', () => {
  it('--radius base stays 0.75rem', () => {
    expect(css).toMatch(/--radius:\s*0\.75rem;/)
  })

  // 4px steps: sm=-8px(0.25), md=-4px(0.5), lg=base(0.75), xl=+4px(1)
  it('--radius-sm = calc(var(--radius) - 8px)', () => {
    expect(css).toMatch(/--radius-sm:\s*calc\(var\(--radius\)\s*-\s*8px\);/)
  })
  it('--radius-md = calc(var(--radius) - 4px)', () => {
    expect(css).toMatch(/--radius-md:\s*calc\(var\(--radius\)\s*-\s*4px\);/)
  })
  it('--radius-lg = var(--radius)', () => {
    expect(css).toMatch(/--radius-lg:\s*var\(--radius\);/)
  })
  it('--radius-xl = calc(var(--radius) + 4px)', () => {
    expect(css).toMatch(/--radius-xl:\s*calc\(var\(--radius\)\s*\+\s*4px\);/)
  })
})

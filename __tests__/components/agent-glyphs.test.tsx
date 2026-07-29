/** @jest-environment jsdom */

/**
 * Fidelity guard for the brand glyphs inlined in LUM-715.
 *
 * The `sha` values below are the SHA-256 (first 16 hex chars) of each glyph's
 * `path d` attribute, extracted from the LobeHub icons originals *before* the
 * dependency was dropped. They are a fixed, absolute baseline — not a
 * self-comparison against a moving ref — so any character-level drift in the
 * path data (a bad copy, an accidental edit) fails this test.
 */
import { createHash } from 'crypto'
import { render } from '@testing-library/react'
import {
  ClaudeMono,
  CodexMono,
  CursorMono,
  GeminiMono,
  GithubCopilotMono,
  WindsurfMono,
  type AgentGlyphProps,
} from '@/components/icons/agent-glyphs'
import type { ComponentType } from 'react'

interface GlyphCase {
  name: string
  Glyph: ComponentType<AgentGlyphProps>
  /** <title> text, kept identical to upstream */
  title: string
  /** sha256(path.d).slice(0, 16), frozen from the LobeHub original */
  sha: string
  /** upstream emitted clipRule="evenodd" on the path for these two */
  clipRule: boolean
}

const CASES: GlyphCase[] = [
  {
    name: 'Claude',
    Glyph: ClaudeMono,
    title: 'Claude',
    sha: '7c9c195500ec3cae',
    clipRule: false,
  },
  {
    name: 'Codex',
    Glyph: CodexMono,
    title: 'Codex',
    sha: '667c7f51889219b6',
    clipRule: true,
  },
  {
    name: 'Cursor',
    Glyph: CursorMono,
    title: 'Cursor',
    sha: 'cdd5e1bfb853a055',
    clipRule: false,
  },
  {
    name: 'Gemini',
    Glyph: GeminiMono,
    title: 'Gemini',
    sha: '3cdeb9521c4294cb',
    clipRule: false,
  },
  {
    name: 'GithubCopilot',
    Glyph: GithubCopilotMono,
    title: 'GithubCopilot',
    sha: 'dd74f7f7ea818ba4',
    clipRule: false,
  },
  {
    name: 'Windsurf',
    Glyph: WindsurfMono,
    title: 'Windsurf',
    sha: '760c5fcc74c9bfcb',
    clipRule: true,
  },
]

function renderGlyph(
  Glyph: ComponentType<AgentGlyphProps>,
  props?: AgentGlyphProps
) {
  const { container } = render(<Glyph {...props} />)
  const svg = container.querySelector('svg')
  if (!svg) throw new Error('glyph rendered no <svg>')
  const path = svg.querySelector('path')
  if (!path) throw new Error('glyph rendered no <path>')
  return { svg, path }
}

describe('agent brand glyphs', () => {
  describe.each(CASES)('$name', ({ Glyph, title, sha, clipRule }) => {
    it('path data matches the frozen upstream fingerprint', () => {
      const { path } = renderGlyph(Glyph)
      const d = path.getAttribute('d') ?? ''
      expect(d).not.toBe('')
      expect(createHash('sha256').update(d).digest('hex').slice(0, 16)).toBe(
        sha
      )
    })

    it('keeps the 24x24 currentColor contract', () => {
      const { svg } = renderGlyph(Glyph)
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
      expect(svg.getAttribute('fill')).toBe('currentColor')
      expect(svg.getAttribute('fill-rule')).toBe('evenodd')
    })

    it('renders the accessible title', () => {
      const { svg } = renderGlyph(Glyph)
      expect(svg.querySelector('title')?.textContent).toBe(title)
    })

    it('carries clip-rule only where upstream did', () => {
      const { path } = renderGlyph(Glyph)
      expect(path.getAttribute('clip-rule')).toBe(clipRule ? 'evenodd' : null)
    })

    it('honors the size prop and defaults to 1em', () => {
      const { svg: sized } = renderGlyph(Glyph, { size: 12 })
      expect(sized.getAttribute('width')).toBe('12')
      expect(sized.getAttribute('height')).toBe('12')

      const { svg: dflt } = renderGlyph(Glyph)
      expect(dflt.getAttribute('width')).toBe('1em')
      expect(dflt.getAttribute('height')).toBe('1em')
    })
  })

  it('every glyph has distinct path data', () => {
    const ds = CASES.map(({ Glyph }) => {
      const { path } = renderGlyph(Glyph)
      return path.getAttribute('d')
    })
    expect(new Set(ds).size).toBe(CASES.length)
  })
})

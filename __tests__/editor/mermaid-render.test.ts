// __tests__/editor/mermaid-render.test.ts
// mermaid ships heavy untranspiled ESM (d3, etc.) that jest cannot load as
// CJS. We never want the real SDK in the test graph, so mock it. renderMermaid
// dynamic-imports 'mermaid', and jest.mock intercepts dynamic imports too.
const initialize = jest.fn()
const parse = jest.fn()
const render = jest.fn()

jest.mock('mermaid', () => ({
  __esModule: true,
  default: { initialize, parse, render },
}))

import { renderMermaid } from '@/lib/editor/mermaid-render'

beforeEach(() => {
  initialize.mockClear()
  parse.mockReset()
  render.mockReset()
})

describe('renderMermaid', () => {
  it('returns the SVG for valid source', async () => {
    parse.mockResolvedValue(true)
    render.mockResolvedValue({ svg: '<svg>ok</svg>' })

    const result = await renderMermaid('mermaid-1', 'graph TD\n A-->B', 'default')

    expect(result).toEqual({ ok: true, svg: '<svg>ok</svg>' })
    expect(render).toHaveBeenCalledWith('mermaid-1', 'graph TD\n A-->B')
  })

  it('returns the error message for invalid source (parse throws)', async () => {
    parse.mockRejectedValue(new Error('Parse error on line 2'))

    const result = await renderMermaid('mermaid-2', 'grraph TD', 'default')

    expect(result).toEqual({ ok: false, error: 'Parse error on line 2' })
    expect(render).not.toHaveBeenCalled()
  })

  it('initializes with strict security and the requested theme', async () => {
    parse.mockResolvedValue(true)
    render.mockResolvedValue({ svg: '<svg/>' })

    await renderMermaid('mermaid-3', 'graph TD\n A-->B', 'dark')

    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: 'strict', theme: 'dark', startOnLoad: false })
    )
  })

  it('re-initializes when the theme changes between calls', async () => {
    parse.mockResolvedValue(true)
    render.mockResolvedValue({ svg: '<svg/>' })

    await renderMermaid('a', 'graph TD\n A-->B', 'default')
    await renderMermaid('b', 'graph TD\n A-->B', 'default')
    await renderMermaid('c', 'graph TD\n A-->B', 'dark')

    // default (1st) → cached (2nd, no re-init) → dark (3rd, re-init) = 2 calls
    expect(initialize).toHaveBeenCalledTimes(2)
  })
})

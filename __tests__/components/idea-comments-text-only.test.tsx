/** @jest-environment jsdom */
/**
 * LUM-926 — idea comments are stored as plain text without write-time
 * sanitization (unlike task/document comments, LUM-921). That is only safe
 * while every render surface puts the body in a text node. These tests fail
 * the moment that stops being true, so an HTML rendering switch has to bring
 * write-time sanitization with it.
 */
import { readFileSync } from 'fs'
import path from 'path'
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
    formatDate: () => 'date',
  }),
}))

const PAYLOAD =
  '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script><a href="javascript:alert(1)">x</a>'

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useIdeaComments', () => ({
  useIdeaComments: () => ({
    comments: [
      {
        id: 'c1',
        body: PAYLOAD,
        createdAt: '2026-10-01T00:00:00.000Z',
      },
    ],
    loading: false,
    error: null,
    addComment: jest.fn(),
    posting: false,
  }),
}))

import { IdeaCommentsSection } from '@/app/workspace/[workspaceUrl]/components/IdeaCommentsSection'

const COMPONENTS = path.join(
  __dirname,
  '../../app/workspace/[workspaceUrl]/components'
)
const RENDER_SURFACES = ['IdeaCommentsSection.tsx', 'IdeaActivityTimeline.tsx']

describe('LUM-926 idea comments render as text only', () => {
  it('idea comment body with markup renders as literal text', () => {
    const { container } = render(<IdeaCommentsSection ideaId='i1' />)
    expect(screen.getByText(PAYLOAD)).toBeInTheDocument()
    expect(container.querySelector('img, script, a[href]')).toBeNull()
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()
  })

  it('idea comment render files have no HTML sink', () => {
    for (const file of RENDER_SURFACES) {
      const src = readFileSync(path.join(COMPONENTS, file), 'utf8')
        // the component docs mention the sink by name; only code counts
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      expect({
        file,
        sink:
          /dangerouslySetInnerHTML|innerHTML|RichHtml/.exec(src)?.[0] ?? null,
      }).toEqual({ file, sink: null })
    }
  })
})

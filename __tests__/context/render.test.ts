import { renderSlackContextSection } from '@/lib/context/render/slack'
import { renderWebLinkSection } from '@/lib/context/render/web-link'
import { renderFigmaSection } from '@/lib/context/render/figma'
import { renderArtifactSection } from '@/lib/context/render/artifact'
import { renderDocumentSection } from '@/lib/context/render/document'
import { renderCommentsSection } from '@/lib/context/render/comments'
import { renderPRSection } from '@/lib/context/render/pr'
import {
  renderPrReviewTodosSection,
  type ReviewTodoItem,
} from '@/lib/context/render/pr-review-todos'
import * as render from '@/lib/context/render'
import {
  slackCard,
  slackManifest,
  webLinkCard,
  webLinkManifest,
  figmaCard,
  figmaManifest,
  prCard,
  prManifest,
} from '@/lib/context/render'

describe('renderSlackContextSection', () => {
  it('shows summary + retrieval command, no inlined thread', () => {
    const out = renderSlackContextSection(
      [
        {
          id: 'clx_a',
          isThread: true,
          slackChannelName: 'design',
          permalink: 'https://x',
          snapshotAt: new Date('2026-05-28T10:12:00Z'),
          refreshError: null,
          summary: 'Decided to ship after review.',
          snapshot: {
            messages: [{ ts: '1', userId: 'U1', userName: 'A', text: 'hi' }],
          },
        },
      ] as any,
      'LUM-42'
    )
    expect(out).toContain('## Slack Context')
    expect(out).toContain('### [external:slack] #design')
    expect(out).toContain('Decided to ship after review.')
    expect(out).toContain('lumo task slack show LUM-42 clx_a')
    // full thread NOT inlined anymore
    expect(out).not.toContain('- **A**: hi')
  })

  it('falls back to first 3 messages when summary is empty', () => {
    const out = renderSlackContextSection(
      [
        {
          id: 'clx_b',
          isThread: true,
          slackChannelName: null,
          permalink: 'https://y',
          snapshotAt: new Date('2026-05-28T10:12:00Z'),
          refreshError: null,
          summary: null,
          snapshot: {
            messages: [
              { ts: '1', userId: 'U1', userName: 'A', text: 'one' },
              { ts: '2', userId: 'U2', userName: 'B', text: 'two' },
              { ts: '3', userId: 'U3', userName: 'C', text: 'three' },
              { ts: '4', userId: 'U4', userName: 'D', text: 'four' },
            ],
          },
        },
      ] as any,
      'LUM-42'
    )
    expect(out).toContain('#channel')
    expect(out).toContain('A: one')
    expect(out).toContain('C: three')
    // 4th message dropped (only first 3 in fallback)
    expect(out).not.toContain('D: four')
    // command still printed
    expect(out).toContain('lumo task slack show LUM-42 clx_b')
  })

  it('returns empty string for empty set', () => {
    expect(renderSlackContextSection([] as any, 'LUM-42')).toBe('')
  })
})

describe('renderWebLinkSection', () => {
  it('keeps OG title/desc and appends retrieval command', () => {
    const out = renderWebLinkSection(
      [
        {
          id: 'wl_1',
          url: 'https://example.com/post',
          domain: 'example.com',
          title: 'A Post',
          description: 'the gist',
          note: null,
          fetchedAt: new Date(),
          fetchError: null,
        },
      ] as any,
      'LUM-42'
    )
    expect(out).toContain('## Web Links')
    expect(out).toContain('[A Post](https://example.com/post) — example.com')
    expect(out).toContain('> the gist')
    expect(out).toContain('lumo task web show LUM-42 wl_1')
  })

  it('renders body line from note, preferring it over description', () => {
    const out = renderWebLinkSection(
      [
        {
          id: 'wl_note',
          url: 'https://example.com/n',
          domain: 'example.com',
          title: 'Noted',
          description: 'og description',
          note: 'my own note',
          fetchedAt: new Date(),
          fetchError: null,
        },
      ] as any,
      'LUM-42'
    )
    expect(out).toContain('> my own note')
    // note wins over the OG description
    expect(out).not.toContain('og description')
  })

  it('falls back to bare url + no-preview marker when title is missing', () => {
    const out = renderWebLinkSection(
      [
        {
          id: 'wl_bare',
          url: 'https://example.com/raw',
          domain: 'example.com',
          title: null,
          description: null,
          note: null,
          fetchedAt: null,
          fetchError: 'fetch failed',
        },
      ] as any,
      'LUM-42'
    )
    // no markdown title link, just the raw url + domain
    expect(out).toContain(
      '- [external:web] https://example.com/raw — example.com'
    )
    expect(out).not.toContain('](https://example.com/raw)')
    // unfetched link gets the no-preview hint
    expect(out).toContain('_(no preview available)_')
    // no body line when there is neither note nor description
    expect(out).not.toContain('  > ')
    // retrieval command still printed
    expect(out).toContain('lumo task web show LUM-42 wl_bare')
  })

  it('omits the no-preview marker once the page has been fetched', () => {
    const out = renderWebLinkSection(
      [
        {
          id: 'wl_fetched',
          url: 'https://example.com/ok',
          domain: 'example.com',
          title: null,
          description: null,
          note: null,
          fetchedAt: new Date(),
          fetchError: null,
        },
      ] as any,
      'LUM-42'
    )
    expect(out).toContain(
      '- [external:web] https://example.com/ok — example.com'
    )
    expect(out).not.toContain('_(no preview available)_')
  })

  it('renders every link in a multi-link set', () => {
    const out = renderWebLinkSection(
      [
        {
          id: 'wl_a',
          url: 'https://a.com/1',
          domain: 'a.com',
          title: 'First',
          description: 'first desc',
          note: null,
          fetchedAt: new Date(),
          fetchError: null,
        },
        {
          id: 'wl_b',
          url: 'https://b.com/2',
          domain: 'b.com',
          title: 'Second',
          description: null,
          note: null,
          fetchedAt: new Date(),
          fetchError: null,
        },
      ] as any,
      'LUM-42'
    )
    expect(out).toContain('[First](https://a.com/1) — a.com')
    expect(out).toContain('[Second](https://b.com/2) — b.com')
    expect(out).toContain('lumo task web show LUM-42 wl_a')
    expect(out).toContain('lumo task web show LUM-42 wl_b')
  })

  it('returns empty string for empty set', () => {
    expect(renderWebLinkSection([] as any, 'LUM-42')).toBe('')
  })
})

describe('renderFigmaSection', () => {
  it('keeps metadata and appends design-context command', () => {
    const out = renderFigmaSection(
      [
        {
          id: 'fg_1',
          url: 'https://figma.com/file/abc',
          fileName: 'Designs',
          frameName: 'Home',
          thumbnailUrl: 'https://t/x.png',
          thumbnailFetchedAt: new Date(),
          lastSyncedAt: new Date('2026-05-20T00:00:00Z'),
          lastSyncError: null,
        },
      ] as any,
      'LUM-42'
    )
    expect(out).toContain('## Figma Designs')
    expect(out).toContain('Designs · Home')
    expect(out).toContain('lumo task figma context LUM-42 fg_1')
  })

  it('returns empty string for empty set', () => {
    expect(renderFigmaSection([] as any, 'LUM-42')).toBe('')
  })
})

describe('renderArtifactSection', () => {
  it('shows summary + retrieval command, no inlined content', () => {
    const out = renderArtifactSection(
      [
        {
          id: 'art_1',
          kind: 'SPEC',
          title: 'Auth Spec',
          content: 'line1\nline2\nline3',
          agent: 'CLAUDE_CODE',
          summary: 'Covers OAuth login.',
        },
      ] as any,
      'LUM-42'
    )
    expect(out).toContain('## [SPEC] Auth Spec · Claude Code')
    expect(out).toContain('Covers OAuth login.')
    expect(out).toContain('lumo task artifact show LUM-42 art_1')
    expect(out).not.toContain('line2')
  })

  it('falls back to first N content lines when summary empty', () => {
    const out = renderArtifactSection(
      [
        {
          id: 'art_2',
          kind: 'PLAN',
          title: 'Plan',
          content:
            'line-one\nline-two\nline-three\nline-four\nline-five\nline-six\nline-seven',
          agent: null,
          summary: null,
        },
      ] as any,
      'LUM-42'
    )
    expect(out).toContain('## [PLAN] Plan')
    expect(out).toContain('line-one')
    expect(out).toContain('line-five')
    // 6th+ line dropped (fallback caps at 5)
    expect(out).not.toContain('line-six')
    expect(out).toContain('lumo task artifact show LUM-42 art_2')
  })

  it('renders a known agent label and passes unknown agents through verbatim', () => {
    const out = renderArtifactSection(
      [
        {
          id: 'art_known',
          kind: 'SPEC',
          title: 'Known',
          content: 'x',
          agent: 'CURSOR',
          summary: 's',
        },
        {
          id: 'art_unknown',
          kind: 'NOTE',
          title: 'Unknown',
          content: 'y',
          agent: 'SOME_NEW_AGENT',
          summary: 's2',
        },
      ] as any,
      'LUM-42'
    )
    // known agent maps to its display label
    expect(out).toContain('## [SPEC] Known · Cursor')
    // unknown agent code is passed through as-is, not dropped
    expect(out).toContain('## [NOTE] Unknown · SOME_NEW_AGENT')
  })

  it('omits the agent suffix when no agent is set', () => {
    const out = renderArtifactSection(
      [
        {
          id: 'art_noagent',
          kind: 'PLAN',
          title: 'No Agent',
          content: 'c',
          agent: null,
          summary: 'sum',
        },
      ] as any,
      'LUM-42'
    )
    expect(out).toContain('## [PLAN] No Agent')
    expect(out).not.toContain('·')
    expect(out).toContain('sum')
  })

  it('renders every artifact in a multi-artifact set', () => {
    const out = renderArtifactSection(
      [
        {
          id: 'art_m1',
          kind: 'SPEC',
          title: 'One',
          content: 'a',
          agent: null,
          summary: 'sum one',
        },
        {
          id: 'art_m2',
          kind: 'PLAN',
          title: 'Two',
          content: 'b',
          agent: null,
          summary: 'sum two',
        },
      ] as any,
      'LUM-42'
    )
    expect(out).toContain('## [SPEC] One')
    expect(out).toContain('sum one')
    expect(out).toContain('lumo task artifact show LUM-42 art_m1')
    expect(out).toContain('## [PLAN] Two')
    expect(out).toContain('sum two')
    expect(out).toContain('lumo task artifact show LUM-42 art_m2')
  })

  it('returns empty string for empty set', () => {
    expect(renderArtifactSection([] as any, 'LUM-42')).toBe('')
  })
})

describe('renderDocumentSection', () => {
  it('renders a card per doc with summary + retrieval command', () => {
    const out = renderDocumentSection([
      { id: 'doc_1', title: 'Design Doc', summary: 'It decides X.' },
    ] as any)
    expect(out).toContain('## Documents')
    expect(out).toContain('### Design Doc')
    expect(out).toContain('It decides X.')
    expect(out).toContain('lumo doc show doc_1')
  })

  it('labels a doc mirrored from Feishu as external (LUM-1343)', () => {
    const out = renderDocumentSection([
      { id: 'doc_2', title: 'Spec', summary: null, external: 'feishu' },
      { id: 'doc_3', title: 'Native', summary: null },
    ])
    expect(out).toContain('### [external:feishu] Spec')
    expect(out).toContain('### Native')
  })

  it('returns empty string for empty set', () => {
    expect(renderDocumentSection([] as any)).toBe('')
  })
})

describe('renderCommentsSection', () => {
  it('inlines full text when <= 3', () => {
    const few = renderCommentsSection({
      comments: [{ author: 'A', createdAt: new Date(), body: 'c1' }],
      identifier: 'LUM-1',
      commentsSummary: null,
    })
    expect(few).toContain('## Comments')
    expect(few).toContain('c1')
    expect(few).not.toContain('lumo task comments list')
  })

  it('uses summary + retrieval command when > 3', () => {
    const many = renderCommentsSection({
      comments: new Array(4)
        .fill(0)
        .map((_, i) => ({ author: 'A', createdAt: new Date(), body: `c${i}` })),
      identifier: 'LUM-1',
      commentsSummary: 'Summary here',
    })
    expect(many).toContain('Summary here')
    expect(many).toContain('lumo task comments list LUM-1')
    // individual bodies not inlined when summarized
    expect(many).not.toContain('c3')
  })

  it('returns empty string for empty comments', () => {
    expect(
      renderCommentsSection({
        comments: [],
        identifier: 'LUM-1',
        commentsSummary: null,
      })
    ).toBe('')
  })
})

describe('renderPRSection', () => {
  it('renders a line per PR with diff retrieval command', () => {
    const out = renderPRSection(
      [
        {
          number: 42,
          title: 'Add login',
          state: 'open',
          ciStatus: 'success',
        },
      ] as any,
      'LUM-7'
    )
    expect(out).toContain('## Pull Requests')
    expect(out).toContain('#42 Add login — open')
    expect(out).toContain('success')
    expect(out).toContain('lumo task pr show LUM-7 42')
  })

  it('returns empty string for empty set', () => {
    expect(renderPRSection([] as any, 'LUM-7')).toBe('')
  })
})

describe('renderPrReviewTodosSection', () => {
  const lineTodo: ReviewTodoItem = {
    kind: 'line',
    prNumber: 7,
    filePath: 'lib/foo.ts',
    line: 42,
    text: 'Extract this into a helper',
    url: 'https://gh/c/1',
    author: 'octocat',
    reviewer: { trusted: true, role: 'collaborator' },
  }

  it('returns empty string when there are no todos', () => {
    expect(renderPrReviewTodosSection([])).toBe('')
  })

  it('renders a line-level todo as a checkbox with file:line, handle, and link', () => {
    const out = renderPrReviewTodosSection([lineTodo])
    expect(out).toContain('## PR review todos')
    expect(out).toContain(
      '- [ ] `lib/foo.ts:42` (@octocat · collaborator) — Extract this into a helper'
    )
    expect(out).toContain('  ↳ https://gh/c/1')
  })

  it('renders a changes-requested summary with the "Changes requested (whole PR)" marker', () => {
    const out = renderPrReviewTodosSection([
      {
        kind: 'overall',
        prNumber: 7,
        filePath: null,
        line: null,
        text: 'Please address the comments',
        url: 'https://gh/c/2',
        author: null,
        reviewer: { trusted: true, role: 'workspace_member' },
      },
    ])
    expect(out).toContain(
      '- [ ] 🛑 Changes requested (whole PR) (workspace member) — Please address the comments'
    )
    expect(out).not.toContain('(@')
  })

  it('omits the @handle when author is null', () => {
    const out = renderPrReviewTodosSection([{ ...lineTodo, author: null }])
    expect(out).toContain(
      '- [ ] `lib/foo.ts:42` (collaborator) — Extract this into a helper'
    )
    expect(out).not.toContain('(@')
  })

  it('prefixes each todo with [#N] only when the task spans multiple PRs', () => {
    const single = renderPrReviewTodosSection([lineTodo])
    expect(single).not.toContain('[#7]')

    const multi = renderPrReviewTodosSection([
      lineTodo,
      { ...lineTodo, prNumber: 9, url: 'https://gh/c/9' },
    ])
    expect(multi).toContain('[#7] `lib/foo.ts:42`')
    expect(multi).toContain('[#9] `lib/foo.ts:42`')
  })

  it('drops the trailing " — " when a todo has no body text', () => {
    const out = renderPrReviewTodosSection([{ ...lineTodo, text: '' }])
    expect(out).toContain('- [ ] `lib/foo.ts:42` (@octocat · collaborator)')
    expect(out).not.toContain('— \n')
    expect(out.split('\n')[4]).toBe(
      '- [ ] `lib/foo.ts:42` (@octocat · collaborator)'
    )
  })
})

describe('index barrel', () => {
  it('re-exports all 8 render functions', () => {
    expect(typeof render.renderSlackContextSection).toBe('function')
    expect(typeof render.renderWebLinkSection).toBe('function')
    expect(typeof render.renderFigmaSection).toBe('function')
    expect(typeof render.renderArtifactSection).toBe('function')
    expect(typeof render.renderDocumentSection).toBe('function')
    expect(typeof render.renderCommentsSection).toBe('function')
    expect(typeof render.renderPRSection).toBe('function')
    expect(typeof render.renderPrReviewTodosSection).toBe('function')
  })
})

describe('slackCard / slackManifest (LUM-147)', () => {
  const card = {
    id: 'ctx_1',
    isThread: true,
    slackChannelName: 'eng',
    permalink: 'https://slack/x',
    snapshotAt: new Date('2026-06-01T10:00:00Z'),
    refreshError: null,
    summary: 'Decided to ship Friday.',
    snapshot: { messages: [] },
  }

  it('slackCard renders one card body without the section heading', () => {
    const out = slackCard(card, 'LUM-42')
    expect(out).not.toContain('## Slack Context')
    expect(out).toContain(
      '### [external:slack] #eng · Thread (0 messages, fetched 2026-06-01 10:00 UTC)'
    )
    expect(out).toContain('Decided to ship Friday.')
    expect(out).toContain('↳ full text: lumo task slack show LUM-42 ctx_1')
  })

  it('slackManifest is one line with channel + summary snippet + retrieval command (LUM-500)', () => {
    expect(slackManifest(card, 'LUM-42')).toBe(
      '- [external:slack] #eng — Decided to ship Friday. → lumo task slack show LUM-42 ctx_1'
    )
  })

  it('slackManifest omits the snippet when there is no summary (LUM-500)', () => {
    expect(slackManifest({ ...card, summary: null }, 'LUM-42')).toBe(
      '- [external:slack] #eng → lumo task slack show LUM-42 ctx_1'
    )
  })

  it('slackManifest falls back to #channel when name is null', () => {
    expect(slackManifest({ ...card, slackChannelName: null }, 'LUM-42')).toBe(
      '- [external:slack] #channel — Decided to ship Friday. → lumo task slack show LUM-42 ctx_1'
    )
  })
})

describe('webLinkCard / webLinkManifest (LUM-147)', () => {
  const link = {
    id: 'wl_1',
    url: 'https://ex.com/a',
    domain: 'ex.com',
    title: 'A Title',
    description: 'desc',
    note: null,
    fetchedAt: new Date('2026-06-01T00:00:00Z'),
    fetchError: null,
  }

  it('webLinkCard renders the bullet block without the section heading', () => {
    const out = webLinkCard(link, 'LUM-42')
    expect(out).not.toContain('## Web Links')
    expect(out).toContain(
      '- [external:web] [A Title](https://ex.com/a) — ex.com'
    )
    expect(out).toContain('↳ body: lumo task web show LUM-42 wl_1')
  })

  it('webLinkManifest carries the title + host, falls back to url + host (LUM-500)', () => {
    expect(webLinkManifest(link, 'LUM-42')).toBe(
      '- [external:web] A Title — ex.com → lumo task web show LUM-42 wl_1'
    )
    expect(webLinkManifest({ ...link, title: null }, 'LUM-42')).toBe(
      '- [external:web] https://ex.com/a — ex.com → lumo task web show LUM-42 wl_1'
    )
  })
})

describe('figmaCard / figmaManifest (LUM-147)', () => {
  const link = {
    id: 'cfl_1',
    fileName: 'Onboarding',
    frameName: 'Welcome',
    url: 'https://figma/x',
    thumbnailUrl: 'https://img/x.png',
    lastSyncedAt: new Date('2026-06-01T00:00:00Z'),
    lastSyncError: null,
    thumbnailFetchedAt: new Date('2026-06-01T00:00:00Z'),
  } as unknown as import('@prisma/client').TaskFigmaLink

  it('figmaCard renders one link without the section heading', () => {
    const out = figmaCard(link, 'LUM-42')
    expect(out).not.toContain('## Figma Designs')
    expect(out).toContain('- [external:figma] **Onboarding · Welcome**')
    expect(out).toContain(
      '↳ design context: lumo task figma context LUM-42 cfl_1'
    )
  })

  it('figmaManifest is one line: file/frame name + retrieval command (LUM-500)', () => {
    expect(figmaManifest(link, 'LUM-42')).toBe(
      '- [external:figma] Onboarding · Welcome → lumo task figma context LUM-42 cfl_1'
    )
  })

  it('figmaManifest marks file-level links', () => {
    const fileLevel = { ...link, frameName: null } as typeof link
    expect(figmaManifest(fileLevel, 'LUM-42')).toBe(
      '- [external:figma] Onboarding _(file-level)_ → lumo task figma context LUM-42 cfl_1'
    )
  })
})

describe('prCard / prManifest (LUM-147)', () => {
  const pr = {
    number: 42,
    title: 'Fix bug',
    state: 'OPEN',
    ciStatus: 'passing',
  }

  it('prCard renders one PR without the section heading', () => {
    const out = prCard(pr, 'LUM-7')
    expect(out).not.toContain('## Pull Requests')
    expect(out).toContain('- [external:github] #42 Fix bug — OPEN · passing')
    expect(out).toContain('↳ diff: lumo task pr show LUM-7 42')
  })

  it('prManifest is one line: PR number + title + retrieval command (LUM-500)', () => {
    expect(prManifest(pr, 'LUM-42')).toBe(
      '- [external:github] #42 Fix bug → lumo task pr show LUM-42 42'
    )
  })
})

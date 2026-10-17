/** @jest-environment node */
/**
 * LUM-1230 (part 2): task-attached resources, documents and PR findings are
 * named by human-sized handles in CLI output — the 8-char short ref (cuid
 * tail) or the document slug — and those handles are accepted back as input,
 * with an ambiguous ref refused (candidates listed) rather than guessed.
 */
jest.mock('@/cli/src/lib/figma-api', () => ({
  listFigmaLinks: jest.fn(),
  removeFigmaLink: jest.fn(),
}))

import { formatArtifactList } from '@/cli/src/commands/task-artifact-list'
import { describeArtifactRm } from '@/cli/src/commands/task-artifact-rm'
import { formatFigmaList } from '@/cli/src/commands/task-figma-list'
import { taskFigmaRm } from '@/cli/src/commands/task-figma-rm'
import { listFigmaLinks, removeFigmaLink } from '@/cli/src/lib/figma-api'
import { formatDocListRows } from '@/cli/src/commands/doc-list'
import { resolveDoc } from '@/cli/src/lib/resolve-doc'
import { lookupDocId } from '@/cli/src/lib/resolve-doc-id'
import { docHandle } from '@/cli/src/lib/doc-handle'
import { pickFindings } from '@/cli/src/commands/finding-disposition'
import { buildRemediation } from '@/cli/src/lib/blocked-error'
import { renderArtifactSection } from '@/lib/context/render/artifact'
import { webLinkCard } from '@/lib/context/render/web-link'
import { figmaCard } from '@/lib/context/render/figma'
import { renderDocumentSection } from '@/lib/context/render/document'

const A = 'cmva568gc00l506jvpskvl3sh'
const B = 'cmva568fw00l106jv6z9j2q6d'

afterEach(() => jest.restoreAllMocks())

describe('artifacts', () => {
  const row = {
    id: A,
    kind: 'spec',
    title: 'Spec',
    source: 'Superpowers',
    agent: 'CLAUDE_CODE',
    order: 0,
  }
  it('artifact list prints the short ref in column 1, never the cuid', () => {
    const out = formatArtifactList([row] as never, { tty: false, color: false })
    expect(out.startsWith('pskvl3sh  ')).toBe(true)
    expect(out).not.toContain(A)
  })
  it('the rm envelope names the artifact by short ref', () => {
    const lines = describeArtifactRm('LUM-9', {
      id: A,
      title: 'Spec',
      kind: 'spec',
    } as never)
    expect(lines[0]).toBe(
      'Will delete artifact pskvl3sh "Spec" (spec) from LUM-9'
    )
  })
  it('task context hint uses the short ref', () => {
    const out = renderArtifactSection(
      [
        {
          id: A,
          kind: 'spec',
          title: 'Spec',
          summary: 's',
          content: 'c',
          agent: null,
        } as never,
      ],
      'LUM-9'
    )
    expect(out).toContain('lumo task artifact show LUM-9 pskvl3sh')
    expect(out).not.toContain(A)
  })
})

describe('web / Figma links', () => {
  it('web link hint uses the short ref', () => {
    const out = webLinkCard(
      {
        id: A,
        url: 'https://example.com',
        domain: 'example.com',
        title: 'Example',
        description: null,
        note: null,
        fetchedAt: new Date(),
      } as never,
      'LUM-9'
    )
    expect(out).toContain('lumo task web show LUM-9 pskvl3sh')
    expect(out).not.toContain(A)
  })

  const link = (id: string) => ({
    id,
    url: `https://www.figma.com/file/${id}`,
    fileKey: 'k',
    nodeId: '',
    fileName: 'Onboarding',
    frameName: null,
    thumbnailUrl: null,
    thumbnailFetchedAt: null,
    lastSyncedAt: '2026-10-01T00:00:00Z',
    lastSyncError: null,
    createdAt: '2026-10-01T00:00:00Z',
  })

  it('Figma context hint and figma list use the short ref', () => {
    expect(
      figmaCard(
        { ...link(A), lastSyncedAt: new Date('2026-10-01') } as never,
        'LUM-9'
      )
    ).toContain('lumo task figma context LUM-9 pskvl3sh')
    const list = formatFigmaList([link(A)] as never, Date.parse('2026-10-02'), {
      tty: false,
      color: false,
    })
    expect(list.startsWith('pskvl3sh')).toBe(true)
    expect(list).not.toContain(A)
  })

  it('figma rm accepts the short ref (and still the full id)', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {})
    ;(listFigmaLinks as jest.Mock).mockResolvedValue({
      links: [link(A), link(B)],
    })
    expect(
      await taskFigmaRm({ identifier: 'LUM-9', linkIdOrUrl: '6z9j2q6d' })
    ).toBe(0)
    expect(removeFigmaLink).toHaveBeenLastCalledWith('LUM-9', B)
    expect(await taskFigmaRm({ identifier: 'LUM-9', linkIdOrUrl: A })).toBe(0)
    expect(removeFigmaLink).toHaveBeenLastCalledWith('LUM-9', A)
  })

  it('figma rm refuses an ambiguous prefix and removes nothing', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    ;(removeFigmaLink as jest.Mock).mockClear()
    ;(listFigmaLinks as jest.Mock).mockResolvedValue({
      links: [link(A), link(B)],
    })
    expect(
      await taskFigmaRm({ identifier: 'LUM-9', linkIdOrUrl: 'cmva568' })
    ).toBe(1)
    expect(removeFigmaLink).not.toHaveBeenCalled()
    expect(String(err.mock.calls[0]![0])).toContain(A)
    expect(String(err.mock.calls[0]![0])).toContain(B)
  })
})

describe('documents', () => {
  const docs = [
    { id: A, title: 'Design notes', slug: 'design-notes-12' },
    { id: B, title: 'Design notes', slug: 'design-notes-13' },
  ]

  it('resolveDoc matches the slug, keeps the cuid, flags a shared title', () => {
    expect(resolveDoc('design-notes-13', docs)).toEqual({
      kind: 'found',
      doc: docs[1],
    })
    expect(resolveDoc(A, docs)).toEqual({ kind: 'found', doc: docs[0] })
    expect(resolveDoc('Design Notes', docs)).toEqual({
      kind: 'ambiguous',
      candidates: docs,
    })
  })

  it('an old slug still finds a renamed doc by its number', () => {
    const renamed = [
      { id: A, title: 'Design notes B', slug: 'design-notes-b-12', number: 12 },
    ]
    expect(resolveDoc('Design-Notes-12', renamed)).toEqual({
      kind: 'found',
      doc: renamed[0],
      viaNumber: true,
    })
  })

  it('a title wins over the number tail; non-slug input never hits a number', () => {
    const list = [
      { id: A, title: 'Runbook', slug: 'runbook-2', number: 2 },
      { id: B, title: 'release-2', slug: 'release-2-7', number: 7 },
    ]
    expect(resolveDoc('release-2', list)).toEqual({
      kind: 'found',
      doc: list[1],
    })
    expect(resolveDoc('Notes 2', list)).toEqual({ kind: 'not-found' })
  })

  it('lookupDocId says when an old slug was resolved by its number', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        documents: [
          { id: B, title: 'Renamed', slug: 'renamed-12', number: 12 },
        ],
      }),
    } as Response)
    expect(await lookupDocId('http://x', 'tok', 'old-title-12')).toBe(B)
    expect(String(err.mock.calls[0]![0])).toContain(
      'using doc #12 by its number — now renamed-12'
    )
  })

  it('lookupDocId resolves a slug and remembers it for output', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ documents: docs }),
    } as Response)
    expect(await lookupDocId('http://x', 'tok', 'design-notes-12')).toBe(A)
    expect(docHandle(A)).toBe('design-notes-12')
  })

  it('an ambiguous title lists the candidates by slug', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ documents: docs }),
    } as Response)
    expect(await lookupDocId('http://x', 'tok', 'Design notes')).toBeNull()
    const text = err.mock.calls.map(c => String(c[0])).join('\n')
    expect(text).toContain('design-notes-12  Design notes')
    expect(text).toContain('design-notes-13  Design notes')
    expect(text).not.toContain(A)
  })

  it('doc list prints the slug; task context points at doc show <slug>', () => {
    const rows = formatDocListRows(
      [
        {
          id: A,
          slug: 'design-notes-12',
          title: 'Design notes',
          visibility: 'WORKSPACE',
          project: null,
        } as never,
      ],
      { tty: false, color: false }
    )
    expect(rows[0]!.startsWith('design-notes-12')).toBe(true)
    expect(rows.join('\n')).not.toContain(A)
    expect(
      renderDocumentSection([
        {
          id: A,
          slug: 'design-notes-12',
          title: 'Design notes',
          summary: null,
        },
      ])
    ).toContain('lumo doc show design-notes-12')
  })

  it('docHandle falls back to the id only when no slug is known', () => {
    expect(docHandle('cunknown000000000000000000')).toBe(
      'cunknown000000000000000000'
    )
    expect(docHandle('x', 'given-slug-3')).toBe('given-slug-3')
  })
})

describe('PR findings', () => {
  const f = (id: string) =>
    ({
      id,
      severity: 'HIGH',
      title: `title ${id.slice(-2)}`,
      ruleId: 'secret:x',
      filePath: 'a.ts',
      line: 1,
      prNumber: 1,
      blocking: true,
      disposition: null,
    }) as never
  it('pickFindings accepts the short ref and the full id, once each', () => {
    const r = pickFindings(['pskvl3sh', A, '6z9j2q6d'], [f(A), f(B)])
    expect(r).toEqual({ ok: true, findings: [f(A), f(B)] })
  })
  it('an ambiguous prefix fails the whole batch with the candidates', () => {
    const r = pickFindings(['cmva568'], [f(A), f(B)])
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain(A)
      expect(r.error).toContain(B)
    }
  })
  it('the DONE-blocked remediation names findings by short ref', () => {
    const lines = buildRemediation(
      [{ kind: 'SECURITY_FINDING', findingId: A } as never],
      [],
      { identifier: 'LUM-9', dispositionUrl: 'u' }
    )
    expect(lines[0]).toContain('lumo finding disposition pskvl3sh')
    expect(lines[0]).not.toContain(A)
  })
})

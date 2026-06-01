import { formatImportedLine } from '@/cli/src/commands/doc-import-gdoc'

describe('formatImportedLine', () => {
  it('prints id, title, url and the over-share hint', () => {
    const out = formatImportedLine({
      id: 'cmd_1',
      title: 'Spec',
      url: 'https://www.uselumo.ai/workspace/lumo/documents/spec-1',
    })
    expect(out).toContain('Imported cmd_1 "Spec"')
    expect(out).toContain(
      'https://www.uselumo.ai/workspace/lumo/documents/spec-1'
    )
    expect(out.toLowerCase()).toContain('no longer gated by google')
  })
})

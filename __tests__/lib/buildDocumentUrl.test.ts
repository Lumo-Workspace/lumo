import { buildDocumentUrl } from '@/lib/utils/buildDocumentUrl'

it('builds a workspace document url', () => {
  expect(buildDocumentUrl('acme', 'spec-3')).toMatch(
    /\/workspace\/acme\/documents\/spec-3$/
  )
})

import { parseFigmaUrl } from '@/lib/integrations/figma/parse-url'

describe('parseFigmaUrl', () => {
  it('parses /file/ URL with node-id', () => {
    expect(
      parseFigmaUrl(
        'https://www.figma.com/file/abc123/Onboarding?node-id=1-234'
      )
    ).toEqual({ fileKey: 'abc123', nodeId: '1:234' })
  })

  it('parses /design/ URL (new format)', () => {
    expect(
      parseFigmaUrl(
        'https://www.figma.com/design/abc123/Onboarding?node-id=1-234'
      )
    ).toEqual({ fileKey: 'abc123', nodeId: '1:234' })
  })

  it('parses /proto/ URL', () => {
    expect(
      parseFigmaUrl(
        'https://www.figma.com/proto/abc123/Onboarding?node-id=2-456'
      )
    ).toEqual({ fileKey: 'abc123', nodeId: '2:456' })
  })

  it('returns null nodeId when query missing', () => {
    expect(
      parseFigmaUrl('https://www.figma.com/file/abc123/Onboarding')
    ).toEqual({ fileKey: 'abc123', nodeId: null })
  })

  it('normalizes %3A in node-id to colon', () => {
    expect(
      parseFigmaUrl(
        'https://www.figma.com/file/abc123/Onboarding?node-id=1%3A234'
      )
    ).toEqual({ fileKey: 'abc123', nodeId: '1:234' })
  })

  it('returns null for non-figma URL', () => {
    expect(parseFigmaUrl('https://example.com/abc')).toBeNull()
  })

  it('returns null for figma URL missing file key', () => {
    expect(parseFigmaUrl('https://www.figma.com/community/file')).toBeNull()
  })

  it('returns null for unparseable input', () => {
    expect(parseFigmaUrl('not a url')).toBeNull()
  })
})

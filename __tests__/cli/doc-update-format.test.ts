/**
 * @jest-environment node
 */
import { formatUpdatedDocLine } from '@/cli/src/commands/doc-update'

describe('formatUpdatedDocLine', () => {
  it('renders updated line with cuid, title, url', () => {
    expect(
      formatUpdatedDocLine({
        id: 'c1',
        title: 'Doc',
        url: 'https://x/y/c1',
      })
    ).toBe('Updated c1 "Doc"  https://x/y/c1')
  })
})

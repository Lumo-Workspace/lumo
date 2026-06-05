// __tests__/editor/comment-mark.test.ts
// react-intl ships untranspiled ESM; stub it so the import chain from
// getBaseExtensions() (via Callout, Toggle, TaskView node-views) doesn't
// blow up in jsdom. Mirrors callout.test.ts and code-block-lowlight.test.ts.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: () => null,
  DropdownMenuTrigger: () => null,
  DropdownMenuContent: () => null,
  DropdownMenuItem: () => null,
}))

import { CommentMark } from '@/lib/editor/marks/comment-mark'
import { getBaseExtensions } from '@/lib/editor/extensions'

describe('CommentMark', () => {
  it('is a mark named "comment"', () => {
    expect(CommentMark.name).toBe('comment')
    expect(CommentMark.type).toBe('mark')
  })

  it('is not inclusive (typing at the boundary does not extend the mark)', () => {
    expect(CommentMark.config.inclusive).toBe(false)
  })

  it('parses span[data-comment-id]', () => {
    const rules = CommentMark.config.parseHTML?.call(CommentMark as never)
    expect(rules).toEqual([{ tag: 'span[data-comment-id]' }])
  })

  it('exposes setComment and unsetComment commands', () => {
    const cmds = CommentMark.config.addCommands?.call(CommentMark as never)
    expect(typeof cmds?.setComment).toBe('function')
    expect(typeof cmds?.unsetComment).toBe('function')
  })

  it('is registered in getBaseExtensions()', () => {
    const names = getBaseExtensions().map(e => e.name)
    expect(names).toContain('comment')
  })
})

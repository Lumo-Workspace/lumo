/** @jest-environment jsdom */
/**
 * LUM-1283: the read-only Creator row sits under the Assignee ghost select in
 * the task detail panel. jsdom can't measure layout, so this pins the classes
 * that place the avatar and name: the Creator row must carry the same border,
 * horizontal padding, height and text size as a ghost `size='sm'` trigger.
 * (Measured in a browser: before, the creator avatar sat 1px left and its
 * name was 12px against the assignee's 14px.)
 */
import { render } from '@testing-library/react'
import { Select, SelectTrigger } from '@/components/ui/select'
import { CreatorField } from '@/app/workspace/[workspaceUrl]/components/fields/CreatorField'

jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))

const BOX_CLASSES = [
  'border',
  'border-transparent',
  'px-2',
  'h-control-sm',
  'text-body',
]

function triggerClasses(): string[] {
  const { container } = render(
    <Select>
      <SelectTrigger variant='ghost' size='sm' />
    </Select>
  )
  return Array.from(container.querySelector('button')!.classList)
}

function creatorRowClasses(
  creator: Parameters<typeof CreatorField>[0]['creator']
): string[] {
  const { container } = render(<CreatorField creator={creator} />)
  return Array.from((container.firstChild as HTMLElement).classList)
}

describe('CreatorField lines up with the ghost Assignee trigger', () => {
  it('the ghost sm trigger carries the box classes this test relies on', () => {
    expect(triggerClasses()).toEqual(expect.arrayContaining(BOX_CLASSES))
  })

  it.each([
    ['member', { kind: 'member', name: 'Alice', imageUrl: null }],
    ['former member', { kind: 'former-member' }],
    ['not recorded', { kind: 'unrecorded' }],
  ] as const)('%s row uses the same box', (_label, creator) => {
    expect(creatorRowClasses(creator)).toEqual(
      expect.arrayContaining(BOX_CLASSES)
    )
    expect(creatorRowClasses(creator)).not.toContain('text-caption')
  })
})

/** @jest-environment jsdom */
import { createRef } from 'react'
import { act, render, screen } from '@testing-library/react'

// jsdom doesn't implement scrollIntoView; the list scrolls the active option
// into view in a layout effect.
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn()
})
import {
  SlashCommandList,
  type SlashCommandListRef,
} from '@/lib/editor/slash-command-list'
import type { SlashCommandItem } from '@/lib/editor/slash-command'

const items: SlashCommandItem[] = [
  {
    title: 'Heading 1',
    description: 'Big heading',
    icon: null,
    categoryKey: 'basic',
    category: 'Basic',
    command: jest.fn(),
  },
  {
    title: 'Bullet list',
    description: 'Unordered list',
    icon: null,
    categoryKey: 'basic',
    category: 'Basic',
    command: jest.fn(),
  },
  {
    title: 'Divider',
    description: 'Horizontal line',
    icon: null,
    categoryKey: 'advanced',
    category: 'Advanced',
    command: jest.fn(),
  },
]

describe('SlashCommandList a11y', () => {
  it('exposes a labelled listbox with one option per item', () => {
    render(
      <SlashCommandList
        items={items}
        command={jest.fn()}
        label='Command suggestions'
      />
    )
    expect(
      screen.getByRole('listbox', { name: 'Command suggestions' })
    ).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('marks the first option selected and wires aria-activedescendant', () => {
    render(<SlashCommandList items={items} command={jest.fn()} label='Commands' />)
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('listbox').getAttribute('aria-activedescendant')).toBe(
      options[0]!.id
    )
  })

  it('moves the active option on ArrowDown via the imperative ref', () => {
    const ref = createRef<SlashCommandListRef>()
    render(
      <SlashCommandList
        ref={ref}
        items={items}
        command={jest.fn()}
        label='Commands'
      />
    )
    let handled = false
    act(() => {
      handled = ref.current!.onKeyDown({
        event: new KeyboardEvent('keydown', { key: 'ArrowDown' }),
      })
    })
    expect(handled).toBe(true)
    const options = screen.getAllByRole('option')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('groups options by category', () => {
    render(<SlashCommandList items={items} command={jest.fn()} label='Commands' />)
    expect(screen.getByRole('group', { name: 'Basic' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Advanced' })).toBeInTheDocument()
  })

  it('groups by stable categoryKey while rendering the localized category label as the header', () => {
    // Two items share categoryKey 'basic' but carry a non-English localized
    // category label '基础'. A third item belongs to categoryKey 'advanced'
    // with label '高级'. The component must produce exactly ONE group for
    // 'basic' (header = '基础') and ONE group for 'advanced' (header = '高级'),
    // regardless of the display label differing from the key.
    const localizedItems: SlashCommandItem[] = [
      {
        title: '标题一',
        description: '大号标题',
        icon: null,
        categoryKey: 'basic',
        category: '基础',
        command: jest.fn(),
      },
      {
        title: '项目符号列表',
        description: '无序列表',
        icon: null,
        categoryKey: 'basic',
        category: '基础',
        command: jest.fn(),
      },
      {
        title: '分割线',
        description: '水平线',
        icon: null,
        categoryKey: 'advanced',
        category: '高级',
        command: jest.fn(),
      },
    ]

    render(
      <SlashCommandList
        items={localizedItems}
        command={jest.fn()}
        label='命令建议'
      />
    )

    // Exactly one group with the localized '基础' header
    const basicGroup = screen.getByRole('group', { name: '基础' })
    expect(basicGroup).toBeInTheDocument()

    // Both basic items appear inside that single group
    expect(basicGroup).toHaveTextContent('标题一')
    expect(basicGroup).toHaveTextContent('项目符号列表')

    // The advanced group renders its own localized header
    const advancedGroup = screen.getByRole('group', { name: '高级' })
    expect(advancedGroup).toBeInTheDocument()
    expect(advancedGroup).toHaveTextContent('分割线')

    // Sanity: no extra groups exist (only the two categoryKeys present)
    expect(screen.getAllByRole('group')).toHaveLength(2)

    // All three items are rendered as options
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })
})

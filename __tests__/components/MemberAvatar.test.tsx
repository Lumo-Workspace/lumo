import { render, screen } from '@testing-library/react'
import {
  AVATAR_SIZE_CLASS,
  AgentAvatar,
  MemberAvatar,
  avatarColor,
  avatarInitials,
  type AvatarSize,
} from '@/components/MemberAvatar'
import { getInitials } from '@/lib/utils/getInitials'

describe('getInitials (LUM-1269)', () => {
  it.each([
    ['Ada Lovelace', 'AL'],
    ['  grace   brewster  hopper ', 'GB'],
    ['Linus', 'L'],
    ['', '?'],
    ['   ', '?'],
  ])('%j → %s', (name, expected) => {
    expect(getInitials(name)).toBe(expected)
  })

  it('caps the letter count with max', () => {
    expect(getInitials('Ada Lovelace', 1)).toBe('A')
    expect(getInitials('Ada Lovelace', 0)).toBe('A')
  })
})

describe('avatarInitials — one rule for 1 vs 2 letters', () => {
  it('shows one initial at xs (20px) and two from sm up', () => {
    expect(avatarInitials('Ada Lovelace', 'xs')).toBe('A')
    for (const size of ['sm', 'md', 'lg', 'xl'] as const) {
      expect(avatarInitials('Ada Lovelace', size)).toBe('AL')
    }
  })
})

describe('avatarColor', () => {
  it('is stable per name and handles short names', () => {
    expect(avatarColor('Ada')).toBe(avatarColor('Ada'))
    expect(avatarColor('A')).toMatch(/^bg-\S+ text-\S+$/)
    expect(avatarColor('')).toMatch(/^bg-\S+ text-\S+$/)
  })
})

describe('MemberAvatar', () => {
  it.each(Object.entries(AVATAR_SIZE_CLASS) as [AvatarSize, string][])(
    'size %s applies %s',
    (size, cls) => {
      render(<MemberAvatar name='Ada Lovelace' size={size} />)
      expect(screen.getByRole('img', { name: 'Ada Lovelace' })).toHaveClass(cls)
    }
  )

  it('uses a strictly increasing size scale', () => {
    const px = Object.values(AVATAR_SIZE_CLASS).map(c =>
      Number(c.replace('size-', ''))
    )
    expect(px).toEqual([...px].sort((a, b) => a - b))
    expect(new Set(px).size).toBe(px.length)
  })

  it('renders initials immediately when there is no image', () => {
    render(<MemberAvatar name='Ada Lovelace' imageUrl={null} size='md' />)
    expect(screen.getByText('AL')).toBeInTheDocument()
  })

  it('treats an empty imageUrl as no image', () => {
    render(<MemberAvatar name='Grace Hopper' imageUrl='' />)
    expect(screen.getByText('GH')).toBeInTheDocument()
  })

  it('falls back to initials after a delay while an image has not loaded', async () => {
    render(<MemberAvatar name='Grace Hopper' imageUrl='https://x/broken.png' />)
    expect(screen.queryByText('GH')).not.toBeInTheDocument()
    expect(
      await screen.findByText('GH', {}, { timeout: 2000 })
    ).toBeInTheDocument()
  })
})

describe('AgentAvatar', () => {
  it('is labelled with the agent name and shares the size scale', () => {
    render(<AgentAvatar name='Claude Code' size='lg' />)
    expect(screen.getByRole('img', { name: 'Claude Code' })).toHaveClass(
      AVATAR_SIZE_CLASS.lg
    )
  })
})

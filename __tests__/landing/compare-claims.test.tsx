/** @jest-environment jsdom */
/**
 * LUM-827 — the homepage head-to-head table against Linear, CodeRabbit and QA Wolf (one per lane).
 *
 * A comparison table is the one place on the page that makes claims about
 * someone else's product, so every competitor cell must point at the vendor's
 * own page. These guards keep a future edit from adding an unsourced cell or
 * citing a third-party blog in place of the vendor.
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import {
  COMPARE_ROWS,
  COMPETITORS,
  COMPETITOR_NAMES,
  OFFICIAL_DOMAINS,
} from '@/components/landing/home/compare'
import { LumoHome } from '@/components/landing/home/lumo-home'

function isOfficial(url: string, domains: string[]): boolean {
  const { protocol, hostname } = new URL(url)
  return (
    protocol === 'https:' &&
    domains.some(d => hostname === d || hostname.endsWith(`.${d}`))
  )
}

describe('homepage compare section LUM-827', () => {
  it('every competitor cell cites an official vendor source', () => {
    expect(COMPARE_ROWS.length).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const row of COMPARE_ROWS) {
      for (const key of COMPETITORS) {
        const cell = row[key]
        if (
          !cell.note.trim() ||
          !isOfficial(cell.source, OFFICIAL_DOMAINS[key])
        )
          offenders.push(`${row.capability} / ${key}: ${cell.source}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('homepage renders the compare section with all four products', () => {
    // The terminal demo reads prefers-reduced-motion and waits to scroll into
    // view; jsdom has neither matchMedia nor IntersectionObserver.
    window.matchMedia = jest.fn().mockReturnValue({
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })
    window.IntersectionObserver = jest.fn().mockReturnValue({
      observe: jest.fn(),
      disconnect: jest.fn(),
    })
    const { container } = render(<LumoHome />)

    const section = container.querySelector('section#compare')
    expect(section).not.toBeNull()

    const headers = within(section as HTMLElement)
      .getAllByRole('columnheader')
      .map(th => th.textContent)
    expect(headers).toEqual(
      expect.arrayContaining([
        'Lumo',
        ...COMPETITORS.map(key => COMPETITOR_NAMES[key]),
      ])
    )
    expect(
      within(section as HTMLElement).getAllByRole('rowheader')
    ).toHaveLength(COMPARE_ROWS.length)

    const navLink = screen.getByRole('link', { name: 'Compare' })
    expect(navLink).toHaveAttribute('href', '#compare')
  })
})

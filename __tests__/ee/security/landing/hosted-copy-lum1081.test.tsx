/** @jest-environment jsdom */
/**
 * LUM-1081 — the hosted service keeps its plugin copy. The open-source
 * snapshot rewrites these surfaces at export time (oss/manifest.json
 * transforms); the private sources, and so the hosted pages, must render
 * exactly what they did before: the PR scan demo and rows on the landing
 * page, the crossing-triage, sandbox and uninstall paragraphs on /security,
 * the GitHub card's scanning copy and the CI ingest key card.
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { Compare } from '@/components/landing/home/compare'
import { HowItWorks } from '@/components/landing/home/how-it-works'
import { LumoTerminal } from '@/components/landing/home/lumo-terminal'
import { SecurityPage } from '@/components/security/SecurityPage'
import { MESSAGES } from '@/lib/i18n/messages'
import { retentionFigures } from '@/lib/legal/retention-figures'
import { buildSubprocessorPageView } from '@/lib/legal/subprocessor-change-log'
import {
  AI_HOST_SUBPROCESSORS,
  INFRASTRUCTURE_SUBPROCESSORS,
} from '@/lib/legal/subprocessors'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
}))

// react-intl ships ESM that jest does not transform; a plain English
// formatter is enough to read the rendered text.
jest.mock('react-intl', () => {
  const { MESSAGES: M } = require('@/lib/i18n/messages')
  const messages = M.en as Record<string, string>
  return {
    useIntl: () => ({
      locale: 'en',
      formatMessage: (
        { id }: { id: string },
        values: Record<string, unknown> = {}
      ) => {
        const msg = messages[id]
        if (msg === undefined) throw new Error(`missing i18n key: ${id}`)
        return msg.replace(/\{(\w+)\}/g, (_, k: string) =>
          typeof values[k] === 'string' || typeof values[k] === 'number'
            ? String(values[k])
            : k
        )
      },
      formatNumber: (v: number) => String(v),
      formatList: (items: string[]) => items.join(' or '),
      formatDate: () => 'October 5, 2026',
    }),
  }
})

const en = MESSAGES.en!

beforeAll(() => {
  // The terminal demo reads prefers-reduced-motion (reduced = every step
  // rendered at once) and waits to scroll into view.
  window.matchMedia = jest.fn().mockReturnValue({
    matches: true,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })
  window.IntersectionObserver = jest.fn().mockReturnValue({
    observe: jest.fn(),
    disconnect: jest.fn(),
  })
})

describe('hosted copy is unchanged by the snapshot scrub LUM-1081', () => {
  it('the landing page still shows the PR scan demo and rows', () => {
    const { container: term } = render(<LumoTerminal />)
    expect(term).toHaveTextContent('lumo pr scan 482')
    expect(term).toHaveTextContent('8 scan findings left for you')

    const { container: how } = render(<HowItWorks />)
    // Step three is the third tab; its copy is in the tab data.
    fireEvent.click(screen.getAllByRole('tab')[2]!)
    expect(how).toHaveTextContent('Pull requests scanned before they merge')
    expect(how).toHaveTextContent('Scan findings')

    const { container: cmp } = render(<Compare />)
    expect(cmp).toHaveTextContent('An agent that hunts for a working exploit')
    expect(cmp).toHaveTextContent('Lumo runs all three.')
  })

  it('/security still renders the triage, sandbox and uninstall paragraphs', () => {
    const { container } = render(
      <>
        <SecurityPage
          locale='en'
          retentionFigures={retentionFigures()}
          subprocessors={buildSubprocessorPageView({
            infrastructure: INFRASTRUCTURE_SUBPROCESSORS,
            aiHosts: AI_HOST_SUBPROCESSORS,
            changes: [],
            now: new Date('2026-10-05T00:00:00Z'),
          })}
        />
      </>
    )
    for (const key of [
      'security.code.ai',
      'security.code.triage',
      'security.infra.sandbox',
      'security.retention.uninstall',
      'security.subprocessors.ai.intro',
    ])
      expect(container).toHaveTextContent(en[key]!)
    expect(container).toHaveTextContent('boundary-crossing triage')
    // LUM-860 (moved from the core /security test): uninstall and repository
    // removal both clear scan code.
    expect(en['security.retention.uninstall']).toMatch(
      /or removing a repository from it, clears the code/
    )
    // The snapshot's wording is never shown here.
    expect(container).not.toHaveTextContent(en['oss.security.code.ai']!)
  })

  it('the GitHub card and API keys page messages keep the scanning copy', () => {
    expect(en['github.description']).toContain('security scanning')
    expect(en['github.uninstallDesc']).toContain('stop scanning')
    expect(en['apiKeys.ingest.description']).toContain('SARIF')
  })
})

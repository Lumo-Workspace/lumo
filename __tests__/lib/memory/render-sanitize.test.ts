/**
 * @jest-environment node
 *
 * LUM-346 — control-character sanitization at the untrusted render boundary.
 *
 * LLM-generated and member-authored free text (memory content, Slack
 * summaries, fetched web bodies) enters the agent instruction stream wrapped
 * in <untrusted-*> blocks. Model-side defenses can't be assumed to catch
 * escape-sequence injection, so the wrap boundary strips terminal control
 * characters with the same character class the CLI's sanitizeField uses.
 */
import {
  renderLayer2ReviewSection,
  renderMemorySection,
  wrapUntrustedLinked,
  wrapUntrustedLinkedGroup,
  wrapUntrustedMemory,
  type RenderableMemory,
} from '@/lib/memory/render'
import {
  renderSlackContextSection,
  type SlackContextCard,
} from '@/lib/context/render/slack'
import {
  renderWebLinkSection,
  type WebLinkCard,
} from '@/lib/context/render/web-link'
import { sanitizeField as serverSanitizeField } from '@/lib/utils/sanitize'
import { sanitizeField as cliSanitizeField } from '../../../cli/src/lib/sanitize'

const ESC = '\x1b'

function memory(content: unknown): RenderableMemory {
  return { id: 'm1', scope: 'PROJECT', category: 'TRAP', content }
}

function slackCard(summary: string | null): SlackContextCard {
  return {
    id: 'slack1',
    isThread: true,
    slackChannelName: 'eng',
    permalink: 'https://slack.example/p1',
    snapshotAt: new Date('2026-06-01T00:00:00Z'),
    refreshError: null,
    summary,
    snapshot: {
      messages: [{ ts: '1', userName: 'kai', userId: 'U1', text: 'hello' }],
    },
  }
}

describe('wrapUntrustedMemory — control-char sanitization (LUM-346)', () => {
  it('strips ESC/CSI sequences smuggled in memory content', () => {
    const section = renderMemorySection([
      memory({
        trigger: `red ${ESC}[31malert${ESC}[0m herring`,
        outcome: `beeps\x07 and a CSI ${ESC}[2J wipe`,
      }),
    ])
    const out = wrapUntrustedMemory(section)
    expect(out).not.toContain(ESC)
    expect(out).not.toContain('\x07')
    // Visible payload survives with only the control bytes removed.
    expect(out).toContain('red [31malert[0m herring')
  })

  it('strips 8-bit C1 controls (e.g. \\x9b CSI introducer)', () => {
    const section = renderMemorySection([
      memory({ trigger: 'c1 \x9b31m injection', outcome: 'o' }),
    ])
    const out = wrapUntrustedMemory(section)
    expect(out).not.toContain('\x9b')
    expect(out).toContain('c1 31m injection')
  })

  it('leaves normal markdown / Chinese / tabs / newlines untouched', () => {
    const section = renderMemorySection([
      memory({
        trigger: '**迁移** merged to main，but CI 跳过 `migrate deploy`',
        outcome: 'col\tumn\nbreaks',
      }),
    ])
    expect(wrapUntrustedMemory(section)).toContain(
      '**迁移** merged to main，but CI 跳过 `migrate deploy`'
    )
    expect(wrapUntrustedMemory(section)).toContain('col\tumn')
  })

  it('returns "" when the section is empty after sanitization', () => {
    expect(wrapUntrustedMemory(`${ESC}\x07\x9b \n`)).toBe('')
  })
})

describe('wrapUntrustedLinked — control-char sanitization (LUM-346)', () => {
  it('strips ESC sequences from an LLM-generated Slack summary', () => {
    const section = renderSlackContextSection(
      [slackCard(`Decision: ship.${ESC}]0;owned${ESC}\\ after review.`)],
      'LUM-1'
    )
    const out = wrapUntrustedLinked(section)
    expect(out).not.toContain(ESC)
    expect(out).toContain('Decision: ship.]0;owned\\ after review.')
  })

  it('strips control chars from fetched web-link bodies', () => {
    const links: WebLinkCard[] = [
      {
        id: 'w1',
        url: 'https://example.com/a',
        domain: 'example.com',
        title: 'A page',
        description: `desc with ${ESC}[1;31mcolor${ESC}[0m`,
        note: null,
        fetchedAt: new Date('2026-06-01T00:00:00Z'),
        fetchError: null,
      },
    ]
    const out = wrapUntrustedLinked(renderWebLinkSection(links, 'LUM-1'))
    expect(out).not.toContain(ESC)
    expect(out).toContain('desc with [1;31mcolor[0m')
    // URLs pass through verbatim (no control chars to strip).
    expect(out).toContain('https://example.com/a')
  })

  it('keeps clean linked content byte-identical inside the boundary', () => {
    const section = renderSlackContextSection(
      [slackCard('正常总结，无注入。')],
      'LUM-1'
    )
    const out = wrapUntrustedLinked(section)
    expect(out).toContain(section.trimEnd())
  })

  it('strips control chars on every group section, including follow-ups (LUM-352)', () => {
    const out = wrapUntrustedLinkedGroup([
      `## A\nfirst ${ESC}[31mred${ESC}[0m`,
      `## B\nsecond ${ESC}]0;owned${ESC}\\ body`,
    ])
    for (const section of out) {
      expect(section).not.toContain(ESC)
    }
    expect(out[1]).toContain('second ]0;owned\\ body')
  })
})

describe('renderLayer2ReviewSection — sanitized via wrapUntrustedMemory', () => {
  it('strips ESC sequences from auto-consolidated memory bodies', () => {
    const out = renderLayer2ReviewSection([
      memory({ trigger: `sneaky ${ESC}[8m invisible`, outcome: 'o' }),
    ])
    expect(out).not.toContain(ESC)
    expect(out).toContain('sneaky [8m invisible')
    // The trusted preamble and the id pointer both survive.
    expect(out).toContain('Review needed')
    expect(out).toContain('ref: m1')
  })
})

describe('CLI ↔ server sanitization parity (LUM-346)', () => {
  it('both sides re-export the exact same shared implementation', () => {
    expect(serverSanitizeField).toBe(cliSanitizeField)
  })
})

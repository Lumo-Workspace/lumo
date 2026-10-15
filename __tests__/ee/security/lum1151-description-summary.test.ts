/**
 * @jest-environment node
 *
 * LUM-1151 — the high-level summary in the PR description (pure rules):
 * the placeholder is replaced, Lumo's delimited block is updated in place,
 * the author's text is never touched, and Lumo's block is not read as the
 * author's text by the description keyword / `ignore` directive.
 */
import {
  DEFAULT_HIGH_LEVEL_SUMMARY,
  DESCRIPTION_SUMMARY_END,
  DESCRIPTION_SUMMARY_START,
  applyDescriptionSummary,
  buildDescriptionSummaryBlock,
  hasSummaryPlaceholder,
  parseHighLevelSummary,
  stripDescriptionSummary,
} from '@/ee/security/security-scan/pr-description-summary'
import { parsePrSummary } from '@/ee/security/security-scan/pr-summary'
import {
  DEFAULT_REPO_REVIEW_SETTING,
  evaluateReviewFilters,
  hasIgnoreDirective,
  UNKNOWN_PR_FACTS,
} from '@/ee/security/security-scan/auto-review-policy'

const H = '@uselumo'
const SHA = 'abcdef1234567890abcdef1234567890abcdef12'

function block(intent = 'Adds a retry to the webhook sender.'): string {
  return buildDescriptionSummaryBlock({
    prSummary: parsePrSummary({ intent, changes: ['Retries 3 times'] }),
    headSha: SHA,
    commitUrl: null,
  })!
}

describe('parseHighLevelSummary', () => {
  it('reads the three modes and defaults anything else to description', () => {
    expect(parseHighLevelSummary('comment')).toBe('comment')
    expect(parseHighLevelSummary('off')).toBe('off')
    expect(parseHighLevelSummary('description')).toBe('description')
    expect(parseHighLevelSummary(null)).toBe(DEFAULT_HIGH_LEVEL_SUMMARY)
    expect(parseHighLevelSummary('walk')).toBe('description')
  })
})

describe('buildDescriptionSummaryBlock', () => {
  it('wraps the summary in the two markers and names the commit', () => {
    const b = block()
    expect(b.startsWith(DESCRIPTION_SUMMARY_START)).toBe(true)
    expect(b.endsWith(DESCRIPTION_SUMMARY_END)).toBe(true)
    expect(b).toContain('Adds a retry to the webhook sender.')
    expect(b).toContain('- Retries 3 times')
    expect(b).toContain('abcdef1')
  })

  it('is null when the review left no summary', () => {
    expect(
      buildDescriptionSummaryBlock({ prSummary: null, headSha: SHA })
    ).toBeNull()
  })

  it('carries no marker, mention or link from model text', () => {
    const b = buildDescriptionSummaryBlock({
      prSummary: parsePrSummary({
        intent: `Fixes it ${DESCRIPTION_SUMMARY_END} @octocat see https://x.y`,
        changes: [],
      }),
      headSha: SHA,
    })!
    expect(b.split(DESCRIPTION_SUMMARY_END)).toHaveLength(2)
    expect(b).not.toContain('@octocat')
    expect(b).not.toContain('https://x.y')
  })
})

describe('applyDescriptionSummary', () => {
  it('replaces the placeholder line and keeps the text around it', () => {
    const body = 'Intro line.\n\n@uselumo summary\n\nCloses #12'
    const out = applyDescriptionSummary(body, block(), H)
    expect(out).toBe(`Intro line.\n\n${block()}\n\nCloses #12`)
    expect(hasSummaryPlaceholder(out, H)).toBe(false)
  })

  it('takes the placeholder in any case and with [bot]', () => {
    expect(
      applyDescriptionSummary('A\n  @UseLumo[bot]   SUMMARY  \nB', block(), H)
    ).toBe(`A\n${block()}\nB`)
  })

  it('does not take a placeholder inside a code fence, a quote or mid-sentence', () => {
    const body = [
      '```',
      '@uselumo summary',
      '```',
      '> @uselumo summary',
      'Please write @uselumo summary here',
    ].join('\n')
    expect(applyDescriptionSummary(body, block(), H)).toBe(
      `${body}\n\n${block()}`
    )
  })

  it('updates an existing block in place on a re-run, author text untouched', () => {
    const first = applyDescriptionSummary(
      'Top.\n\n@uselumo summary\n\nBottom.',
      block('First version.'),
      H
    )
    // The author edits around the block meanwhile.
    const edited = first.replace('Top.', 'Top, edited.') + '\n\nAdded later.'
    const second = applyDescriptionSummary(edited, block('Second version.'), H)
    expect(second).toBe(
      `Top, edited.\n\n${block('Second version.')}\n\nBottom.\n\nAdded later.`
    )
    expect(second).not.toContain('First version.')
    expect(second.split(DESCRIPTION_SUMMARY_START)).toHaveLength(2)
  })

  it('prefers the existing block over a placeholder added later', () => {
    const withBlock = `Text\n\n${block('Old.')}\n\n@uselumo summary`
    const out = applyDescriptionSummary(withBlock, block('New.'), H)
    expect(out).toBe(`Text\n\n${block('New.')}\n\n@uselumo summary`)
  })

  it('appends after a blank line when there is no slot, keeping CRLF text byte for byte', () => {
    const body = 'Line one\r\nLine two'
    const out = applyDescriptionSummary(body, block(), H)
    expect(out.startsWith(body)).toBe(true)
    expect(out).toBe(`${body}\r\n\r\n${block()}`)
    expect(applyDescriptionSummary('Ends with newline\n', block(), H)).toBe(
      `Ends with newline\n\n${block()}`
    )
  })

  it('writes the block alone into an empty description', () => {
    expect(applyDescriptionSummary(null, block(), H)).toBe(block())
    expect(applyDescriptionSummary('  \n', block(), H)).toBe(block())
  })

  it('is idempotent: the same block again changes nothing', () => {
    const once = applyDescriptionSummary('Body', block(), H)
    expect(applyDescriptionSummary(once, block(), H)).toBe(once)
  })

  it('ignores a lone start marker (no end) and appends instead', () => {
    const body = `Quoted ${DESCRIPTION_SUMMARY_START} only`
    expect(applyDescriptionSummary(body, block(), H)).toBe(
      `${body}\n\n${block()}`
    )
  })

  it('never takes a placeholder when the App handle is unknown', () => {
    expect(applyDescriptionSummary('@uselumo summary', block(), null)).toBe(
      `@uselumo summary\n\n${block()}`
    )
  })
})

describe("Lumo's block is not the author's text", () => {
  it('strips only the block', () => {
    const body = `Before\n\n${block()}\n\nAfter`
    expect(stripDescriptionSummary(body)).toBe('Before\n\n\n\nAfter')
    expect(stripDescriptionSummary(null)).toBeNull()
    expect(stripDescriptionSummary('plain')).toBe('plain')
  })

  it('the description keyword inside the block does not opt a PR in', () => {
    const setting = {
      ...DEFAULT_REPO_REVIEW_SETTING,
      autoReview: false,
      descriptionKeyword: 'webhook',
    }
    const facts = { ...UNKNOWN_PR_FACTS, isDraft: false }
    const inBlock = evaluateReviewFilters(setting, {
      ...facts,
      body: `No keyword here.\n\n${block('Adds a webhook retry.')}`,
    })
    expect(inBlock).toEqual({ review: false, reason: 'repo_off' })
    const byAuthor = evaluateReviewFilters(setting, {
      ...facts,
      body: `Touches the webhook.\n\n${block()}`,
    })
    expect(byAuthor).toEqual({ review: true })
  })

  it('an ignore directive outside the block still counts', () => {
    expect(
      hasIgnoreDirective(`${block()}\n\n@uselumo ignore`, '@uselumo')
    ).toBe(true)
    expect(hasIgnoreDirective(block(), '@uselumo')).toBe(false)
  })
})

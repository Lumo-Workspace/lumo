/** @jest-environment jsdom */

// LUM-639 — the acceptance-quality audit footnote: three count groups
// (verification friction / claim faithfulness / criteria referent kind)
// rendered per the Milestone Detail 2a design — composition bar + swatch
// legend + summary chip per group, counts only, explicit absence buckets.

const messages: Record<string, string> = {
  'milestone.greenQuality.title': 'Acceptance quality',
  'milestone.greenQuality.subtitle':
    'audit footnote — counts over {count} done tasks, no score',
  'milestone.greenQuality.empty':
    'No done tasks yet — acceptance quality appears once deliveries land.',
  'milestone.greenQuality.friction.title': 'Verification friction',
  'milestone.greenQuality.friction.chip': '{clean}/{done} clean',
  'milestone.greenQuality.friction.singleRound': 'Single round',
  'milestone.greenQuality.friction.multiRound': 'Multi-round or send-back',
  'milestone.greenQuality.friction.noRecord': 'No verification record',
  'milestone.greenQuality.faithfulness.title': 'Claim faithfulness',
  'milestone.greenQuality.faithfulness.chip': '{count} overstated',
  'milestone.greenQuality.faithfulness.faithful': 'Faithful',
  'milestone.greenQuality.faithfulness.overstated': 'Overstated',
  'milestone.greenQuality.faithfulness.underReported': 'Under-reported',
  'milestone.greenQuality.faithfulness.unjudged': 'Not judged',
  'milestone.greenQuality.referent.title': 'Criteria referent kind',
  'milestone.greenQuality.referent.chip': '{count} self-confirming+',
  'milestone.greenQuality.referent.external': 'Externally anchored',
  'milestone.greenQuality.referent.selfConfirming': 'Self-confirming',
  'milestone.greenQuality.referent.other': 'Other',
  'milestone.greenQuality.referent.noSnapshot': 'No frozen contract (tasks)',
  'milestone.greenQuality.note':
    'Buckets are value-neutral and never combined into a score.',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => {
      let msg = messages[id] ?? id
      for (const [k, v] of Object.entries(values ?? {})) {
        msg = msg.replace(`{${k}}`, String(v))
      }
      return msg
    },
  }),
}))

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { MilestoneOutcomeSection } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneOutcomeSection'

const greenQuality = {
  doneCount: 7,
  friction: { noVerification: 1, singleRound: 6, multiRoundOrSendback: 0 },
  faithfulness: { faithful: 5, overstated: 0, underReported: 0, unjudged: 2 },
  referentKind: {
    externallyAnchored: 14,
    selfConfirming: 6,
    other: 2,
    noSnapshotTasks: 1,
  },
}

describe('MilestoneOutcomeSection', () => {
  it('renders green quality as outcome footnote', () => {
    render(<MilestoneOutcomeSection greenQuality={greenQuality} />)

    // Footnote header — subordinate 13px title + audit-footnote subtitle.
    expect(screen.getByText('Acceptance quality')).toBeInTheDocument()
    expect(
      screen.getByText('audit footnote — counts over 7 done tasks, no score')
    ).toBeInTheDocument()

    // All three groups with their summary chips.
    expect(screen.getByText('Verification friction')).toBeInTheDocument()
    expect(screen.getByText('6/7 clean')).toBeInTheDocument()
    expect(screen.getByText('Claim faithfulness')).toBeInTheDocument()
    expect(screen.getByText('0 overstated')).toBeInTheDocument()
    expect(screen.getByText('Criteria referent kind')).toBeInTheDocument()
    expect(screen.getByText('9 self-confirming+')).toBeInTheDocument()

    // Every bucket stays visible — zero-count rows dim, never disappear.
    expect(screen.getByText('Multi-round or send-back')).toBeInTheDocument()
    expect(
      screen.getByText('Multi-round or send-back').parentElement
    ).toHaveClass('text-muted-foreground')
    expect(screen.getByText('Single round').parentElement).not.toHaveClass(
      'text-muted-foreground'
    )

    // Explicit absence buckets: unjudged + no-record + no-frozen-contract.
    expect(screen.getByText('Not judged')).toBeInTheDocument()
    expect(screen.getByText('No verification record')).toBeInTheDocument()
    expect(screen.getByText('No frozen contract (tasks)')).toBeInTheDocument()

    // Counts only — no percentage is ever rendered.
    expect(document.body.textContent).not.toContain('%')

    // The counts themselves.
    expect(screen.getByText('14')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('renders the explicit empty state when the milestone has no done task', () => {
    render(
      <MilestoneOutcomeSection
        greenQuality={{
          doneCount: 0,
          friction: {
            noVerification: 0,
            singleRound: 0,
            multiRoundOrSendback: 0,
          },
          faithfulness: {
            faithful: 0,
            overstated: 0,
            underReported: 0,
            unjudged: 0,
          },
          referentKind: {
            externallyAnchored: 0,
            selfConfirming: 0,
            other: 0,
            noSnapshotTasks: 0,
          },
        }}
      />
    )
    expect(
      screen.getByText(
        'No done tasks yet — acceptance quality appears once deliveries land.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText('Verification friction')).not.toBeInTheDocument()
  })

  it('renders nothing on a pre-LUM-639 payload', () => {
    const { container } = render(
      <MilestoneOutcomeSection greenQuality={undefined} />
    )
    expect(container).toBeEmptyDOMElement()
  })
})

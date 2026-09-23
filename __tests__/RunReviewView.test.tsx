/**
 * @jest-environment jsdom
 *
 * LUM-819 (D): 抽查页的两条设计约束——证据排在认可/打回按钮之前；虚报率永远
 * 带分子分母，样本不足时不给百分比。
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  const fill = (id: string, values?: Record<string, unknown>) => {
    let raw = messages[id] ?? id
    for (const [k, v] of Object.entries(values ?? {}))
      raw = raw.split(`{${k}}`).join(String(v))
    return raw
  }
  return {
    useIntl: () => ({
      formatMessage: (
        { id }: { id: string },
        values?: Record<string, unknown>
      ) => fill(id, values),
      formatNumber: (n: number) => `${Math.round(n * 100)}%`,
      formatDate: () => 'Sep 23, 2026',
    }),
  }
})
jest.mock('@/app/workspace/[workspaceUrl]/components/PageBreadcrumb', () => ({
  PageBreadcrumb: ({ title }: { title: string }) => <h1>{title}</h1>,
}))

import { RunReviewView } from '@/app/workspace/[workspaceUrl]/components/pages/RunReviewView'
import type { ReviewPoolView } from '@/lib/api-client'

const ITEM = {
  runId: 'run-1',
  taskIdentifier: 'LUM-42',
  taskTitle: 'Login',
  caseNumber: 3,
  caseTitle: 'login works',
  environment: 'PRODUCTION' as const,
  commitSha: 'abcdef1234',
  commitDirty: false,
  note: null,
  evidence: [
    { type: 'link', url: 'https://example.test/log', label: 'ci log' },
  ],
  recordedAt: '2026-09-23T08:00:00.000Z',
}

function renderView(pool: ReviewPoolView, onReview = jest.fn()) {
  render(
    <RunReviewView
      pool={pool}
      loading={false}
      error={null}
      onReload={jest.fn()}
      reviewingRunId={null}
      reviewError={null}
      onReview={onReview}
    />
  )
  return onReview
}

describe('RunReviewView', () => {
  it('puts the evidence before the ruling buttons and sends the ruling', () => {
    const onReview = renderView({
      sample: [ITEM],
      poolSize: 7,
      rate: { status: 'insufficient', reviewed: 2, rejected: 1, minSample: 10 },
    })
    const evidence = screen.getByRole('list', { name: /evidence/i })
    const accept = screen.getByRole('button', { name: 'Evidence holds' })
    expect(
      evidence.compareDocumentPosition(accept) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Why? (optional)'), {
      target: { value: 'log shows the redirect' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send back' }))
    expect(onReview).toHaveBeenCalledWith(
      'run-1',
      false,
      'log shows the redirect'
    )
  })

  it('states the sample size with the rate, and withholds a percentage when thin', () => {
    renderView({
      sample: [ITEM],
      poolSize: 7,
      rate: { status: 'insufficient', reviewed: 2, rejected: 1, minSample: 10 },
    })
    const thin = screen.getByText(/Not enough reviews/)
    expect(thin).toHaveTextContent('2 of the 10 needed, 1 sent back so far')
    expect(thin.textContent).not.toMatch(/%/)
  })

  it('shows numerator and denominator next to a measured rate', () => {
    renderView({
      sample: [],
      poolSize: 0,
      rate: { status: 'measured', reviewed: 20, rejected: 3, rate: 0.15 },
    })
    expect(
      screen.getByText(
        '3 of 20 reviewed passes sent back — 15% false-report rate'
      )
    ).toBeInTheDocument()
  })
})

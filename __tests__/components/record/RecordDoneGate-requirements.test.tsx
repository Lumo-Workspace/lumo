/**
 * LUM-1334 — the Record tab's Done gate shows a "Required before Done" row
 * only while a requirement switch is on: each PR and what it lacks when
 * blocked, what is required when clear. The row has no "go act" link.
 */
import { render, screen } from '@testing-library/react'
import { RecordDoneGate } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/RecordDoneGate'
import { deriveDoneGate } from '@/lib/acceptance/done-gate'

jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      formatMessage: (
        { id }: { id: string },
        values?: Record<string, unknown>
      ) => {
        const text = messages[id]
        if (text === undefined) throw new Error(`missing message ${id}`)
        return text.replace(/\{(\w+)[^}]*\}/g, (_, k: string) =>
          String(values?.[k] ?? '')
        )
      },
    }),
  }
})

const gaps = {
  crossingsOpen: 0,
  crossingsBlocking: 0,
  crossingsTotal: 0,
  securityBlocking: 0,
  testsBlocking: 0,
  taskDone: false,
}

it('has no requirements row while the switches are off', () => {
  render(
    <RecordDoneGate
      gate={deriveDoneGate(gaps, { securityScanned: true })}
      queueAnchor='q'
    />
  )
  expect(screen.queryByTestId('gate-requirements')).toBeNull()
})

it('lists each missing requirement and blocks, without a go-act link', () => {
  render(
    <RecordDoneGate
      gate={deriveDoneGate(gaps, {
        securityScanned: true,
        requirements: {
          switches: { testCase: true, review: true },
          missing: [
            { requirement: 'TEST_CASE', prNumber: 12 },
            { requirement: 'REVIEW', prNumber: 13 },
          ],
        },
      })}
      queueAnchor='q'
    />
  )
  const row = screen.getByTestId('gate-requirements')
  expect(row).toHaveAttribute('data-blocked', 'true')
  expect(row).toHaveTextContent('Required before Done')
  expect(row).toHaveTextContent(
    'PR #12 needs a passing test case · PR #13 needs a review'
  )
  expect(row.querySelector('a')).toBeNull()
  expect(screen.getByTestId('record-done-gate')).toHaveAttribute(
    'data-headline',
    'blocked'
  )
})

it('says what is required when every PR meets it', () => {
  render(
    <RecordDoneGate
      gate={deriveDoneGate(gaps, {
        securityScanned: true,
        requirements: {
          switches: { testCase: false, review: true },
          missing: [],
        },
      })}
      queueAnchor={null}
    />
  )
  const row = screen.getByTestId('gate-requirements')
  expect(row).toHaveAttribute('data-blocked', 'false')
  expect(row).toHaveTextContent(
    "A review on every pull request's latest commit"
  )
})

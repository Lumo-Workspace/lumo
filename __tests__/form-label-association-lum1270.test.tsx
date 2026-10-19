/**
 * @jest-environment jsdom
 *
 * LUM-1270: the test-case forms moved from wrapping <label>s to the shared
 * Label primitive with htmlFor ↔ id. Every field must still be reachable by
 * its visible label.
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { installRadixSelectShims } from './helpers/radix-select'

installRadixSelectShims()

jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      locale: 'en',
      formatMessage: ({ id }: { id: string }) => messages[id] ?? id,
    }),
  }
})

import { TestCaseForm } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TestCaseForm'
import { RecordRunDialog } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/RecordRunDialog'
import en from '@/lib/i18n/en.json'

const t = (id: string) => (en as Record<string, string>)[id] as string

test('TestCaseForm: every field is labelled', () => {
  render(<TestCaseForm onSubmit={jest.fn()} onCancel={jest.fn()} />)
  expect(screen.getByLabelText(t('testCases.form.title')).tagName).toBe('INPUT')
  expect(screen.getByLabelText(t('testCases.form.setup')).tagName).toBe(
    'TEXTAREA'
  )
  expect(screen.getByLabelText(t('testCases.form.expected')).tagName).toBe(
    'TEXTAREA'
  )
  expect(
    screen.getByLabelText(t('testCases.form.requiresEnv'))
  ).toHaveAttribute('role', 'combobox')
})

test('RecordRunDialog: every field is labelled', () => {
  render(
    <RecordRunDialog
      testCase={
        {
          id: 'tc-1',
          steps: [],
          verification: [],
        } as never
      }
      pullRequests={[]}
      onSubmit={jest.fn()}
      onClose={jest.fn()}
    />
  )
  for (const id of [
    'testCases.field.result',
    'testCases.field.environment',
    'testCases.field.pullRequest',
  ]) {
    expect(screen.getByLabelText(t(id))).toHaveAttribute('role', 'combobox')
  }
  expect(screen.getByLabelText(t('testCases.field.note')).tagName).toBe(
    'TEXTAREA'
  )
  expect(
    screen.getByLabelText(t('testCases.field.evidenceFiles'))
  ).toHaveAttribute('type', 'file')
})

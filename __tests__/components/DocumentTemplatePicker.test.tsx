/** @jest-environment jsdom */
const messages: Record<string, string> = {
  'documents.selectTemplate': 'Choose a template',
  'documents.templateBlank': 'Blank document',
  'documents.templateBlankDesc': 'Start from scratch',
  'documents.template.prd': 'PRD',
  'documents.template.prdDesc': 'Product requirements',
  'documents.template.meetingNotes': 'Meeting notes',
  'documents.template.meetingNotesDesc': 'Agenda and action items',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => messages[id] ?? id,
  }),
}))

import { render, screen, fireEvent } from '@testing-library/react'
import {
  DocumentTemplatePicker,
  type PickerTemplate,
} from '@/app/workspace/[workspaceUrl]/components/document/DocumentTemplatePicker'

const templates: PickerTemplate[] = [
  { id: 't_prd', key: 'prd', emoji: '📋', content: '<h1>PRD</h1>' },
  {
    id: 't_meet',
    key: 'meeting-notes',
    emoji: '📝',
    content: '<h1>会议纪要</h1>',
  },
]

function renderPicker(onSelect = jest.fn()) {
  render(
    <DocumentTemplatePicker
      open
      onOpenChange={() => {}}
      templates={templates}
      loading={false}
      onSelect={onSelect}
    />
  )
  return onSelect
}

describe('DocumentTemplatePicker', () => {
  it('renders a blank card plus one card per template', () => {
    renderPicker()
    expect(screen.getByText('Blank document')).toBeInTheDocument()
    expect(screen.getByText('PRD')).toBeInTheDocument()
    expect(screen.getByText('Meeting notes')).toBeInTheDocument()
  })

  it('calls onSelect(null) when the blank card is clicked', () => {
    const onSelect = renderPicker()
    fireEvent.click(screen.getByText('Blank document'))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('calls onSelect(template) when a template card is clicked', () => {
    const onSelect = renderPicker()
    fireEvent.click(screen.getByText('PRD'))
    expect(onSelect).toHaveBeenCalledWith(templates[0])
  })
})

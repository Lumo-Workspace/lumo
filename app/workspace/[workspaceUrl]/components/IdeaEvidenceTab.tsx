'use client'

import { Accordion } from '@/components/landing/ui/accordion'
import { IdeaSlackSection } from './idea-evidence-sections/IdeaSlackSection'
import { IdeaWebLinkSection } from './idea-evidence-sections/IdeaWebLinkSection'
import { IdeaFigmaSection } from './idea-evidence-sections/IdeaFigmaSection'

interface Props {
  ideaId: string
  slackConnected: boolean
}

/**
 * Idea detail's Evidence tab (LUM-681, criterion 3). Mirrors the Task
 * detail's `ContextTab` — an Accordion hosting the same source-card sections
 * (Slack / Web Links / Figma), each backed by the idea-scoped hooks from
 * Task 7 and reusing the owner-agnostic cards + popovers + `ContextSection`
 * shell from the Task variant (no forking).
 */
export function IdeaEvidenceTab({
  ideaId,
  slackConnected,
}: Props): React.ReactElement {
  return (
    <Accordion type='multiple' defaultValue={['webLinks', 'slack', 'figma']}>
      <IdeaSlackSection ideaId={ideaId} slackConnected={slackConnected} />
      <IdeaWebLinkSection ideaId={ideaId} />
      <IdeaFigmaSection ideaId={ideaId} />
    </Accordion>
  )
}

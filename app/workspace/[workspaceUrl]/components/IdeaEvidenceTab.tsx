'use client'

import { Accordion } from '@/components/landing/ui/accordion'
import { IdeaSlackSection } from './idea-evidence-sections/IdeaSlackSection'
import { IdeaWebLinkSection } from './idea-evidence-sections/IdeaWebLinkSection'
import { IdeaFigmaSection } from './idea-evidence-sections/IdeaFigmaSection'
import { IdeaPullRequestSection } from './idea-evidence-sections/IdeaPullRequestSection'

interface Props {
  ideaId: string
}

/**
 * Idea detail's Evidence tab (LUM-681, criterion 3). Mirrors the Task
 * detail's `ContextTab` — an Accordion hosting the same source-card sections
 * (Slack / Web Links / Figma), each backed by the idea-scoped hooks from
 * Task 7 and reusing the owner-agnostic cards + popovers + `ContextSection`
 * shell from the Task variant (no forking).
 *
 * Each section reads whatever workspace integration it needs for itself
 * (LUM-684) — integration state is a workspace asset to consume, not something
 * to prop-drill from a page that never had it.
 */
export function IdeaEvidenceTab({ ideaId }: Props): React.ReactElement {
  return (
    <Accordion
      type='multiple'
      defaultValue={['webLinks', 'slack', 'figma', 'pullRequests']}
    >
      <IdeaSlackSection ideaId={ideaId} />
      <IdeaWebLinkSection ideaId={ideaId} />
      <IdeaFigmaSection ideaId={ideaId} />
      <IdeaPullRequestSection ideaId={ideaId} />
    </Accordion>
  )
}

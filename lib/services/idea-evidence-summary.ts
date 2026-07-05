import { ideaSlackContextRepository } from '@/lib/repositories/idea-slack-context.repository'
import { ideaWebLinkRepository } from '@/lib/repositories/idea-web-link.repository'
import { ideaFigmaLinkRepository } from '@/lib/repositories/idea-figma-link.repository'

/**
 * Short, human-readable summary of the evidence (Slack/web/Figma sources)
 * attached to a single idea. Shared by the Stage-1 clustering runner (LUM-681
 * Task 9) and the Stage-2 alignment runner (Task 10) so both feed the LLM the
 * same evidence lines rather than duplicating the read + formatting logic.
 */
export interface IdeaEvidenceSummary {
  /** One line per attached Slack context, e.g. "slack: 3 msg(s) in #design". */
  slack: string[]
  /** One line per attached web link, e.g. "web: Article Title". */
  web: string[]
  /** One line per attached Figma link, e.g. "figma: Design File · Cover". */
  figma: string[]
  /** Total number of attached evidence items across all three channels. */
  sourceCount: number
  /** Which channels have at least one attached item, in slack/web/figma order. */
  channels: Array<'slack' | 'web' | 'figma'>
}

function summariseSlack(
  contexts: Awaited<ReturnType<typeof ideaSlackContextRepository.listByIdea>>
): string[] {
  return contexts.map(ctx => {
    const count = Array.isArray(ctx.snapshot)
      ? 0
      : ((ctx.snapshot as { messages?: unknown[] } | null)?.messages?.length ??
        0)
    const channel = ctx.slackChannelName ?? ctx.slackChannelId
    return `slack: ${count} msg(s) in #${channel}`
  })
}

function summariseWeb(
  links: Awaited<ReturnType<typeof ideaWebLinkRepository.listByIdea>>
): string[] {
  return links.map(link => `web: ${link.title || link.domain}`)
}

function summariseFigma(
  links: Awaited<ReturnType<typeof ideaFigmaLinkRepository.listByIdea>>
): string[] {
  return links.map(link =>
    link.frameName
      ? `figma: ${link.fileName} · ${link.frameName}`
      : `figma: ${link.fileName}`
  )
}

/**
 * Gather and format all evidence attached to a single idea. Read-only —
 * callers should treat any thrown error as "evidence unavailable" and fail
 * soft (see `plan-cluster-runner.ts`), not fail the whole stage.
 */
export async function summariseIdeaEvidence(
  ideaId: string
): Promise<IdeaEvidenceSummary> {
  const [slackContexts, webLinks, figmaLinks] = await Promise.all([
    ideaSlackContextRepository.listByIdea(ideaId),
    ideaWebLinkRepository.listByIdea(ideaId),
    ideaFigmaLinkRepository.listByIdea(ideaId),
  ])

  const slack = summariseSlack(slackContexts)
  const web = summariseWeb(webLinks)
  const figma = summariseFigma(figmaLinks)

  const channels: Array<'slack' | 'web' | 'figma'> = []
  if (slack.length) channels.push('slack')
  if (web.length) channels.push('web')
  if (figma.length) channels.push('figma')

  return {
    slack,
    web,
    figma,
    sourceCount: slack.length + web.length + figma.length,
    channels,
  }
}

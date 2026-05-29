'use client'

import { useIntl } from 'react-intl'
import { TaskArtifactAgent } from '@prisma/client'
import { ClaudeCodeIcon } from '@/components/icons/agents/ClaudeCodeIcon'
import { CodexIcon } from '@/components/icons/agents/CodexIcon'
import { CursorIcon } from '@/components/icons/agents/CursorIcon'
import { GeminiIcon } from '@/components/icons/agents/GeminiIcon'
import { GitHubCopilotIcon } from '@/components/icons/agents/GitHubCopilotIcon'
import { WindsurfIcon } from '@/components/icons/agents/WindsurfIcon'

type IconComponent = (props: {
  size?: number
  className?: string
}) => React.ReactElement

interface AgentMeta {
  Icon: IconComponent
  /** brand color applied to the icon (and the chip tint) */
  color: string
}

export const AGENT_META: Record<TaskArtifactAgent, AgentMeta> = {
  [TaskArtifactAgent.CLAUDE_CODE]: { Icon: ClaudeCodeIcon, color: '#D97757' },
  [TaskArtifactAgent.CODEX]: { Icon: CodexIcon, color: '#111827' },
  [TaskArtifactAgent.CURSOR]: { Icon: CursorIcon, color: '#475569' },
  [TaskArtifactAgent.GEMINI_CLI]: { Icon: GeminiIcon, color: '#3186FF' },
  [TaskArtifactAgent.GITHUB_COPILOT]: {
    Icon: GitHubCopilotIcon,
    color: '#1F2937',
  },
  [TaskArtifactAgent.WINDSURF]: { Icon: WindsurfIcon, color: '#0D9488' },
}

/** Localized label for an agent (taskArtifact.agent.<ENUM>). */
export function useAgentLabel(agent: TaskArtifactAgent): string {
  const intl = useIntl()
  return intl.formatMessage({ id: `taskArtifact.agent.${agent}` })
}

/** Row badge: brand icon + label. */
export function AgentBadge({ agent }: { agent: TaskArtifactAgent }) {
  const { Icon, color } = AGENT_META[agent]
  const label = useAgentLabel(agent)
  return (
    <span className='inline-flex items-center gap-1.5 text-xs text-muted-foreground shrink-0'>
      <span
        className='inline-flex size-5 items-center justify-center rounded-full'
        style={{ backgroundColor: `${color}1A`, color }}
      >
        <Icon size={12} />
      </span>
      {label}
    </span>
  )
}

/** Icon-only avatar for the header stack. */
export function AgentAvatar({ agent }: { agent: TaskArtifactAgent }) {
  const { Icon, color } = AGENT_META[agent]
  return (
    <span
      className='inline-flex size-5 items-center justify-center rounded-full ring-2 ring-background'
      style={{ backgroundColor: `${color}1A`, color }}
    >
      <Icon size={12} />
    </span>
  )
}

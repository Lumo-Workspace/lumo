import type { MessageDescriptor } from 'react-intl'
import type {
  AttributionConfidenceName,
  AttributionSourceName,
  SignalKindName,
} from '../../types'

export const SOURCE_MESSAGES: Record<AttributionSourceName, MessageDescriptor> =
  {
    SESSION_ATTACH: {
      id: 'agentRun.attribution.source.SESSION_ATTACH',
      defaultMessage: 'Session attached with lumo session attach',
    },
    SUBAGENT_ATTACH: {
      id: 'agentRun.attribution.source.SUBAGENT_ATTACH',
      defaultMessage: 'Subagent attached with lumo session attach',
    },
    INHERITED: {
      id: 'agentRun.attribution.source.INHERITED',
      defaultMessage: "Inherited from the parent session's binding",
    },
    INFERRED: {
      id: 'agentRun.attribution.source.INFERRED',
      defaultMessage: 'Auto-detected from signals',
    },
  }

export const CONFIDENCE_MESSAGES: Record<
  AttributionConfidenceName,
  MessageDescriptor
> = {
  EXPLICIT: {
    id: 'agentRun.attribution.confidence.EXPLICIT',
    defaultMessage: 'Explicit',
  },
  HIGH: {
    id: 'agentRun.attribution.confidence.HIGH',
    defaultMessage: 'High confidence',
  },
  MEDIUM: {
    id: 'agentRun.attribution.confidence.MEDIUM',
    defaultMessage: 'Medium confidence',
  },
}

export const SIGNAL_MESSAGES: Record<SignalKindName, MessageDescriptor> = {
  BRANCH: {
    id: 'agentRun.attribution.signal.BRANCH',
    defaultMessage: 'Branch name',
  },
  LUMO_CMD: {
    id: 'agentRun.attribution.signal.LUMO_CMD',
    defaultMessage: 'Lumo command',
  },
  COMMIT: {
    id: 'agentRun.attribution.signal.COMMIT',
    defaultMessage: 'Commit message',
  },
  PR_CREATE: {
    id: 'agentRun.attribution.signal.PR_CREATE',
    defaultMessage: 'Pull request created',
  },
  PROMPT: {
    id: 'agentRun.attribution.signal.PROMPT',
    defaultMessage: 'Mentioned in the prompt',
  },
  GIT_HINT: {
    id: 'agentRun.attribution.signal.GIT_HINT',
    defaultMessage: 'Git state at session start',
  },
  AGENT_PROMPT: {
    id: 'agentRun.attribution.signal.AGENT_PROMPT',
    defaultMessage: 'Subagent dispatch prompt',
  },
}

export const MODE_MESSAGES: Record<
  'EXPLICIT' | 'INFERRED' | 'HOST',
  MessageDescriptor
> = {
  EXPLICIT: {
    id: 'agentRun.attribution.mode.EXPLICIT',
    defaultMessage: 'Bound',
  },
  INFERRED: {
    id: 'agentRun.attribution.mode.INFERRED',
    defaultMessage: 'Auto-detected',
  },
  HOST: {
    id: 'agentRun.attribution.mode.HOST',
    defaultMessage: 'Hosts subagents',
  },
}

export const APPROXIMATE_NOTICE: MessageDescriptor = {
  id: 'agentRun.attribution.approximateNotice',
  defaultMessage:
    "Measurement may be inaccurate: this work wasn't bound with lumo session attach, so its time and token cost were split by auto-detection. Attach the session or subagent for exact numbers.",
}

export const APPROXIMATE_LABEL: MessageDescriptor = {
  id: 'agentRun.attribution.approximate',
  defaultMessage: '≈ approximate',
}

export const PANEL_TITLE: MessageDescriptor = {
  id: 'agentRun.attribution.title',
  defaultMessage: 'Why this run is on this task',
}

export const TURNS_MESSAGE: MessageDescriptor = {
  id: 'agentRun.attribution.turns',
  defaultMessage: 'Turns {fromN}–{toN}',
}

export const TURN_MESSAGE: MessageDescriptor = {
  id: 'agentRun.attribution.turn',
  defaultMessage: 'Turn {n}',
}

export const SUBAGENTS_MESSAGE: MessageDescriptor = {
  id: 'agentRun.attribution.subagents',
  defaultMessage: 'Subagents',
}

export const SUBAGENT_UNKNOWN_TYPE: MessageDescriptor = {
  id: 'agentRun.attribution.subagentUnknownType',
  defaultMessage: 'subagent',
}

export const NO_SIGNAL: MessageDescriptor = {
  id: 'agentRun.attribution.noSignal',
  defaultMessage: 'No recorded signal',
}

export const FOLLOWS_PARENT: MessageDescriptor = {
  id: 'agentRun.attribution.followsParent',
  defaultMessage: "Follows the parent session's attribution",
}

export const SUBAGENT_COUNT: MessageDescriptor = {
  id: 'agentRun.attribution.subagentCount',
  defaultMessage: '{label} ×{count}',
}

export const EVIDENCE_COUNT: MessageDescriptor = {
  id: 'agentRun.attribution.evidenceCount',
  defaultMessage: '{label} ×{count}',
}

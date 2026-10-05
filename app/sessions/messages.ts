import type { MessageDescriptor } from 'react-intl'

/** Message descriptors for the /sessions pages. Plain objects (not defineMessages) keep react-intl test mocks working. */
export const SESSION_MESSAGES = {
  'list.title': { id: 'sessions.list.title', defaultMessage: 'Sessions' },
  'list.recent': {
    id: 'sessions.list.recent',
    defaultMessage: '{count} recent',
  },
  'list.empty': {
    id: 'sessions.list.empty',
    defaultMessage:
      'No sessions yet. Run Claude Code from a directory with Lumo hooks configured to see activity here.',
  },
  'list.noCwd': { id: 'sessions.list.noCwd', defaultMessage: 'no cwd' },
  'list.events': {
    id: 'sessions.list.events',
    defaultMessage: '{count, plural, one {# event} other {# events}}',
  },
  'list.familySummary': {
    id: 'sessions.list.familySummary',
    defaultMessage:
      '{subagents, plural, one {# subagent} other {# subagents}} · {tasks, plural, one {# task} other {# tasks}}',
  },
  'detail.back': { id: 'sessions.detail.back', defaultMessage: '← Sessions' },
  'detail.started': {
    id: 'sessions.detail.started',
    defaultMessage: 'Started',
  },
  'detail.lastActivity': {
    id: 'sessions.detail.lastActivity',
    defaultMessage: 'Last activity',
  },
  'detail.duration': {
    id: 'sessions.detail.duration',
    defaultMessage: 'Duration',
  },
  'detail.toolCalls': {
    id: 'sessions.detail.toolCalls',
    defaultMessage: 'Tool calls',
  },
  'detail.errors': { id: 'sessions.detail.errors', defaultMessage: 'Errors' },
  'detail.durationMin': {
    id: 'sessions.detail.durationMin',
    defaultMessage: '{n} min',
  },
  'detail.otherMember': {
    id: 'sessions.detail.otherMember',
    defaultMessage:
      "This is {name}'s session. You can see it because you are an owner of this workspace; other members can't.",
  },
  'detail.otherMemberUnknown': {
    id: 'sessions.detail.otherMemberUnknown',
    defaultMessage:
      "This is another member's session. You can see it because you are an owner of this workspace; other members can't.",
  },
  'attribution.title': {
    id: 'sessions.attribution.title',
    defaultMessage: 'Task attribution',
  },
  'attribution.unattributed': {
    id: 'sessions.attribution.unattributed',
    defaultMessage:
      "Unattributed — no task signal was found for this session's own turns.",
  },
  'attribution.subagents': {
    id: 'sessions.attribution.subagents',
    defaultMessage: 'Subagents',
  },
  'attribution.subagentNoTask': {
    id: 'sessions.attribution.subagentNoTask',
    defaultMessage: 'follows parent',
  },
  'timeline.heading': {
    id: 'sessions.timeline.heading',
    defaultMessage: 'Timeline · click to expand',
  },
  'timeline.empty': {
    id: 'sessions.timeline.empty',
    defaultMessage: 'No events yet for this session.',
  },
  'timeline.kindStop': {
    id: 'sessions.timeline.kindStop',
    defaultMessage: 'Stop',
  },
  'timeline.kindYou': {
    id: 'sessions.timeline.kindYou',
    defaultMessage: 'You',
  },
  'timeline.kindTool': {
    id: 'sessions.timeline.kindTool',
    defaultMessage: 'tool',
  },
  'timeline.truncated': {
    id: 'sessions.timeline.truncated',
    defaultMessage: '(showing {shown} of {total} lines)',
  },
  'summary.title': { id: 'sessions.summary.title', defaultMessage: 'Summary' },
  'summary.generated': {
    id: 'sessions.summary.generated',
    defaultMessage: 'generated {when}',
  },
  'summary.stale': {
    id: 'sessions.summary.stale',
    defaultMessage: 'stale (+{count, plural, one {# event} other {# events}})',
  },
  'summary.generating': {
    id: 'sessions.summary.generating',
    defaultMessage: 'Generating…',
  },
  'summary.regenerate': {
    id: 'sessions.summary.regenerate',
    defaultMessage: 'Regenerate',
  },
  'summary.generate': {
    id: 'sessions.summary.generate',
    defaultMessage: 'Generate summary',
  },
  'summary.generateFailed': {
    id: 'sessions.summary.generateFailed',
    defaultMessage: 'Failed to generate summary',
  },
  'summary.aiDerivedOff': {
    id: 'sessions.summary.aiDerivedOff',
    defaultMessage:
      'AI summaries are turned off for this workspace. An owner can turn them back on in Settings → Data retention.',
  },
  'summary.empty': {
    id: 'sessions.summary.empty',
    defaultMessage:
      'No summary yet. Click <strong>Generate summary</strong> to have Claude describe what this session accomplished.',
  },
  'summary.relJustNow': {
    id: 'sessions.summary.relJustNow',
    defaultMessage: 'just now',
  },
  'summary.relMinutes': {
    id: 'sessions.summary.relMinutes',
    defaultMessage: '{n} min ago',
  },
  'summary.relHours': {
    id: 'sessions.summary.relHours',
    defaultMessage: '{n}h ago',
  },
  'summary.relDays': {
    id: 'sessions.summary.relDays',
    defaultMessage: '{n}d ago',
  },
  'summary.notDescribed': {
    id: 'sessions.summary.notDescribed',
    defaultMessage: 'not described',
  },
  'summary.noGoal': {
    id: 'sessions.summary.noGoal',
    defaultMessage: 'no goal',
  },
  'summary.whatExplored': {
    id: 'sessions.summary.whatExplored',
    defaultMessage: 'What was explored',
  },
  'summary.keyFindings': {
    id: 'sessions.summary.keyFindings',
    defaultMessage: 'Key findings',
  },
  'summary.filesExamined': {
    id: 'sessions.summary.filesExamined',
    defaultMessage: 'Files examined',
  },
  'summary.nextSteps': {
    id: 'sessions.summary.nextSteps',
    defaultMessage: 'Next steps',
  },
  'summary.goal': { id: 'sessions.summary.goal', defaultMessage: 'Goal' },
  'summary.accomplished': {
    id: 'sessions.summary.accomplished',
    defaultMessage: 'Accomplished',
  },
  'summary.keyChanges': {
    id: 'sessions.summary.keyChanges',
    defaultMessage: 'Key changes',
  },
  'summary.unresolved': {
    id: 'sessions.summary.unresolved',
    defaultMessage: 'Unresolved',
  },
  'summary.problem': {
    id: 'sessions.summary.problem',
    defaultMessage: 'Problem',
  },
  'summary.rootCause': {
    id: 'sessions.summary.rootCause',
    defaultMessage: 'Root cause',
  },
  'summary.fixApplied': {
    id: 'sessions.summary.fixApplied',
    defaultMessage: 'Fix applied',
  },
  'summary.verification': {
    id: 'sessions.summary.verification',
    defaultMessage: 'Verification',
  },
  'summary.refactorGoal': {
    id: 'sessions.summary.refactorGoal',
    defaultMessage: 'Refactor goal',
  },
  'summary.changes': {
    id: 'sessions.summary.changes',
    defaultMessage: 'Changes',
  },
  'summary.scope': { id: 'sessions.summary.scope', defaultMessage: 'Scope' },
  'summary.scopeLine': {
    id: 'sessions.summary.scopeLine',
    defaultMessage:
      '{count, plural, one {# file} other {# files}} · +{added} -{removed}',
  },
  'summary.behaviorPreservation': {
    id: 'sessions.summary.behaviorPreservation',
    defaultMessage: 'Behavior preservation',
  },
  'summary.followUps': {
    id: 'sessions.summary.followUps',
    defaultMessage: 'Follow-ups',
  },
  'summary.reviewScope': {
    id: 'sessions.summary.reviewScope',
    defaultMessage: 'Review scope',
  },
  'summary.findings': {
    id: 'sessions.summary.findings',
    defaultMessage: 'Findings',
  },
  'summary.bySeverity': {
    id: 'sessions.summary.bySeverity',
    defaultMessage: 'By severity',
  },
  'summary.critical': {
    id: 'sessions.summary.critical',
    defaultMessage: 'Critical',
  },
  'summary.improvements': {
    id: 'sessions.summary.improvements',
    defaultMessage: 'Improvements',
  },
  'summary.notes': { id: 'sessions.summary.notes', defaultMessage: 'Notes' },
  'summary.recommendations': {
    id: 'sessions.summary.recommendations',
    defaultMessage: 'Recommendations',
  },
  'summary.overview': {
    id: 'sessions.summary.overview',
    defaultMessage: 'Overview',
  },
  'summary.mainActivities': {
    id: 'sessions.summary.mainActivities',
    defaultMessage: 'Main activities',
  },
  'summary.statusFixed': {
    id: 'sessions.summary.statusFixed',
    defaultMessage: 'fixed',
  },
  'summary.statusPartial': {
    id: 'sessions.summary.statusPartial',
    defaultMessage: 'partial',
  },
  'summary.statusUnresolved': {
    id: 'sessions.summary.statusUnresolved',
    defaultMessage: 'unresolved',
  },
  'summary.typeExploration': {
    id: 'sessions.summary.typeExploration',
    defaultMessage: 'exploration',
  },
  'summary.typeImplementation': {
    id: 'sessions.summary.typeImplementation',
    defaultMessage: 'implementation',
  },
  'summary.typeDebug': {
    id: 'sessions.summary.typeDebug',
    defaultMessage: 'debug',
  },
  'summary.typeRefactor': {
    id: 'sessions.summary.typeRefactor',
    defaultMessage: 'refactor',
  },
  'summary.typeReview': {
    id: 'sessions.summary.typeReview',
    defaultMessage: 'review',
  },
  'summary.typeMixed': {
    id: 'sessions.summary.typeMixed',
    defaultMessage: 'mixed',
  },
  'timeline.pruned': {
    id: 'sessions.timeline.pruned',
    defaultMessage: 'Content cleared per retention policy',
  },
  'timeline.deleted': {
    id: 'sessions.timeline.deleted',
    defaultMessage: 'Raw record deleted',
  },
  'timeline.block.prompt': {
    id: 'sessions.timeline.block.prompt',
    defaultMessage: 'prompt',
  },
  'timeline.block.rawWithContext': {
    id: 'sessions.timeline.block.rawWithContext',
    defaultMessage: 'raw (with injected context)',
  },
  'timeline.block.lastMessage': {
    id: 'sessions.timeline.block.lastMessage',
    defaultMessage: 'last message',
  },
  'timeline.block.command': {
    id: 'sessions.timeline.block.command',
    defaultMessage: 'command',
  },
  'timeline.block.stdout': {
    id: 'sessions.timeline.block.stdout',
    defaultMessage: 'stdout',
  },
  'timeline.block.stderr': {
    id: 'sessions.timeline.block.stderr',
    defaultMessage: 'stderr',
  },
  'timeline.block.status': {
    id: 'sessions.timeline.block.status',
    defaultMessage: 'status',
  },
  'timeline.block.content': {
    id: 'sessions.timeline.block.content',
    defaultMessage: 'content',
  },
  'timeline.block.diff': {
    id: 'sessions.timeline.block.diff',
    defaultMessage: 'diff',
  },
  'timeline.block.old': {
    id: 'sessions.timeline.block.old',
    defaultMessage: 'old',
  },
  'timeline.block.new': {
    id: 'sessions.timeline.block.new',
    defaultMessage: 'new',
  },
  'timeline.block.matches': {
    id: 'sessions.timeline.block.matches',
    defaultMessage: 'matches',
  },
  'timeline.block.response': {
    id: 'sessions.timeline.block.response',
    defaultMessage: 'response',
  },
  'timeline.block.files': {
    id: 'sessions.timeline.block.files',
    defaultMessage: 'files',
  },
  'timeline.block.todos': {
    id: 'sessions.timeline.block.todos',
    defaultMessage: 'todos',
  },
  'timeline.block.input': {
    id: 'sessions.timeline.block.input',
    defaultMessage: 'input',
  },
  'timeline.summary.emptyPrompt': {
    id: 'sessions.timeline.summary.emptyPrompt',
    defaultMessage: '(empty prompt)',
  },
  'timeline.summary.modelStopped': {
    id: 'sessions.timeline.summary.modelStopped',
    defaultMessage: 'model stopped',
  },
  'timeline.summary.noInput': {
    id: 'sessions.timeline.summary.noInput',
    defaultMessage: '(no input)',
  },
  'timeline.summary.noPath': {
    id: 'sessions.timeline.summary.noPath',
    defaultMessage: '(no path)',
  },
  'timeline.summary.todos': {
    id: 'sessions.timeline.summary.todos',
    defaultMessage: '{count, plural, one {# todo} other {# todos}}',
  },
  'timeline.summary.grepIn': {
    id: 'sessions.timeline.summary.grepIn',
    defaultMessage: '{pattern} in {path}',
  },
  'timeline.badge.interrupted': {
    id: 'sessions.timeline.badge.interrupted',
    defaultMessage: 'interrupted',
  },
  'timeline.badge.stderr': {
    id: 'sessions.timeline.badge.stderr',
    defaultMessage: 'stderr',
  },
  'timeline.badge.noMatch': {
    id: 'sessions.timeline.badge.noMatch',
    defaultMessage: 'no match',
  },
  'timeline.badge.lines': {
    id: 'sessions.timeline.badge.lines',
    defaultMessage: '{count, plural, one {# line} other {# lines}}',
  },
  'timeline.badge.linesWithType': {
    id: 'sessions.timeline.badge.linesWithType',
    defaultMessage: '{type} · {count, plural, one {# line} other {# lines}}',
  },
  'timeline.badge.files': {
    id: 'sessions.timeline.badge.files',
    defaultMessage: '{count, plural, one {# file} other {# files}}',
  },
  'timeline.badge.matches': {
    id: 'sessions.timeline.badge.matches',
    defaultMessage: '{count, plural, one {# match} other {# matches}}',
  },
} as const satisfies Record<string, MessageDescriptor>

import { Prisma } from '@prisma/client'
import {
  eventsForTask,
  eventsForTasks,
  inferredUsageEventsForTasks,
  taskHasSessions,
} from '@/lib/repositories/task-attribution-where'

describe('task attribution where builders', () => {
  it('eventsForTask: own taskId wins, NULL falls through to session', () => {
    expect(eventsForTask('t1')).toEqual({
      OR: [{ taskId: 't1' }, { taskId: null, session: { taskId: 't1' } }],
    })
  })

  it('eventsForTasks: same rule over a task set', () => {
    expect(eventsForTasks(['a', 'b'])).toEqual({
      OR: [
        { taskId: { in: ['a', 'b'] } },
        { taskId: null, session: { taskId: { in: ['a', 'b'] } } },
      ],
    })
  })

  it('inferredUsageEventsForTasks: unattached-session usage rows only', () => {
    expect(inferredUsageEventsForTasks(['a'])).toEqual({
      taskId: { in: ['a'] },
      type: { in: ['STOP', 'STOP_FAILURE', 'SUBAGENT_STOP'] },
      session: { taskId: null },
      usageByModel: { not: Prisma.DbNull },
    })
  })

  it('taskHasSessions: an INFERRED segment counts only on a still-unattached top-level session', () => {
    expect(taskHasSessions).toEqual({
      OR: [
        { sessions: { some: {} } },
        {
          attributionSegments: {
            some: {
              source: 'INFERRED',
              session: {
                parentSessionId: null,
                taskId: null,
                NOT: { role: 'STEWARD', milestoneId: { not: null } },
              },
            },
          },
        },
      ],
    })
  })
})

import { taskComplexityRepository } from '@/lib/repositories/task-complexity.repository'

export const taskComplexityService = {
  /**
   * 任务转 DONE 时调用(fire-and-forget,见 task-state.service)。
   * 聚合该任务所有已完成 AgentRun 的执行信号并 upsert。
   * 无执行数据(无 run / 两信号皆空)的任务不沉淀,以免污染 team 分布。
   * 错误自捕获并记日志,绝不向上抛。
   */
  async sedimentForTask(taskId: string, teamId: string): Promise<void> {
    try {
      const runs =
        await taskComplexityRepository.listRunSignalsForTask(taskId)

      let totalDurationMs = 0
      const files = new Set<string>()
      for (const run of runs) {
        if (typeof run.durationMs === 'number') {
          totalDurationMs += run.durationMs
        }
        const cf = run.changedFiles
        if (Array.isArray(cf)) {
          for (const f of cf) {
            if (typeof f === 'string') files.add(f)
          }
        }
      }
      const agentRunCount = runs.length
      const changedFileCount = files.size

      // 资格:必须有真实执行数据,否则不沉淀
      if (
        agentRunCount === 0 ||
        (totalDurationMs === 0 && changedFileCount === 0)
      ) {
        return
      }

      await taskComplexityRepository.upsert({
        taskId,
        teamId,
        totalDurationMs,
        changedFileCount,
        agentRunCount,
      })
    } catch (error) {
      // fire-and-forget:与 layer2.service 同款,失败只记日志不回灌响应
      console.error(
        `[complexity] sedimentForTask failed task=${taskId}`,
        error
      )
    }
  },
}

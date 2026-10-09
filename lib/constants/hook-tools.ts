/**
 * 会改文件的 agent 工具白名单。读类工具(Read/Grep/Bash …)不构成
 * 文件耦合/冲突信号。消费方:collision.service(实时同文件碰撞告警)、
 * dependency-detection.service(共享文件依赖候选)、boundary-detector(敏感路径编辑)。
 * `apply_patch` 是 Codex 唯一的写文件工具(LUM-1051),路径从 patch 头解析。
 */
export const WRITE_TOOLS: string[] = [
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  'apply_patch',
]

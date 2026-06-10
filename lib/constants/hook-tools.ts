/**
 * 会改文件的 Claude Code 工具白名单。读类工具(Read/Grep/Bash …)不构成
 * 文件耦合/冲突信号。消费方:collision.service(实时同文件碰撞告警)、
 * dependency-detection.service(共享文件依赖候选)。
 */
export const WRITE_TOOLS: string[] = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

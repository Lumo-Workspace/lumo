'use client'
import { type KanbanItem, getProgressStats } from '@/utils/kanban-utils'

interface AIProgressSummaryProps {
  items: KanbanItem[]
}

export default function AIProgressSummary({ items }: AIProgressSummaryProps) {
  const generateAISummary = () => {
    const { total, completed, inProgress, todo, progress } =
      getProgressStats(items)

    if (total === 0) {
      return '暂无任务数据，建议开始创建项目任务。'
    }

    let summary = `当前共有 ${total} 个任务，`

    if (completed > 0) {
      summary += `${completed} 个已完成，`
    }

    if (inProgress > 0) {
      summary += `${inProgress} 个进行中，`
    }

    if (todo > 0) {
      summary += `${todo} 个未开始，`
    }

    summary += `整体完成度 ${Math.round(progress)}%。`

    // Enhanced AI insights
    const blockedItems = items.filter(
      (item: any) => item.blockedBy && item.blockedBy.length > 0
    ).length
    const itemsWithDependencies = items.filter(
      (item: any) => item.dependencies && item.dependencies.length > 0
    ).length

    if (blockedItems > 0) {
      summary += ` ⚠️ 发现 ${blockedItems} 个任务被阻塞，建议优先解决依赖问题。`
    }

    if (itemsWithDependencies > 0) {
      summary += ` 🔗 ${itemsWithDependencies} 个任务存在依赖关系，注意执行顺序。`
    }

    // Add AI insights based on progress
    if (progress >= 80) {
      summary += ' 🎉 项目进展顺利，即将完成！'
    } else if (progress >= 60) {
      summary += ' 📈 项目进展良好，保持当前节奏。'
    } else if (progress >= 40) {
      summary += ' ⚡ 建议加快进度，关注进行中的任务。'
    } else if (progress >= 20) {
      summary += ' 🔔 项目进度较慢，建议优化资源分配。'
    } else {
      summary += ' 🚀 项目刚刚开始，建议制定详细的执行计划。'
    }

    return summary
  }

  return (
    <div className='mb-4 p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border border-blue-200'>
      <div className='flex items-center justify-between mb-3'>
        <div className='flex items-center gap-2'>
          <span className='text-blue-600'>🧠</span>
          <h3 className='text-lg font-semibold text-blue-900'>AI 进度总结</h3>
          <span className='text-blue-600'>📈</span>
        </div>
      </div>
      <p className='text-sm text-blue-800 leading-relaxed'>
        {generateAISummary()}
      </p>
    </div>
  )
}

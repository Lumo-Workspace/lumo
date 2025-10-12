'use client'

import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import type { StoryData } from './wizard-steps'

interface EstimationStepProps {
  storyData: StoryData
  updateStoryData: (field: keyof StoryData, value: any) => void
  existingStories: Array<{ id: string; title: string }>
}

export default function EstimationStep({
  storyData,
  updateStoryData,
  existingStories,
}: EstimationStepProps) {
  const fibonacciPoints = [1, 2, 3, 5, 8, 13]

  const getPointsDescription = (points: number) => {
    switch (points) {
      case 1:
        return '非常简单 - 几小时内完成'
      case 2:
        return '简单 - 半天内完成'
      case 3:
        return '中等 - 1天内完成'
      case 5:
        return '复杂 - 2-3天完成'
      case 8:
        return '很复杂 - 1周内完成'
      case 13:
        return '非常复杂 - 需要拆分或重新评估'
      default:
        return ''
    }
  }

  const toggleDependency = (storyId: string) => {
    const currentDependencies = storyData.dependencies || []
    const updatedDependencies = currentDependencies.includes(storyId)
      ? currentDependencies.filter(id => id !== storyId)
      : [...currentDependencies, storyId]
    updateStoryData('dependencies', updatedDependencies)
  }

  return (
    <div className='space-y-6'>
      <div>
        <Label>Story Points 估算 *</Label>
        <div className='grid grid-cols-3 gap-3 mt-2'>
          {fibonacciPoints.map(points => (
            <div
              key={points}
              className={`p-4 border rounded-lg cursor-pointer transition-all ${
                storyData.estimatedPoints === points
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
              onClick={() => updateStoryData('estimatedPoints', points)}
            >
              <div className='text-center'>
                <div className='text-2xl font-bold text-blue-600'>{points}</div>
                <div className='text-xs text-gray-600 mt-1'>
                  {getPointsDescription(points)}
                </div>
              </div>
            </div>
          ))}
        </div>
        {storyData.estimatedPoints > 0 && (
          <Alert className='mt-3'>
            <AlertDescription>
              {getPointsDescription(storyData.estimatedPoints)}
            </AlertDescription>
          </Alert>
        )}
      </div>

      <div>
        <Label>依赖关系</Label>
        <p className='text-sm text-gray-500 mb-3'>
          选择这个 Story 依赖的其他 Story
        </p>
        {existingStories.length > 0 ? (
          <div className='space-y-2'>
            {existingStories.map(story => (
              <div
                key={story.id}
                className={`p-3 border rounded-lg cursor-pointer transition-all ${
                  storyData.dependencies?.includes(story.id)
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => toggleDependency(story.id)}
              >
                <div className='flex items-center justify-between'>
                  <span className='font-medium'>{story.title}</span>
                  {storyData.dependencies?.includes(story.id) && (
                    <Badge className='bg-blue-100 text-blue-800'>已选择</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className='text-center py-8 text-gray-500'>
            <div className='text-4xl mb-2'>📝</div>
            <p>暂无其他 Story 可选择依赖</p>
          </div>
        )}
      </div>

      {storyData.dependencies && storyData.dependencies.length > 0 && (
        <div className='bg-yellow-50 p-4 rounded-lg'>
          <h4 className='font-medium text-yellow-900 mb-2'>依赖提醒</h4>
          <p className='text-yellow-800 text-sm'>
            这个 Story 依赖于 {storyData.dependencies.length} 个其他
            Story。请确保依赖的 Story 先完成。
          </p>
        </div>
      )}
    </div>
  )
}

'use client'

import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import type { StoryData } from './wizard-steps'

interface BMADStepProps {
  storyData: StoryData
  updateStoryData: (field: keyof StoryData, value: any) => void
}

export default function BMADStep({
  storyData,
  updateStoryData,
}: BMADStepProps) {
  return (
    <div className='space-y-6'>
      <Alert>
        <AlertDescription>
          BMAD 格式帮助确保 Story 的完整性和清晰度。请按照
          "作为...我希望...以便..." 的格式填写。
        </AlertDescription>
      </Alert>

      <div>
        <Label htmlFor='asA'>作为 (As a) *</Label>
        <Textarea
          id='asA'
          placeholder='例如：作为一个新用户'
          value={storyData.asA}
          onChange={e => updateStoryData('asA', e.target.value)}
          rows={2}
          className='mt-1'
        />
        <p className='text-sm text-gray-500 mt-1'>描述用户角色或身份</p>
      </div>

      <div>
        <Label htmlFor='iWant'>我希望 (I want) *</Label>
        <Textarea
          id='iWant'
          placeholder='例如：我希望能够快速注册账户'
          value={storyData.iWant}
          onChange={e => updateStoryData('iWant', e.target.value)}
          rows={2}
          className='mt-1'
        />
        <p className='text-sm text-gray-500 mt-1'>描述用户想要的功能或行为</p>
      </div>

      <div>
        <Label htmlFor='soThat'>以便 (So that) *</Label>
        <Textarea
          id='soThat'
          placeholder='例如：以便我能够开始使用系统的个性化功能'
          value={storyData.soThat}
          onChange={e => updateStoryData('soThat', e.target.value)}
          rows={2}
          className='mt-1'
        />
        <p className='text-sm text-gray-500 mt-1'>描述用户的目标或期望的结果</p>
      </div>

      {storyData.asA && storyData.iWant && storyData.soThat && (
        <div className='p-4 bg-blue-50 rounded-lg'>
          <h4 className='font-medium text-blue-900 mb-2'>预览</h4>
          <p className='text-blue-800'>
            {storyData.asA}，{storyData.iWant}，{storyData.soThat}。
          </p>
        </div>
      )}
    </div>
  )
}

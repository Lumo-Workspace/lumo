"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import type { StoryData } from "./wizard-steps"

interface AcceptanceCriteriaStepProps {
  storyData: StoryData
  updateStoryData: (field: keyof StoryData, value: any) => void
}

export default function AcceptanceCriteriaStep({ storyData, updateStoryData }: AcceptanceCriteriaStepProps) {
  const [newCriteria, setNewCriteria] = useState("")

  const addCriteria = () => {
    if (newCriteria.trim()) {
      const updatedCriteria = [...storyData.acceptanceCriteria, newCriteria.trim()]
      updateStoryData("acceptanceCriteria", updatedCriteria)
      setNewCriteria("")
    }
  }

  const removeCriteria = (index: number) => {
    const updatedCriteria = storyData.acceptanceCriteria.filter((_, i) => i !== index)
    updateStoryData("acceptanceCriteria", updatedCriteria)
  }

  const updateCriteria = (index: number, value: string) => {
    const updatedCriteria = storyData.acceptanceCriteria.map((criteria, i) => (i === index ? value : criteria))
    updateStoryData("acceptanceCriteria", updatedCriteria)
  }

  return (
    <div className="space-y-6">
      <Alert>
        <AlertDescription>验收标准定义了 Story 完成的具体条件。每个标准应该是可测试和可验证的。</AlertDescription>
      </Alert>

      <div>
        <Label>当前验收标准</Label>
        <div className="space-y-3 mt-2">
          {storyData.acceptanceCriteria.map((criteria, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="text-green-600 flex-shrink-0">✓</span>
              <Input
                value={criteria}
                onChange={(e) => updateCriteria(index, e.target.value)}
                placeholder="输入验收标准..."
                className="flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => removeCriteria(index)}
                className="text-red-600 hover:text-red-700"
              >
                删除
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <Label htmlFor="newCriteria">添加新的验收标准</Label>
        <div className="flex gap-2 mt-1">
          <Input
            id="newCriteria"
            placeholder="例如：用户可以输入有效的邮箱地址"
            value={newCriteria}
            onChange={(e) => setNewCriteria(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && addCriteria()}
            className="flex-1"
          />
          <Button onClick={addCriteria} disabled={!newCriteria.trim()}>
            添加
          </Button>
        </div>
      </div>

      <div className="bg-gray-50 p-4 rounded-lg">
        <h4 className="font-medium mb-2">验收标准示例</h4>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>• 用户可以输入有效的邮箱地址</li>
          <li>• 系统验证邮箱格式的正确性</li>
          <li>• 用户收到确认邮件</li>
          <li>• 用户点击确认链接后账户被激活</li>
        </ul>
      </div>
    </div>
  )
}

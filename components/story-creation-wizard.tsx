"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { steps, type StoryData, initialQualityChecks } from "./story-wizard/wizard-steps"
import QualityChecker, { runQualityChecks } from "./story-wizard/quality-checker"
import BasicInfoStep from "./story-wizard/basic-info-step"
import BMADStep from "./story-wizard/bmad-step"
import AcceptanceCriteriaStep from "./story-wizard/acceptance-criteria-step"
import EstimationStep from "./story-wizard/estimation-step"
import StoryPreview from "./story-wizard/story-preview"

interface StoryCreationWizardProps {
  epicId: string
  existingStories: Array<{ id: string; title: string }>
  onStoryCreate: (story: StoryData) => void
  onClose: () => void
}

export default function StoryCreationWizard({
  epicId,
  existingStories,
  onStoryCreate,
  onClose,
}: StoryCreationWizardProps) {
  const [currentStep, setCurrentStep] = useState(1)
  const [storyData, setStoryData] = useState<StoryData>({
    title: "",
    asA: "",
    iWant: "",
    soThat: "",
    acceptanceCriteria: [""],
    priority: "medium",
    estimatedPoints: 0,
    dependencies: [],
    tags: [],
    businessValue: "",
    technicalNotes: "",
  })

  const [qualityChecks, setQualityChecks] = useState(initialQualityChecks)

  const updateStoryData = (field: keyof StoryData, value: any) => {
    setStoryData((prev) => ({ ...prev, [field]: value }))
  }

  const canProceedToNext = () => {
    switch (currentStep) {
      case 1:
        return storyData.title.length > 0
      case 2:
        return storyData.asA.length > 0 && storyData.iWant.length > 0 && storyData.soThat.length > 0
      case 3:
        return storyData.acceptanceCriteria.filter((c) => c.trim().length > 0).length >= 1
      case 4:
        return storyData.estimatedPoints > 0
      case 5:
        return qualityChecks.filter((c) => c.required).every((c) => c.passed)
      default:
        return true
    }
  }

  const getStepProgress = () => {
    return (currentStep / steps.length) * 100
  }

  const handleNext = () => {
    if (currentStep === 5) {
      const updatedChecks = runQualityChecks(storyData, qualityChecks)
      setQualityChecks(updatedChecks)
    }
    if (currentStep < steps.length && canProceedToNext()) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleSubmit = () => {
    const updatedChecks = runQualityChecks(storyData, qualityChecks)
    setQualityChecks(updatedChecks)
    const requiredChecksPassed = updatedChecks.filter((c) => c.required).every((c) => c.passed)
    if (requiredChecksPassed) {
      onStoryCreate(storyData)
    }
  }

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return <BasicInfoStep storyData={storyData} updateStoryData={updateStoryData} />
      case 2:
        return <BMADStep storyData={storyData} updateStoryData={updateStoryData} />
      case 3:
        return <AcceptanceCriteriaStep storyData={storyData} updateStoryData={updateStoryData} />
      case 4:
        return (
          <EstimationStep storyData={storyData} updateStoryData={updateStoryData} existingStories={existingStories} />
        )
      case 5:
        return (
          <div className="space-y-6">
            <QualityChecker
              qualityChecks={qualityChecks}
              storyData={storyData}
              onRunChecks={() => {
                const updatedChecks = runQualityChecks(storyData, qualityChecks)
                setQualityChecks(updatedChecks)
              }}
            />
            <StoryPreview storyData={storyData} />
            {qualityChecks.filter((c) => c.required && !c.passed).length > 0 && (
              <Alert>
                <AlertDescription>
                  请完善必需的质量检查项目后再提交 Story。点击"运行质量检查"按钮重新检查。
                </AlertDescription>
              </Alert>
            )}
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-2xl font-bold">创建新 Story</h2>
            <p className="text-gray-600 mt-1">Step-by-Step 引导式创建流程</p>
          </div>
          <Button variant="ghost" onClick={onClose}>
            ✕
          </Button>
        </div>

        <div className="p-6 border-b bg-gray-50">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium">
              步骤 {currentStep} / {steps.length}: {steps[currentStep - 1]?.title}
            </h3>
            <span className="text-sm text-gray-500">{Math.round(getStepProgress())}% 完成</span>
          </div>
          <Progress value={getStepProgress()} className="mb-2" />
          <p className="text-sm text-gray-600">{steps[currentStep - 1]?.description}</p>
        </div>

        <div className="flex-1 overflow-y-auto p-6">{renderStepContent()}</div>

        <div className="flex items-center justify-between p-6 border-t bg-gray-50">
          <Button variant="outline" onClick={handlePrevious} disabled={currentStep === 1}>
            上一步
          </Button>

          <div className="flex items-center gap-2">
            {currentStep === 5 && (
              <Button
                variant="outline"
                onClick={() => {
                  const updatedChecks = runQualityChecks(storyData, qualityChecks)
                  setQualityChecks(updatedChecks)
                }}
              >
                运行质量检查
              </Button>
            )}

            {currentStep < steps.length ? (
              <Button onClick={handleNext} disabled={!canProceedToNext()}>
                下一步
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={!qualityChecks.filter((c) => c.required).every((c) => c.passed)}>
                创建 Story
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

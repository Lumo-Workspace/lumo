"use client"

import { Badge } from "@/components/ui/badge"
import type { QualityCheck, StoryData } from "./wizard-steps"

interface QualityCheckerProps {
  qualityChecks: QualityCheck[]
  storyData: StoryData
  onRunChecks: () => void
}

export default function QualityChecker({ qualityChecks, storyData, onRunChecks }: QualityCheckerProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4">质量检查</h3>
        <div className="space-y-3">
          {qualityChecks.map((check) => (
            <div
              key={check.id}
              className={`p-4 rounded-lg border ${
                check.passed ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={check.passed ? "text-green-600" : "text-red-600"}>{check.passed ? "✓" : "✗"}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{check.name}</span>
                    {check.required && <Badge variant="destructive">必需</Badge>}
                  </div>
                  <p className="text-sm text-gray-600">{check.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export const runQualityChecks = (storyData: StoryData, qualityChecks: QualityCheck[]): QualityCheck[] => {
  return qualityChecks.map((check) => {
    let passed = false

    switch (check.id) {
      case "title-clarity":
        passed = storyData.title.length >= 5 && storyData.title.length <= 100
        break
      case "bmad-complete":
        passed = storyData.asA.length > 0 && storyData.iWant.length > 0 && storyData.soThat.length > 0
        break
      case "acceptance-criteria":
        passed = storyData.acceptanceCriteria.filter((c) => c.trim().length > 0).length >= 2
        break
      case "business-value":
        passed = storyData.businessValue.length > 10
        break
      case "estimation-reasonable":
        passed = storyData.estimatedPoints >= 1 && storyData.estimatedPoints <= 13
        break
      case "dependency-check":
        passed = true // Always pass for now
        break
    }

    return { ...check, passed }
  })
}

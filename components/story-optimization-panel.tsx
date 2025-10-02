"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"

interface OptimizationSuggestion {
  id: string
  title: string
  description: string
  impact: "high" | "medium" | "low"
  effort: "high" | "medium" | "low"
  category:
    | "clarity"
    | "acceptance"
    | "priority"
    | "dependencies"
    | "estimation"
    | "technical"
    | "ux"
    | "business"
    | "risk"
  before: string
  after: string
  reasoning: string
}

interface StoryOptimizationProps {
  storyId: string
  storyTitle: string
  storyContent: string
  onApplyOptimization: (optimizations: OptimizationSuggestion[]) => void
}

export default function StoryOptimizationPanel({
  storyId,
  storyTitle,
  storyContent,
  onApplyOptimization,
}: StoryOptimizationProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [suggestions, setSuggestions] = useState<OptimizationSuggestion[]>([])
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set())
  const [analysisProgress, setAnalysisProgress] = useState(0)

  const analyzeStory = async () => {
    setIsAnalyzing(true)
    setAnalysisProgress(0)

    // Simulate AI analysis process
    const progressSteps = [
      { progress: 15, message: "分析Story结构..." },
      { progress: 30, message: "检查BMAD格式..." },
      { progress: 45, message: "评估验收标准..." },
      { progress: 60, message: "分析依赖关系..." },
      { progress: 75, message: "生成优化建议..." },
      { progress: 90, message: "评估影响程度..." },
      { progress: 100, message: "分析完成!" },
    ]

    for (const step of progressSteps) {
      await new Promise((resolve) => setTimeout(resolve, 600))
      setAnalysisProgress(step.progress)
    }

    // Mock optimization suggestions
    const mockSuggestions: OptimizationSuggestion[] = [
      {
        id: "opt-1",
        title: "优化BMAD格式表达",
        description: "将Story描述改写为更标准的BMAD格式，提高可读性和理解性",
        impact: "high",
        effort: "low",
        category: "clarity",
        before: storyContent,
        after: "作为一个注册用户，我希望能够快速登录系统，以便立即访问我的个人数据和功能，提高使用效率。",
        reasoning: "当前描述缺少明确的用户角色和价值说明，改进后更符合BMAD标准格式",
      },
      {
        id: "opt-2",
        title: "增加具体验收标准",
        description: "为Story添加更详细和可测试的验收标准",
        impact: "high",
        effort: "medium",
        category: "acceptance",
        before: "基本登录功能",
        after:
          "1. 用户输入正确用户名密码后2秒内完成登录\n2. 登录失败时显示明确错误信息\n3. 支持记住登录状态30天\n4. 登录页面响应时间<1秒",
        reasoning: "具体的验收标准有助于开发和测试团队明确交付目标",
      },
      {
        id: "opt-3",
        title: "调整优先级评估",
        description: "基于业务价值和技术复杂度重新评估Story优先级",
        impact: "medium",
        effort: "low",
        category: "priority",
        before: "中优先级",
        after: "高优先级",
        reasoning: "登录功能是用户使用系统的基础，应该优先开发",
      },
      {
        id: "opt-4",
        title: "识别技术依赖",
        description: "明确Story的技术依赖关系，避免开发阻塞",
        impact: "medium",
        effort: "low",
        category: "dependencies",
        before: "无明确依赖",
        after: "依赖：用户注册功能、数据库用户表、会话管理服务",
        reasoning: "明确依赖关系有助于合理安排开发顺序",
      },
      {
        id: "opt-5",
        title: "优化工作量估算",
        description: "基于复杂度分析调整Story点数估算",
        impact: "medium",
        effort: "low",
        category: "estimation",
        before: "5 故事点",
        after: "3 故事点",
        reasoning: "登录功能相对标准，复杂度较低，建议调整估算",
      },
      {
        id: "opt-6",
        title: "增加用户体验考虑",
        description: "在Story中加入用户体验相关的要求",
        impact: "medium",
        effort: "medium",
        category: "ux",
        before: "基础登录界面",
        after: "响应式登录界面，支持移动端，包含加载状态和友好错误提示",
        reasoning: "良好的用户体验是产品成功的关键因素",
      },
      {
        id: "opt-7",
        title: "考虑安全性要求",
        description: "在Story中明确安全性相关的需求",
        impact: "high",
        effort: "medium",
        category: "technical",
        before: "简单密码验证",
        after: "密码加密存储、防暴力破解、登录日志记录、异常登录检测",
        reasoning: "安全性是用户认证系统的核心要求",
      },
      {
        id: "opt-8",
        title: "添加业务指标",
        description: "为Story定义可衡量的业务成功指标",
        impact: "low",
        effort: "low",
        category: "business",
        before: "无业务指标",
        after: "目标：登录成功率>95%，平均登录时间<3秒，用户满意度>4.5分",
        reasoning: "业务指标有助于评估功能的实际效果",
      },
      {
        id: "opt-9",
        title: "风险评估与缓解",
        description: "识别Story实现过程中的潜在风险",
        impact: "medium",
        effort: "low",
        category: "risk",
        before: "无风险评估",
        after: "风险：第三方认证服务不稳定；缓解：实现本地认证备选方案",
        reasoning: "提前识别风险有助于制定应对策略",
      },
    ]

    setSuggestions(mockSuggestions)
    setIsAnalyzing(false)
  }

  const handleSuggestionToggle = (suggestionId: string) => {
    const newSelected = new Set(selectedSuggestions)
    if (newSelected.has(suggestionId)) {
      newSelected.delete(suggestionId)
    } else {
      newSelected.add(suggestionId)
    }
    setSelectedSuggestions(newSelected)
  }

  const handleApplyOptimizations = () => {
    const selectedOptimizations = suggestions.filter((s) => selectedSuggestions.has(s.id))
    onApplyOptimization(selectedOptimizations)
    setIsOpen(false)
    setSuggestions([])
    setSelectedSuggestions(new Set())
  }

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case "high":
        return "bg-red-100 text-red-800"
      case "medium":
        return "bg-yellow-100 text-yellow-800"
      case "low":
        return "bg-green-100 text-green-800"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

  const getEffortColor = (effort: string) => {
    switch (effort) {
      case "high":
        return "bg-red-100 text-red-800"
      case "medium":
        return "bg-yellow-100 text-yellow-800"
      case "low":
        return "bg-green-100 text-green-800"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

  const getCategoryIcon = (category: string) => {
    const icons = {
      clarity: "📝",
      acceptance: "✅",
      priority: "🎯",
      dependencies: "🔗",
      estimation: "📊",
      technical: "⚙️",
      ux: "🎨",
      business: "💼",
      risk: "⚠️",
    }
    return icons[category as keyof typeof icons] || "📋"
  }

  const getCategoryLabel = (category: string) => {
    const labels = {
      clarity: "清晰度",
      acceptance: "验收标准",
      priority: "优先级",
      dependencies: "依赖关系",
      estimation: "工作量估算",
      technical: "技术要求",
      ux: "用户体验",
      business: "业务指标",
      risk: "风险管理",
    }
    return labels[category as keyof typeof labels] || category
  }

  const groupedSuggestions = suggestions.reduce(
    (groups, suggestion) => {
      const category = suggestion.category
      if (!groups[category]) {
        groups[category] = []
      }
      groups[category].push(suggestion)
      return groups
    },
    {} as Record<string, OptimizationSuggestion[]>,
  )

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="bg-gradient-to-r from-green-50 to-blue-50 border-green-200 hover:from-green-100 hover:to-blue-100"
        >
          <span className="mr-2">🧠</span>
          AI 优化
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-green-600">🧠</span>
            AI Story 优化建议
            <Badge variant="outline">{storyTitle}</Badge>
          </DialogTitle>
        </DialogHeader>

        {!isAnalyzing && suggestions.length === 0 && (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🔍</div>
            <h3 className="text-lg font-semibold mb-2">准备分析 Story</h3>
            <p className="text-gray-600 mb-6">AI 将从多个维度分析当前 Story，提供 1-9 个优化建议</p>
            <Button onClick={analyzeStory} className="bg-gradient-to-r from-green-600 to-blue-600">
              <span className="mr-2">🧠</span>
              开始分析
            </Button>
          </div>
        )}

        {isAnalyzing && (
          <div className="space-y-6 py-8">
            <div className="text-center">
              <div className="text-4xl mb-4 animate-pulse">🧠</div>
              <h3 className="text-lg font-semibold mb-2">AI 正在分析中...</h3>
            </div>
            <Progress value={analysisProgress} className="w-full" />
            <p className="text-center text-sm text-gray-600">
              {analysisProgress < 15 && "分析Story结构..."}
              {analysisProgress >= 15 && analysisProgress < 30 && "检查BMAD格式..."}
              {analysisProgress >= 30 && analysisProgress < 45 && "评估验收标准..."}
              {analysisProgress >= 45 && analysisProgress < 60 && "分析依赖关系..."}
              {analysisProgress >= 60 && analysisProgress < 75 && "生成优化建议..."}
              {analysisProgress >= 75 && analysisProgress < 90 && "评估影响程度..."}
              {analysisProgress >= 90 && "分析完成!"}
            </p>
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">优化建议 ({suggestions.length} 项)</h3>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedSuggestions(new Set(suggestions.map((s) => s.id)))}
                >
                  全选
                </Button>
                <Button variant="outline" size="sm" onClick={() => setSelectedSuggestions(new Set())}>
                  全不选
                </Button>
              </div>
            </div>

            <Tabs defaultValue="all" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="all">全部建议</TabsTrigger>
                <TabsTrigger value="high-impact">高影响</TabsTrigger>
                <TabsTrigger value="low-effort">低工作量</TabsTrigger>
                <TabsTrigger value="by-category">分类查看</TabsTrigger>
              </TabsList>

              <TabsContent value="all" className="space-y-4">
                {suggestions.map((suggestion) => (
                  <Card
                    key={suggestion.id}
                    className={`cursor-pointer transition-all ${
                      selectedSuggestions.has(suggestion.id) ? "ring-2 ring-blue-500 bg-blue-50" : "hover:shadow-md"
                    }`}
                    onClick={() => handleSuggestionToggle(suggestion.id)}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{getCategoryIcon(suggestion.category)}</span>
                          <CardTitle className="text-base">{suggestion.title}</CardTitle>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={getImpactColor(suggestion.impact)}>
                            影响: {suggestion.impact === "high" ? "高" : suggestion.impact === "medium" ? "中" : "低"}
                          </Badge>
                          <Badge className={getEffortColor(suggestion.effort)}>
                            工作量: {suggestion.effort === "high" ? "高" : suggestion.effort === "medium" ? "中" : "低"}
                          </Badge>
                          <div
                            className={`w-4 h-4 rounded border-2 ${
                              selectedSuggestions.has(suggestion.id) ? "bg-blue-500 border-blue-500" : "border-gray-300"
                            }`}
                          >
                            {selectedSuggestions.has(suggestion.id) && (
                              <div className="text-white text-xs text-center">✓</div>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-sm text-gray-600">{suggestion.description}</p>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <h4 className="font-medium text-sm text-red-700 mb-1">当前状态</h4>
                          <div className="bg-red-50 p-2 rounded text-sm text-red-800">{suggestion.before}</div>
                        </div>
                        <div>
                          <h4 className="font-medium text-sm text-green-700 mb-1">优化后</h4>
                          <div className="bg-green-50 p-2 rounded text-sm text-green-800">{suggestion.after}</div>
                        </div>
                      </div>

                      <div>
                        <h4 className="font-medium text-sm text-gray-700 mb-1">优化理由</h4>
                        <p className="text-sm text-gray-600 bg-gray-50 p-2 rounded">{suggestion.reasoning}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </TabsContent>

              <TabsContent value="high-impact" className="space-y-4">
                {suggestions
                  .filter((s) => s.impact === "high")
                  .map((suggestion) => (
                    <Card
                      key={suggestion.id}
                      className="cursor-pointer"
                      onClick={() => handleSuggestionToggle(suggestion.id)}
                    >
                      {/* Same card content as above */}
                    </Card>
                  ))}
              </TabsContent>

              <TabsContent value="low-effort" className="space-y-4">
                {suggestions
                  .filter((s) => s.effort === "low")
                  .map((suggestion) => (
                    <Card
                      key={suggestion.id}
                      className="cursor-pointer"
                      onClick={() => handleSuggestionToggle(suggestion.id)}
                    >
                      {/* Same card content as above */}
                    </Card>
                  ))}
              </TabsContent>

              <TabsContent value="by-category" className="space-y-6">
                {Object.entries(groupedSuggestions).map(([category, categorySuggestions]) => (
                  <div key={category}>
                    <h4 className="font-semibold mb-3 flex items-center gap-2">
                      <span>{getCategoryIcon(category)}</span>
                      {getCategoryLabel(category)} ({categorySuggestions.length})
                    </h4>
                    <div className="space-y-3">
                      {categorySuggestions.map((suggestion) => (
                        <Card
                          key={suggestion.id}
                          className="cursor-pointer"
                          onClick={() => handleSuggestionToggle(suggestion.id)}
                        >
                          {/* Same card content as above */}
                        </Card>
                      ))}
                    </div>
                  </div>
                ))}
              </TabsContent>
            </Tabs>

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="outline" onClick={() => setIsOpen(false)}>
                取消
              </Button>
              <Button
                onClick={handleApplyOptimizations}
                disabled={selectedSuggestions.size === 0}
                className="bg-gradient-to-r from-green-600 to-blue-600"
              >
                应用优化 ({selectedSuggestions.size} 项)
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

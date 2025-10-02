"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"

interface GeneratedItem {
  id: string
  title: string
  content: string
  acceptanceCriteria: string[]
  priority: "high" | "medium" | "low"
  estimatedPoints: number
  dependencies: string[]
  version: number
}

interface AIGeneratorProps {
  type: "epic" | "story"
  context: string
  onGenerate: (items: GeneratedItem[]) => void
}

export default function AIEpicStoryGenerator({ type, context, onGenerate }: AIGeneratorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedItems, setGeneratedItems] = useState<GeneratedItem[]>([])
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [customPrompt, setCustomPrompt] = useState("")
  const [generationProgress, setGenerationProgress] = useState(0)

  const generateItems = async () => {
    setIsGenerating(true)
    setGenerationProgress(0)

    // Simulate AI generation process
    const progressSteps = [
      { progress: 20, message: "分析PRD内容..." },
      { progress: 40, message: "生成BMAD结构..." },
      { progress: 60, message: "创建验收标准..." },
      { progress: 80, message: "评估优先级和依赖..." },
      { progress: 100, message: "生成完成!" },
    ]

    for (const step of progressSteps) {
      await new Promise((resolve) => setTimeout(resolve, 800))
      setGenerationProgress(step.progress)
    }

    // Mock generated items based on type
    const mockItems: GeneratedItem[] =
      type === "epic"
        ? [
            {
              id: `epic-${Date.now()}-1`,
              title: "用户身份验证系统",
              content: "作为一个新用户，我希望能够安全地注册和登录系统，以便访问个人化的功能和数据。",
              acceptanceCriteria: [
                "用户可以通过邮箱注册新账户",
                "用户可以通过用户名/密码登录",
                "支持密码重置功能",
                "实现多因素认证",
                "登录状态持久化",
              ],
              priority: "high",
              estimatedPoints: 13,
              dependencies: [],
              version: 1,
            },
            {
              id: `epic-${Date.now()}-2`,
              title: "用户权限管理",
              content: "作为系统管理员，我希望能够管理用户权限和角色，以便控制不同用户对系统功能的访问。",
              acceptanceCriteria: [
                "定义用户角色和权限",
                "支持角色分配和修改",
                "实现基于角色的访问控制",
                "权限变更日志记录",
              ],
              priority: "medium",
              estimatedPoints: 8,
              dependencies: ["用户身份验证系统"],
              version: 1,
            },
          ]
        : [
            {
              id: `story-${Date.now()}-1`,
              title: "邮箱注册功能",
              content: "作为一个新用户，我希望能够使用邮箱地址注册账户，以便开始使用系统功能。",
              acceptanceCriteria: [
                "用户输入有效邮箱地址",
                "系统发送验证邮件",
                "用户点击验证链接激活账户",
                "显示注册成功确认",
              ],
              priority: "high",
              estimatedPoints: 5,
              dependencies: [],
              version: 1,
            },
            {
              id: `story-${Date.now()}-2`,
              title: "密码登录功能",
              content: "作为已注册用户，我希望能够使用用户名和密码登录，以便访问我的个人账户。",
              acceptanceCriteria: [
                "用户输入用户名和密码",
                "系统验证凭据",
                "登录成功后跳转到主页",
                "错误时显示友好提示",
              ],
              priority: "high",
              estimatedPoints: 3,
              dependencies: ["邮箱注册功能"],
              version: 1,
            },
            {
              id: `story-${Date.now()}-3`,
              title: "忘记密码功能",
              content: "作为用户，我希望在忘记密码时能够重置密码，以便重新获得账户访问权限。",
              acceptanceCriteria: ["用户输入注册邮箱", "系统发送重置链接", "用户设置新密码", "密码重置成功确认"],
              priority: "medium",
              estimatedPoints: 3,
              dependencies: ["邮箱注册功能"],
              version: 1,
            },
          ]

    setGeneratedItems(mockItems)
    setSelectedItems(new Set(mockItems.map((item) => item.id)))
    setIsGenerating(false)
  }

  const handleItemToggle = (itemId: string) => {
    const newSelected = new Set(selectedItems)
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId)
    } else {
      newSelected.add(itemId)
    }
    setSelectedItems(newSelected)
  }

  const handleConfirmGeneration = () => {
    const selectedItemsArray = generatedItems.filter((item) => selectedItems.has(item.id))
    onGenerate(selectedItemsArray)
    setIsOpen(false)
    setGeneratedItems([])
    setSelectedItems(new Set())
    setCustomPrompt("")
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
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

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case "high":
        return "高"
      case "medium":
        return "中"
      case "low":
        return "低"
      default:
        return ""
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white">
          <span className="mr-2">⚡</span>
          AI 生成 {type === "epic" ? "Epic" : "Story"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-purple-600">🧠</span>
            AI 智能生成 {type === "epic" ? "Epic" : "Story"}
            <span className="text-blue-600">⚡</span>
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="generate" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="generate">智能生成</TabsTrigger>
            <TabsTrigger value="custom">自定义提示</TabsTrigger>
          </TabsList>

          <TabsContent value="generate" className="space-y-4">
            <div className="bg-blue-50 p-4 rounded-lg">
              <h3 className="font-semibold text-blue-900 mb-2">当前上下文</h3>
              <p className="text-blue-800 text-sm">{context}</p>
            </div>

            {!isGenerating && generatedItems.length === 0 && (
              <div className="text-center py-8">
                <div className="text-6xl mb-4">🚀</div>
                <h3 className="text-lg font-semibold mb-2">准备生成 {type === "epic" ? "Epic" : "Story"}</h3>
                <p className="text-gray-600 mb-4">
                  AI 将基于当前 PRD 内容自动生成结构化的 {type === "epic" ? "Epic" : "Story"}
                </p>
                <Button onClick={generateItems} className="bg-gradient-to-r from-purple-600 to-blue-600">
                  <span className="mr-2">⚡</span>
                  开始生成
                </Button>
              </div>
            )}

            {isGenerating && (
              <div className="space-y-4">
                <div className="text-center">
                  <div className="text-4xl mb-4 animate-spin">🧠</div>
                  <h3 className="text-lg font-semibold mb-2">AI 正在生成中...</h3>
                </div>
                <Progress value={generationProgress} className="w-full" />
                <p className="text-center text-sm text-gray-600">
                  {generationProgress < 20 && "分析PRD内容..."}
                  {generationProgress >= 20 && generationProgress < 40 && "生成BMAD结构..."}
                  {generationProgress >= 40 && generationProgress < 60 && "创建验收标准..."}
                  {generationProgress >= 60 && generationProgress < 80 && "评估优先级和依赖..."}
                  {generationProgress >= 80 && "生成完成!"}
                </p>
              </div>
            )}

            {generatedItems.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">生成结果 ({generatedItems.length} 项)</h3>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedItems(new Set(generatedItems.map((item) => item.id)))}
                    >
                      全选
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setSelectedItems(new Set())}>
                      全不选
                    </Button>
                  </div>
                </div>

                <div className="grid gap-4">
                  {generatedItems.map((item) => (
                    <Card
                      key={item.id}
                      className={`cursor-pointer transition-all ${
                        selectedItems.has(item.id) ? "ring-2 ring-blue-500 bg-blue-50" : "hover:shadow-md"
                      }`}
                      onClick={() => handleItemToggle(item.id)}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-lg">{item.title}</CardTitle>
                          <div className="flex items-center gap-2">
                            <Badge className={getPriorityColor(item.priority)}>{getPriorityLabel(item.priority)}</Badge>
                            <Badge variant="outline">{item.estimatedPoints} 点</Badge>
                            <div
                              className={`w-4 h-4 rounded border-2 ${
                                selectedItems.has(item.id) ? "bg-blue-500 border-blue-500" : "border-gray-300"
                              }`}
                            >
                              {selectedItems.has(item.id) && <div className="text-white text-xs text-center">✓</div>}
                            </div>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div>
                          <h4 className="font-medium text-sm text-gray-700 mb-1">BMAD 描述</h4>
                          <p className="text-sm text-gray-600">{item.content}</p>
                        </div>

                        <div>
                          <h4 className="font-medium text-sm text-gray-700 mb-1">验收标准</h4>
                          <ul className="text-sm text-gray-600 space-y-1">
                            {item.acceptanceCriteria.map((criteria, index) => (
                              <li key={index} className="flex items-start gap-2">
                                <span className="text-green-600 mt-0.5">✓</span>
                                {criteria}
                              </li>
                            ))}
                          </ul>
                        </div>

                        {item.dependencies.length > 0 && (
                          <div>
                            <h4 className="font-medium text-sm text-gray-700 mb-1">依赖关系</h4>
                            <div className="flex flex-wrap gap-1">
                              {item.dependencies.map((dep, index) => (
                                <Badge key={index} variant="secondary" className="text-xs">
                                  {dep}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t">
                  <Button variant="outline" onClick={() => setIsOpen(false)}>
                    取消
                  </Button>
                  <Button
                    onClick={handleConfirmGeneration}
                    disabled={selectedItems.size === 0}
                    className="bg-gradient-to-r from-purple-600 to-blue-600"
                  >
                    确认生成 ({selectedItems.size} 项)
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="custom" className="space-y-4">
            <div>
              <Label htmlFor="custom-prompt">自定义生成提示</Label>
              <Textarea
                id="custom-prompt"
                placeholder={`请描述您希望生成的${type === "epic" ? "Epic" : "Story"}特点，例如：
- 重点关注用户体验
- 包含安全性考虑
- 支持移动端适配
- 集成第三方服务`}
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                rows={6}
              />
            </div>
            <Button onClick={generateItems} className="w-full">
              <span className="mr-2">⚡</span>
              基于自定义提示生成
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

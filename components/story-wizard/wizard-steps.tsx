export const steps = [
  { id: 1, title: "基本信息", description: "定义 Story 的基本信息" },
  { id: 2, title: "BMAD 格式", description: "使用 BMAD 模板描述需求" },
  { id: 3, title: "验收标准", description: "定义明确的验收标准" },
  { id: 4, title: "估算与依赖", description: "工作量估算和依赖关系" },
  { id: 5, title: "质量检查", description: "质量检查和最终确认" },
]

export interface StoryData {
  title: string
  asA: string
  iWant: string
  soThat: string
  acceptanceCriteria: string[]
  priority: "low" | "medium" | "high"
  estimatedPoints: number
  dependencies: string[]
  tags: string[]
  businessValue: string
  technicalNotes: string
}

export interface QualityCheck {
  id: string
  name: string
  description: string
  passed: boolean
  required: boolean
}

export const initialQualityChecks: QualityCheck[] = [
  {
    id: "title-clarity",
    name: "标题清晰度",
    description: "Story 标题是否清晰描述了功能",
    passed: false,
    required: true,
  },
  {
    id: "bmad-complete",
    name: "BMAD 完整性",
    description: "是否完整填写了 As a/I want/So that",
    passed: false,
    required: true,
  },
  {
    id: "acceptance-criteria",
    name: "验收标准",
    description: "是否定义了明确的验收标准",
    passed: false,
    required: true,
  },
  {
    id: "business-value",
    name: "业务价值",
    description: "是否明确了业务价值",
    passed: false,
    required: false,
  },
  {
    id: "estimation-reasonable",
    name: "估算合理性",
    description: "工作量估算是否合理（1-13点）",
    passed: false,
    required: true,
  },
  {
    id: "dependency-check",
    name: "依赖关系",
    description: "是否检查了依赖关系",
    passed: false,
    required: false,
  },
]

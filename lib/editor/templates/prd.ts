import type { SystemTemplateSeed } from './index'

export const prdTemplate: SystemTemplateSeed = {
  key: 'prd',
  emoji: '📋',
  sortOrder: 1,
  content: [
    '<h1>PRD：标题</h1>',
    '<h2>背景</h2><p>为什么要做这件事？当前的问题或机会。</p>',
    '<h2>目标</h2><ul><li>目标一</li><li>目标二</li></ul>',
    '<h2>非目标</h2><ul><li>本次明确不做的范围</li></ul>',
    '<h2>用户故事</h2><p>作为「角色」，我希望「能力」，以便「价值」。</p>',
    '<h2>方案</h2><p>方案概述与关键设计点。</p>',
    '<h2>里程碑</h2><ul><li>M1：</li><li>M2：</li></ul>',
    '<h2>风险</h2><ul><li>风险与缓解措施</li></ul>',
  ].join(''),
}

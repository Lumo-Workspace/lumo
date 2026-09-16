-- LUM-789: 合同确认（人的介入点从末尾裁定前移到起草确认）。
-- 纯 additive：两个可空列，无数据删除，无默认值回填，不重写既有行。
-- null = 未确认 —— 这是自然默认态，不是需要声明的例外；未确认永不阻止 DONE。
ALTER TABLE "acceptance_criteria" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "acceptance_criteria" ADD COLUMN "confirmedByMemberId" TEXT;

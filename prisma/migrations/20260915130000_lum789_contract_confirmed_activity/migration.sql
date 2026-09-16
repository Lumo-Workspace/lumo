-- LUM-789: 合同确认的追加历史。纯 additive 的枚举值新增,无数据改动。
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'CONTRACT_CONFIRMED';

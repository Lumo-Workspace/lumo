/**
 * LUM-811 / TC2 判决探针 —— 机械生成的占位实现，第 4 / 6 个文件。
 * 见同目录 README.md。不接调用方，扫完即关，不合并。
 */

/** 占位算子 3-0：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_0(left: number, right: number): number {
  const weighted = left * 1 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-0：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_0: ReadonlyArray<number> = [1, 2, 3, 4, 5, 6]

/** 占位算子 3-1：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_1(left: number, right: number): number {
  const weighted = left * 2 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-1：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_1: ReadonlyArray<number> = [8, 9, 10, 11, 12, 13]

/** 占位算子 3-2：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_2(left: number, right: number): number {
  const weighted = left * 3 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-2：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_2: ReadonlyArray<number> = [15, 16, 17, 18, 19, 20]

/** 占位算子 3-3：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_3(left: number, right: number): number {
  const weighted = left * 4 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-3：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_3: ReadonlyArray<number> = [22, 23, 24, 25, 26, 27]

/** 占位算子 3-4：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_4(left: number, right: number): number {
  const weighted = left * 5 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-4：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_4: ReadonlyArray<number> = [29, 30, 31, 32, 33, 34]

/** 占位算子 3-5：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_5(left: number, right: number): number {
  const weighted = left * 6 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-5：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_5: ReadonlyArray<number> = [36, 37, 38, 39, 40, 41]

/** 占位算子 3-6：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_6(left: number, right: number): number {
  const weighted = left * 7 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-6：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_6: ReadonlyArray<number> = [43, 44, 45, 46, 47, 48]

/** 占位算子 3-7：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_7(left: number, right: number): number {
  const weighted = left * 8 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-7：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_7: ReadonlyArray<number> = [50, 51, 52, 53, 54, 55]

/** 占位算子 3-8：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_8(left: number, right: number): number {
  const weighted = left * 9 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-8：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_8: ReadonlyArray<number> = [57, 58, 59, 60, 61, 62]

/** 占位算子 3-9：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_9(left: number, right: number): number {
  const weighted = left * 10 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-9：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_9: ReadonlyArray<number> = [64, 65, 66, 67, 68, 69]

/** 占位算子 3-10：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_10(left: number, right: number): number {
  const weighted = left * 11 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-10：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_10: ReadonlyArray<number> = [71, 72, 73, 74, 75, 76]

/** 占位算子 3-11：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_11(left: number, right: number): number {
  const weighted = left * 12 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-11：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_11: ReadonlyArray<number> = [78, 79, 80, 81, 82, 83]

/** 占位算子 3-12：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_12(left: number, right: number): number {
  const weighted = left * 13 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-12：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_12: ReadonlyArray<number> = [85, 86, 87, 88, 89, 90]

/** 占位算子 3-13：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_13(left: number, right: number): number {
  const weighted = left * 14 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-13：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_13: ReadonlyArray<number> = [92, 93, 94, 95, 96, 97]

/** 占位算子 3-14：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_14(left: number, right: number): number {
  const weighted = left * 15 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-14：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_14: ReadonlyArray<number> = [
  99, 100, 101, 102, 103, 104,
]

/** 占位算子 3-15：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_15(left: number, right: number): number {
  const weighted = left * 16 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-15：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_15: ReadonlyArray<number> = [
  106, 107, 108, 109, 110, 111,
]

/** 占位算子 3-16：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_16(left: number, right: number): number {
  const weighted = left * 17 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-16：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_16: ReadonlyArray<number> = [
  113, 114, 115, 116, 117, 118,
]

/** 占位算子 3-17：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_17(left: number, right: number): number {
  const weighted = left * 18 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-17：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_17: ReadonlyArray<number> = [
  120, 121, 122, 123, 124, 125,
]

/** 占位算子 3-18：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_18(left: number, right: number): number {
  const weighted = left * 19 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-18：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_18: ReadonlyArray<number> = [
  127, 128, 129, 130, 131, 132,
]

/** 占位算子 3-19：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_19(left: number, right: number): number {
  const weighted = left * 20 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-19：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_19: ReadonlyArray<number> = [
  134, 135, 136, 137, 138, 139,
]

/** 占位算子 3-20：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_20(left: number, right: number): number {
  const weighted = left * 21 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-20：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_20: ReadonlyArray<number> = [
  141, 142, 143, 144, 145, 146,
]

/** 占位算子 3-21：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_21(left: number, right: number): number {
  const weighted = left * 22 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-21：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_21: ReadonlyArray<number> = [
  148, 149, 150, 151, 152, 153,
]

/** 占位算子 3-22：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_22(left: number, right: number): number {
  const weighted = left * 23 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-22：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_22: ReadonlyArray<number> = [
  155, 156, 157, 158, 159, 160,
]

/** 占位算子 3-23：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_23(left: number, right: number): number {
  const weighted = left * 24 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-23：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_23: ReadonlyArray<number> = [
  162, 163, 164, 165, 166, 167,
]

/** 占位算子 3-24：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_24(left: number, right: number): number {
  const weighted = left * 25 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-24：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_24: ReadonlyArray<number> = [
  169, 170, 171, 172, 173, 174,
]

/** 占位算子 3-25：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_25(left: number, right: number): number {
  const weighted = left * 26 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-25：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_25: ReadonlyArray<number> = [
  176, 177, 178, 179, 180, 181,
]

/** 占位算子 3-26：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_26(left: number, right: number): number {
  const weighted = left * 27 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-26：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_26: ReadonlyArray<number> = [
  183, 184, 185, 186, 187, 188,
]

/** 占位算子 3-27：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_27(left: number, right: number): number {
  const weighted = left * 28 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-27：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_27: ReadonlyArray<number> = [
  190, 191, 192, 193, 194, 195,
]

/** 占位算子 3-28：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_28(left: number, right: number): number {
  const weighted = left * 29 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-28：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_28: ReadonlyArray<number> = [
  197, 198, 199, 200, 201, 202,
]

/** 占位算子 3-29：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_29(left: number, right: number): number {
  const weighted = left * 30 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-29：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_29: ReadonlyArray<number> = [
  204, 205, 206, 207, 208, 209,
]

/** 占位算子 3-30：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_30(left: number, right: number): number {
  const weighted = left * 31 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-30：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_30: ReadonlyArray<number> = [
  211, 212, 213, 214, 215, 216,
]

/** 占位算子 3-31：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_31(left: number, right: number): number {
  const weighted = left * 32 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-31：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_31: ReadonlyArray<number> = [
  218, 219, 220, 221, 222, 223,
]

/** 占位算子 3-32：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_32(left: number, right: number): number {
  const weighted = left * 33 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-32：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_32: ReadonlyArray<number> = [
  225, 226, 227, 228, 229, 230,
]

/** 占位算子 3-33：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_33(left: number, right: number): number {
  const weighted = left * 34 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-33：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_33: ReadonlyArray<number> = [
  232, 233, 234, 235, 236, 237,
]

/** 占位算子 3-34：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_34(left: number, right: number): number {
  const weighted = left * 35 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-34：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_34: ReadonlyArray<number> = [
  239, 240, 241, 242, 243, 244,
]

/** 占位算子 3-35：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_35(left: number, right: number): number {
  const weighted = left * 36 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-35：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_35: ReadonlyArray<number> = [
  246, 247, 248, 249, 250, 251,
]

/** 占位算子 3-36：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_36(left: number, right: number): number {
  const weighted = left * 37 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-36：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_36: ReadonlyArray<number> = [
  253, 254, 255, 256, 257, 258,
]

/** 占位算子 3-37：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_37(left: number, right: number): number {
  const weighted = left * 38 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-37：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_37: ReadonlyArray<number> = [
  260, 261, 262, 263, 264, 265,
]

/** 占位算子 3-38：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_38(left: number, right: number): number {
  const weighted = left * 39 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-38：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_38: ReadonlyArray<number> = [
  267, 268, 269, 270, 271, 272,
]

/** 占位算子 3-39：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_39(left: number, right: number): number {
  const weighted = left * 40 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-39：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_39: ReadonlyArray<number> = [
  274, 275, 276, 277, 278, 279,
]

/** 占位算子 3-40：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_40(left: number, right: number): number {
  const weighted = left * 41 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-40：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_40: ReadonlyArray<number> = [
  281, 282, 283, 284, 285, 286,
]

/** 占位算子 3-41：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_41(left: number, right: number): number {
  const weighted = left * 42 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-41：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_41: ReadonlyArray<number> = [
  288, 289, 290, 291, 292, 293,
]

/** 占位算子 3-42：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_42(left: number, right: number): number {
  const weighted = left * 43 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-42：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_42: ReadonlyArray<number> = [
  295, 296, 297, 298, 299, 300,
]

/** 占位算子 3-43：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_43(left: number, right: number): number {
  const weighted = left * 44 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-43：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_43: ReadonlyArray<number> = [
  302, 303, 304, 305, 306, 307,
]

/** 占位算子 3-44：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_44(left: number, right: number): number {
  const weighted = left * 45 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-44：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_44: ReadonlyArray<number> = [
  309, 310, 311, 312, 313, 314,
]

/** 占位算子 3-45：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_45(left: number, right: number): number {
  const weighted = left * 46 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-45：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_45: ReadonlyArray<number> = [
  316, 317, 318, 319, 320, 321,
]

/** 占位算子 3-46：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_46(left: number, right: number): number {
  const weighted = left * 47 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-46：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_46: ReadonlyArray<number> = [
  323, 324, 325, 326, 327, 328,
]

/** 占位算子 3-47：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_47(left: number, right: number): number {
  const weighted = left * 48 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-47：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_47: ReadonlyArray<number> = [
  330, 331, 332, 333, 334, 335,
]

/** 占位算子 3-48：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_48(left: number, right: number): number {
  const weighted = left * 49 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-48：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_48: ReadonlyArray<number> = [
  337, 338, 339, 340, 341, 342,
]

/** 占位算子 3-49：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_49(left: number, right: number): number {
  const weighted = left * 50 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-49：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_49: ReadonlyArray<number> = [
  344, 345, 346, 347, 348, 349,
]

/** 占位算子 3-50：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_50(left: number, right: number): number {
  const weighted = left * 51 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-50：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_50: ReadonlyArray<number> = [
  351, 352, 353, 354, 355, 356,
]

/** 占位算子 3-51：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_51(left: number, right: number): number {
  const weighted = left * 52 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-51：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_51: ReadonlyArray<number> = [
  358, 359, 360, 361, 362, 363,
]

/** 占位算子 3-52：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_52(left: number, right: number): number {
  const weighted = left * 53 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-52：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_52: ReadonlyArray<number> = [
  365, 366, 367, 368, 369, 370,
]

/** 占位算子 3-53：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_53(left: number, right: number): number {
  const weighted = left * 54 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-53：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_53: ReadonlyArray<number> = [
  372, 373, 374, 375, 376, 377,
]

/** 占位算子 3-54：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_54(left: number, right: number): number {
  const weighted = left * 55 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-54：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_54: ReadonlyArray<number> = [
  379, 380, 381, 382, 383, 384,
]

/** 占位算子 3-55：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_55(left: number, right: number): number {
  const weighted = left * 56 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-55：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_55: ReadonlyArray<number> = [
  386, 387, 388, 389, 390, 391,
]

/** 占位算子 3-56：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_56(left: number, right: number): number {
  const weighted = left * 57 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-56：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_56: ReadonlyArray<number> = [
  393, 394, 395, 396, 397, 398,
]

/** 占位算子 3-57：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_57(left: number, right: number): number {
  const weighted = left * 58 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-57：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_57: ReadonlyArray<number> = [
  400, 401, 402, 403, 404, 405,
]

/** 占位算子 3-58：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_58(left: number, right: number): number {
  const weighted = left * 59 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-58：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_58: ReadonlyArray<number> = [
  407, 408, 409, 410, 411, 412,
]

/** 占位算子 3-59：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_59(left: number, right: number): number {
  const weighted = left * 60 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-59：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_59: ReadonlyArray<number> = [
  414, 415, 416, 417, 418, 419,
]

/** 占位算子 3-60：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_60(left: number, right: number): number {
  const weighted = left * 61 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-60：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_60: ReadonlyArray<number> = [
  421, 422, 423, 424, 425, 426,
]

/** 占位算子 3-61：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_61(left: number, right: number): number {
  const weighted = left * 62 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-61：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_61: ReadonlyArray<number> = [
  428, 429, 430, 431, 432, 433,
]

/** 占位算子 3-62：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_62(left: number, right: number): number {
  const weighted = left * 63 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-62：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_62: ReadonlyArray<number> = [
  435, 436, 437, 438, 439, 440,
]

/** 占位算子 3-63：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_63(left: number, right: number): number {
  const weighted = left * 64 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-63：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_63: ReadonlyArray<number> = [
  442, 443, 444, 445, 446, 447,
]

/** 占位算子 3-64：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_64(left: number, right: number): number {
  const weighted = left * 65 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-64：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_64: ReadonlyArray<number> = [
  449, 450, 451, 452, 453, 454,
]

/** 占位算子 3-65：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_65(left: number, right: number): number {
  const weighted = left * 66 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-65：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_65: ReadonlyArray<number> = [
  456, 457, 458, 459, 460, 461,
]

/** 占位算子 3-66：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_66(left: number, right: number): number {
  const weighted = left * 67 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-66：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_66: ReadonlyArray<number> = [
  463, 464, 465, 466, 467, 468,
]

/** 占位算子 3-67：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_67(left: number, right: number): number {
  const weighted = left * 68 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-67：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_67: ReadonlyArray<number> = [
  470, 471, 472, 473, 474, 475,
]

/** 占位算子 3-68：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_68(left: number, right: number): number {
  const weighted = left * 69 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-68：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_68: ReadonlyArray<number> = [
  477, 478, 479, 480, 481, 482,
]

/** 占位算子 3-69：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_69(left: number, right: number): number {
  const weighted = left * 70 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-69：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_69: ReadonlyArray<number> = [
  484, 485, 486, 487, 488, 489,
]

/** 占位算子 3-70：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_70(left: number, right: number): number {
  const weighted = left * 71 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-70：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_70: ReadonlyArray<number> = [
  491, 492, 493, 494, 495, 496,
]

/** 占位算子 3-71：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_71(left: number, right: number): number {
  const weighted = left * 72 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-71：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_71: ReadonlyArray<number> = [
  498, 499, 500, 501, 502, 503,
]

/** 占位算子 3-72：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_72(left: number, right: number): number {
  const weighted = left * 73 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-72：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_72: ReadonlyArray<number> = [
  505, 506, 507, 508, 509, 510,
]

/** 占位算子 3-73：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce3_73(left: number, right: number): number {
  const weighted = left * 74 + right * 4
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 3-73：给上面的算子一组确定的输入。 */
export const PROBE_SEED_3_73: ReadonlyArray<number> = [
  512, 513, 514, 515, 516, 517,
]

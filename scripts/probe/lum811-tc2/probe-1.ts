/**
 * LUM-811 / TC2 判决探针 —— 机械生成的占位实现，第 2 / 6 个文件。
 * 见同目录 README.md。不接调用方，扫完即关，不合并。
 */

/** 占位算子 1-0：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_0(left: number, right: number): number {
  const weighted = left * 1 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-0：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_0: ReadonlyArray<number> = [1, 2, 3, 4, 5, 6]

/** 占位算子 1-1：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_1(left: number, right: number): number {
  const weighted = left * 2 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-1：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_1: ReadonlyArray<number> = [8, 9, 10, 11, 12, 13]

/** 占位算子 1-2：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_2(left: number, right: number): number {
  const weighted = left * 3 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-2：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_2: ReadonlyArray<number> = [15, 16, 17, 18, 19, 20]

/** 占位算子 1-3：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_3(left: number, right: number): number {
  const weighted = left * 4 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-3：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_3: ReadonlyArray<number> = [22, 23, 24, 25, 26, 27]

/** 占位算子 1-4：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_4(left: number, right: number): number {
  const weighted = left * 5 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-4：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_4: ReadonlyArray<number> = [29, 30, 31, 32, 33, 34]

/** 占位算子 1-5：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_5(left: number, right: number): number {
  const weighted = left * 6 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-5：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_5: ReadonlyArray<number> = [36, 37, 38, 39, 40, 41]

/** 占位算子 1-6：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_6(left: number, right: number): number {
  const weighted = left * 7 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-6：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_6: ReadonlyArray<number> = [43, 44, 45, 46, 47, 48]

/** 占位算子 1-7：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_7(left: number, right: number): number {
  const weighted = left * 8 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-7：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_7: ReadonlyArray<number> = [50, 51, 52, 53, 54, 55]

/** 占位算子 1-8：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_8(left: number, right: number): number {
  const weighted = left * 9 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-8：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_8: ReadonlyArray<number> = [57, 58, 59, 60, 61, 62]

/** 占位算子 1-9：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_9(left: number, right: number): number {
  const weighted = left * 10 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-9：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_9: ReadonlyArray<number> = [64, 65, 66, 67, 68, 69]

/** 占位算子 1-10：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_10(left: number, right: number): number {
  const weighted = left * 11 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-10：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_10: ReadonlyArray<number> = [71, 72, 73, 74, 75, 76]

/** 占位算子 1-11：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_11(left: number, right: number): number {
  const weighted = left * 12 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-11：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_11: ReadonlyArray<number> = [78, 79, 80, 81, 82, 83]

/** 占位算子 1-12：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_12(left: number, right: number): number {
  const weighted = left * 13 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-12：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_12: ReadonlyArray<number> = [85, 86, 87, 88, 89, 90]

/** 占位算子 1-13：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_13(left: number, right: number): number {
  const weighted = left * 14 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-13：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_13: ReadonlyArray<number> = [92, 93, 94, 95, 96, 97]

/** 占位算子 1-14：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_14(left: number, right: number): number {
  const weighted = left * 15 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-14：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_14: ReadonlyArray<number> = [
  99, 100, 101, 102, 103, 104,
]

/** 占位算子 1-15：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_15(left: number, right: number): number {
  const weighted = left * 16 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-15：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_15: ReadonlyArray<number> = [
  106, 107, 108, 109, 110, 111,
]

/** 占位算子 1-16：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_16(left: number, right: number): number {
  const weighted = left * 17 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-16：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_16: ReadonlyArray<number> = [
  113, 114, 115, 116, 117, 118,
]

/** 占位算子 1-17：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_17(left: number, right: number): number {
  const weighted = left * 18 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-17：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_17: ReadonlyArray<number> = [
  120, 121, 122, 123, 124, 125,
]

/** 占位算子 1-18：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_18(left: number, right: number): number {
  const weighted = left * 19 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-18：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_18: ReadonlyArray<number> = [
  127, 128, 129, 130, 131, 132,
]

/** 占位算子 1-19：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_19(left: number, right: number): number {
  const weighted = left * 20 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-19：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_19: ReadonlyArray<number> = [
  134, 135, 136, 137, 138, 139,
]

/** 占位算子 1-20：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_20(left: number, right: number): number {
  const weighted = left * 21 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-20：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_20: ReadonlyArray<number> = [
  141, 142, 143, 144, 145, 146,
]

/** 占位算子 1-21：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_21(left: number, right: number): number {
  const weighted = left * 22 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-21：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_21: ReadonlyArray<number> = [
  148, 149, 150, 151, 152, 153,
]

/** 占位算子 1-22：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_22(left: number, right: number): number {
  const weighted = left * 23 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-22：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_22: ReadonlyArray<number> = [
  155, 156, 157, 158, 159, 160,
]

/** 占位算子 1-23：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_23(left: number, right: number): number {
  const weighted = left * 24 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-23：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_23: ReadonlyArray<number> = [
  162, 163, 164, 165, 166, 167,
]

/** 占位算子 1-24：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_24(left: number, right: number): number {
  const weighted = left * 25 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-24：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_24: ReadonlyArray<number> = [
  169, 170, 171, 172, 173, 174,
]

/** 占位算子 1-25：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_25(left: number, right: number): number {
  const weighted = left * 26 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-25：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_25: ReadonlyArray<number> = [
  176, 177, 178, 179, 180, 181,
]

/** 占位算子 1-26：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_26(left: number, right: number): number {
  const weighted = left * 27 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-26：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_26: ReadonlyArray<number> = [
  183, 184, 185, 186, 187, 188,
]

/** 占位算子 1-27：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_27(left: number, right: number): number {
  const weighted = left * 28 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-27：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_27: ReadonlyArray<number> = [
  190, 191, 192, 193, 194, 195,
]

/** 占位算子 1-28：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_28(left: number, right: number): number {
  const weighted = left * 29 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-28：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_28: ReadonlyArray<number> = [
  197, 198, 199, 200, 201, 202,
]

/** 占位算子 1-29：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_29(left: number, right: number): number {
  const weighted = left * 30 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-29：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_29: ReadonlyArray<number> = [
  204, 205, 206, 207, 208, 209,
]

/** 占位算子 1-30：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_30(left: number, right: number): number {
  const weighted = left * 31 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-30：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_30: ReadonlyArray<number> = [
  211, 212, 213, 214, 215, 216,
]

/** 占位算子 1-31：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_31(left: number, right: number): number {
  const weighted = left * 32 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-31：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_31: ReadonlyArray<number> = [
  218, 219, 220, 221, 222, 223,
]

/** 占位算子 1-32：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_32(left: number, right: number): number {
  const weighted = left * 33 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-32：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_32: ReadonlyArray<number> = [
  225, 226, 227, 228, 229, 230,
]

/** 占位算子 1-33：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_33(left: number, right: number): number {
  const weighted = left * 34 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-33：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_33: ReadonlyArray<number> = [
  232, 233, 234, 235, 236, 237,
]

/** 占位算子 1-34：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_34(left: number, right: number): number {
  const weighted = left * 35 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-34：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_34: ReadonlyArray<number> = [
  239, 240, 241, 242, 243, 244,
]

/** 占位算子 1-35：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_35(left: number, right: number): number {
  const weighted = left * 36 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-35：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_35: ReadonlyArray<number> = [
  246, 247, 248, 249, 250, 251,
]

/** 占位算子 1-36：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_36(left: number, right: number): number {
  const weighted = left * 37 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-36：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_36: ReadonlyArray<number> = [
  253, 254, 255, 256, 257, 258,
]

/** 占位算子 1-37：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_37(left: number, right: number): number {
  const weighted = left * 38 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-37：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_37: ReadonlyArray<number> = [
  260, 261, 262, 263, 264, 265,
]

/** 占位算子 1-38：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_38(left: number, right: number): number {
  const weighted = left * 39 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-38：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_38: ReadonlyArray<number> = [
  267, 268, 269, 270, 271, 272,
]

/** 占位算子 1-39：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_39(left: number, right: number): number {
  const weighted = left * 40 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-39：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_39: ReadonlyArray<number> = [
  274, 275, 276, 277, 278, 279,
]

/** 占位算子 1-40：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_40(left: number, right: number): number {
  const weighted = left * 41 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-40：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_40: ReadonlyArray<number> = [
  281, 282, 283, 284, 285, 286,
]

/** 占位算子 1-41：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_41(left: number, right: number): number {
  const weighted = left * 42 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-41：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_41: ReadonlyArray<number> = [
  288, 289, 290, 291, 292, 293,
]

/** 占位算子 1-42：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_42(left: number, right: number): number {
  const weighted = left * 43 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-42：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_42: ReadonlyArray<number> = [
  295, 296, 297, 298, 299, 300,
]

/** 占位算子 1-43：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_43(left: number, right: number): number {
  const weighted = left * 44 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-43：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_43: ReadonlyArray<number> = [
  302, 303, 304, 305, 306, 307,
]

/** 占位算子 1-44：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_44(left: number, right: number): number {
  const weighted = left * 45 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-44：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_44: ReadonlyArray<number> = [
  309, 310, 311, 312, 313, 314,
]

/** 占位算子 1-45：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_45(left: number, right: number): number {
  const weighted = left * 46 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-45：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_45: ReadonlyArray<number> = [
  316, 317, 318, 319, 320, 321,
]

/** 占位算子 1-46：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_46(left: number, right: number): number {
  const weighted = left * 47 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-46：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_46: ReadonlyArray<number> = [
  323, 324, 325, 326, 327, 328,
]

/** 占位算子 1-47：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_47(left: number, right: number): number {
  const weighted = left * 48 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-47：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_47: ReadonlyArray<number> = [
  330, 331, 332, 333, 334, 335,
]

/** 占位算子 1-48：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_48(left: number, right: number): number {
  const weighted = left * 49 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-48：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_48: ReadonlyArray<number> = [
  337, 338, 339, 340, 341, 342,
]

/** 占位算子 1-49：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_49(left: number, right: number): number {
  const weighted = left * 50 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-49：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_49: ReadonlyArray<number> = [
  344, 345, 346, 347, 348, 349,
]

/** 占位算子 1-50：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_50(left: number, right: number): number {
  const weighted = left * 51 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-50：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_50: ReadonlyArray<number> = [
  351, 352, 353, 354, 355, 356,
]

/** 占位算子 1-51：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_51(left: number, right: number): number {
  const weighted = left * 52 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-51：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_51: ReadonlyArray<number> = [
  358, 359, 360, 361, 362, 363,
]

/** 占位算子 1-52：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_52(left: number, right: number): number {
  const weighted = left * 53 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-52：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_52: ReadonlyArray<number> = [
  365, 366, 367, 368, 369, 370,
]

/** 占位算子 1-53：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_53(left: number, right: number): number {
  const weighted = left * 54 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-53：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_53: ReadonlyArray<number> = [
  372, 373, 374, 375, 376, 377,
]

/** 占位算子 1-54：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_54(left: number, right: number): number {
  const weighted = left * 55 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-54：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_54: ReadonlyArray<number> = [
  379, 380, 381, 382, 383, 384,
]

/** 占位算子 1-55：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_55(left: number, right: number): number {
  const weighted = left * 56 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-55：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_55: ReadonlyArray<number> = [
  386, 387, 388, 389, 390, 391,
]

/** 占位算子 1-56：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_56(left: number, right: number): number {
  const weighted = left * 57 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-56：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_56: ReadonlyArray<number> = [
  393, 394, 395, 396, 397, 398,
]

/** 占位算子 1-57：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_57(left: number, right: number): number {
  const weighted = left * 58 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-57：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_57: ReadonlyArray<number> = [
  400, 401, 402, 403, 404, 405,
]

/** 占位算子 1-58：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_58(left: number, right: number): number {
  const weighted = left * 59 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-58：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_58: ReadonlyArray<number> = [
  407, 408, 409, 410, 411, 412,
]

/** 占位算子 1-59：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_59(left: number, right: number): number {
  const weighted = left * 60 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-59：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_59: ReadonlyArray<number> = [
  414, 415, 416, 417, 418, 419,
]

/** 占位算子 1-60：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_60(left: number, right: number): number {
  const weighted = left * 61 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-60：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_60: ReadonlyArray<number> = [
  421, 422, 423, 424, 425, 426,
]

/** 占位算子 1-61：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_61(left: number, right: number): number {
  const weighted = left * 62 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-61：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_61: ReadonlyArray<number> = [
  428, 429, 430, 431, 432, 433,
]

/** 占位算子 1-62：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_62(left: number, right: number): number {
  const weighted = left * 63 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-62：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_62: ReadonlyArray<number> = [
  435, 436, 437, 438, 439, 440,
]

/** 占位算子 1-63：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_63(left: number, right: number): number {
  const weighted = left * 64 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-63：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_63: ReadonlyArray<number> = [
  442, 443, 444, 445, 446, 447,
]

/** 占位算子 1-64：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_64(left: number, right: number): number {
  const weighted = left * 65 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-64：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_64: ReadonlyArray<number> = [
  449, 450, 451, 452, 453, 454,
]

/** 占位算子 1-65：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_65(left: number, right: number): number {
  const weighted = left * 66 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-65：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_65: ReadonlyArray<number> = [
  456, 457, 458, 459, 460, 461,
]

/** 占位算子 1-66：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_66(left: number, right: number): number {
  const weighted = left * 67 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-66：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_66: ReadonlyArray<number> = [
  463, 464, 465, 466, 467, 468,
]

/** 占位算子 1-67：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_67(left: number, right: number): number {
  const weighted = left * 68 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-67：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_67: ReadonlyArray<number> = [
  470, 471, 472, 473, 474, 475,
]

/** 占位算子 1-68：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_68(left: number, right: number): number {
  const weighted = left * 69 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-68：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_68: ReadonlyArray<number> = [
  477, 478, 479, 480, 481, 482,
]

/** 占位算子 1-69：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_69(left: number, right: number): number {
  const weighted = left * 70 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-69：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_69: ReadonlyArray<number> = [
  484, 485, 486, 487, 488, 489,
]

/** 占位算子 1-70：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_70(left: number, right: number): number {
  const weighted = left * 71 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-70：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_70: ReadonlyArray<number> = [
  491, 492, 493, 494, 495, 496,
]

/** 占位算子 1-71：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_71(left: number, right: number): number {
  const weighted = left * 72 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-71：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_71: ReadonlyArray<number> = [
  498, 499, 500, 501, 502, 503,
]

/** 占位算子 1-72：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_72(left: number, right: number): number {
  const weighted = left * 73 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-72：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_72: ReadonlyArray<number> = [
  505, 506, 507, 508, 509, 510,
]

/** 占位算子 1-73：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce1_73(left: number, right: number): number {
  const weighted = left * 74 + right * 2
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 1-73：给上面的算子一组确定的输入。 */
export const PROBE_SEED_1_73: ReadonlyArray<number> = [
  512, 513, 514, 515, 516, 517,
]

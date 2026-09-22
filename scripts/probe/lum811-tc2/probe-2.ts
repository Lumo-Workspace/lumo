/**
 * LUM-811 / TC2 判决探针 —— 机械生成的占位实现，第 3 / 6 个文件。
 * 见同目录 README.md。不接调用方，扫完即关，不合并。
 */

/** 占位算子 2-0：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_0(left: number, right: number): number {
  const weighted = left * 1 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-0：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_0: ReadonlyArray<number> = [1, 2, 3, 4, 5, 6]

/** 占位算子 2-1：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_1(left: number, right: number): number {
  const weighted = left * 2 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-1：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_1: ReadonlyArray<number> = [8, 9, 10, 11, 12, 13]

/** 占位算子 2-2：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_2(left: number, right: number): number {
  const weighted = left * 3 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-2：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_2: ReadonlyArray<number> = [15, 16, 17, 18, 19, 20]

/** 占位算子 2-3：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_3(left: number, right: number): number {
  const weighted = left * 4 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-3：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_3: ReadonlyArray<number> = [22, 23, 24, 25, 26, 27]

/** 占位算子 2-4：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_4(left: number, right: number): number {
  const weighted = left * 5 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-4：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_4: ReadonlyArray<number> = [29, 30, 31, 32, 33, 34]

/** 占位算子 2-5：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_5(left: number, right: number): number {
  const weighted = left * 6 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-5：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_5: ReadonlyArray<number> = [36, 37, 38, 39, 40, 41]

/** 占位算子 2-6：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_6(left: number, right: number): number {
  const weighted = left * 7 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-6：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_6: ReadonlyArray<number> = [43, 44, 45, 46, 47, 48]

/** 占位算子 2-7：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_7(left: number, right: number): number {
  const weighted = left * 8 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-7：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_7: ReadonlyArray<number> = [50, 51, 52, 53, 54, 55]

/** 占位算子 2-8：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_8(left: number, right: number): number {
  const weighted = left * 9 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-8：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_8: ReadonlyArray<number> = [57, 58, 59, 60, 61, 62]

/** 占位算子 2-9：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_9(left: number, right: number): number {
  const weighted = left * 10 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-9：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_9: ReadonlyArray<number> = [64, 65, 66, 67, 68, 69]

/** 占位算子 2-10：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_10(left: number, right: number): number {
  const weighted = left * 11 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-10：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_10: ReadonlyArray<number> = [71, 72, 73, 74, 75, 76]

/** 占位算子 2-11：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_11(left: number, right: number): number {
  const weighted = left * 12 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-11：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_11: ReadonlyArray<number> = [78, 79, 80, 81, 82, 83]

/** 占位算子 2-12：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_12(left: number, right: number): number {
  const weighted = left * 13 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-12：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_12: ReadonlyArray<number> = [85, 86, 87, 88, 89, 90]

/** 占位算子 2-13：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_13(left: number, right: number): number {
  const weighted = left * 14 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-13：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_13: ReadonlyArray<number> = [92, 93, 94, 95, 96, 97]

/** 占位算子 2-14：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_14(left: number, right: number): number {
  const weighted = left * 15 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-14：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_14: ReadonlyArray<number> = [
  99, 100, 101, 102, 103, 104,
]

/** 占位算子 2-15：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_15(left: number, right: number): number {
  const weighted = left * 16 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-15：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_15: ReadonlyArray<number> = [
  106, 107, 108, 109, 110, 111,
]

/** 占位算子 2-16：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_16(left: number, right: number): number {
  const weighted = left * 17 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-16：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_16: ReadonlyArray<number> = [
  113, 114, 115, 116, 117, 118,
]

/** 占位算子 2-17：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_17(left: number, right: number): number {
  const weighted = left * 18 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-17：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_17: ReadonlyArray<number> = [
  120, 121, 122, 123, 124, 125,
]

/** 占位算子 2-18：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_18(left: number, right: number): number {
  const weighted = left * 19 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-18：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_18: ReadonlyArray<number> = [
  127, 128, 129, 130, 131, 132,
]

/** 占位算子 2-19：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_19(left: number, right: number): number {
  const weighted = left * 20 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-19：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_19: ReadonlyArray<number> = [
  134, 135, 136, 137, 138, 139,
]

/** 占位算子 2-20：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_20(left: number, right: number): number {
  const weighted = left * 21 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-20：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_20: ReadonlyArray<number> = [
  141, 142, 143, 144, 145, 146,
]

/** 占位算子 2-21：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_21(left: number, right: number): number {
  const weighted = left * 22 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-21：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_21: ReadonlyArray<number> = [
  148, 149, 150, 151, 152, 153,
]

/** 占位算子 2-22：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_22(left: number, right: number): number {
  const weighted = left * 23 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-22：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_22: ReadonlyArray<number> = [
  155, 156, 157, 158, 159, 160,
]

/** 占位算子 2-23：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_23(left: number, right: number): number {
  const weighted = left * 24 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-23：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_23: ReadonlyArray<number> = [
  162, 163, 164, 165, 166, 167,
]

/** 占位算子 2-24：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_24(left: number, right: number): number {
  const weighted = left * 25 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-24：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_24: ReadonlyArray<number> = [
  169, 170, 171, 172, 173, 174,
]

/** 占位算子 2-25：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_25(left: number, right: number): number {
  const weighted = left * 26 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-25：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_25: ReadonlyArray<number> = [
  176, 177, 178, 179, 180, 181,
]

/** 占位算子 2-26：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_26(left: number, right: number): number {
  const weighted = left * 27 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-26：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_26: ReadonlyArray<number> = [
  183, 184, 185, 186, 187, 188,
]

/** 占位算子 2-27：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_27(left: number, right: number): number {
  const weighted = left * 28 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-27：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_27: ReadonlyArray<number> = [
  190, 191, 192, 193, 194, 195,
]

/** 占位算子 2-28：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_28(left: number, right: number): number {
  const weighted = left * 29 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-28：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_28: ReadonlyArray<number> = [
  197, 198, 199, 200, 201, 202,
]

/** 占位算子 2-29：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_29(left: number, right: number): number {
  const weighted = left * 30 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-29：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_29: ReadonlyArray<number> = [
  204, 205, 206, 207, 208, 209,
]

/** 占位算子 2-30：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_30(left: number, right: number): number {
  const weighted = left * 31 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-30：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_30: ReadonlyArray<number> = [
  211, 212, 213, 214, 215, 216,
]

/** 占位算子 2-31：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_31(left: number, right: number): number {
  const weighted = left * 32 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-31：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_31: ReadonlyArray<number> = [
  218, 219, 220, 221, 222, 223,
]

/** 占位算子 2-32：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_32(left: number, right: number): number {
  const weighted = left * 33 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-32：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_32: ReadonlyArray<number> = [
  225, 226, 227, 228, 229, 230,
]

/** 占位算子 2-33：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_33(left: number, right: number): number {
  const weighted = left * 34 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-33：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_33: ReadonlyArray<number> = [
  232, 233, 234, 235, 236, 237,
]

/** 占位算子 2-34：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_34(left: number, right: number): number {
  const weighted = left * 35 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-34：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_34: ReadonlyArray<number> = [
  239, 240, 241, 242, 243, 244,
]

/** 占位算子 2-35：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_35(left: number, right: number): number {
  const weighted = left * 36 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-35：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_35: ReadonlyArray<number> = [
  246, 247, 248, 249, 250, 251,
]

/** 占位算子 2-36：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_36(left: number, right: number): number {
  const weighted = left * 37 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-36：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_36: ReadonlyArray<number> = [
  253, 254, 255, 256, 257, 258,
]

/** 占位算子 2-37：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_37(left: number, right: number): number {
  const weighted = left * 38 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-37：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_37: ReadonlyArray<number> = [
  260, 261, 262, 263, 264, 265,
]

/** 占位算子 2-38：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_38(left: number, right: number): number {
  const weighted = left * 39 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-38：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_38: ReadonlyArray<number> = [
  267, 268, 269, 270, 271, 272,
]

/** 占位算子 2-39：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_39(left: number, right: number): number {
  const weighted = left * 40 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-39：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_39: ReadonlyArray<number> = [
  274, 275, 276, 277, 278, 279,
]

/** 占位算子 2-40：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_40(left: number, right: number): number {
  const weighted = left * 41 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-40：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_40: ReadonlyArray<number> = [
  281, 282, 283, 284, 285, 286,
]

/** 占位算子 2-41：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_41(left: number, right: number): number {
  const weighted = left * 42 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-41：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_41: ReadonlyArray<number> = [
  288, 289, 290, 291, 292, 293,
]

/** 占位算子 2-42：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_42(left: number, right: number): number {
  const weighted = left * 43 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-42：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_42: ReadonlyArray<number> = [
  295, 296, 297, 298, 299, 300,
]

/** 占位算子 2-43：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_43(left: number, right: number): number {
  const weighted = left * 44 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-43：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_43: ReadonlyArray<number> = [
  302, 303, 304, 305, 306, 307,
]

/** 占位算子 2-44：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_44(left: number, right: number): number {
  const weighted = left * 45 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-44：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_44: ReadonlyArray<number> = [
  309, 310, 311, 312, 313, 314,
]

/** 占位算子 2-45：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_45(left: number, right: number): number {
  const weighted = left * 46 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-45：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_45: ReadonlyArray<number> = [
  316, 317, 318, 319, 320, 321,
]

/** 占位算子 2-46：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_46(left: number, right: number): number {
  const weighted = left * 47 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-46：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_46: ReadonlyArray<number> = [
  323, 324, 325, 326, 327, 328,
]

/** 占位算子 2-47：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_47(left: number, right: number): number {
  const weighted = left * 48 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-47：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_47: ReadonlyArray<number> = [
  330, 331, 332, 333, 334, 335,
]

/** 占位算子 2-48：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_48(left: number, right: number): number {
  const weighted = left * 49 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-48：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_48: ReadonlyArray<number> = [
  337, 338, 339, 340, 341, 342,
]

/** 占位算子 2-49：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_49(left: number, right: number): number {
  const weighted = left * 50 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-49：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_49: ReadonlyArray<number> = [
  344, 345, 346, 347, 348, 349,
]

/** 占位算子 2-50：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_50(left: number, right: number): number {
  const weighted = left * 51 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-50：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_50: ReadonlyArray<number> = [
  351, 352, 353, 354, 355, 356,
]

/** 占位算子 2-51：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_51(left: number, right: number): number {
  const weighted = left * 52 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-51：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_51: ReadonlyArray<number> = [
  358, 359, 360, 361, 362, 363,
]

/** 占位算子 2-52：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_52(left: number, right: number): number {
  const weighted = left * 53 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-52：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_52: ReadonlyArray<number> = [
  365, 366, 367, 368, 369, 370,
]

/** 占位算子 2-53：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_53(left: number, right: number): number {
  const weighted = left * 54 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-53：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_53: ReadonlyArray<number> = [
  372, 373, 374, 375, 376, 377,
]

/** 占位算子 2-54：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_54(left: number, right: number): number {
  const weighted = left * 55 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-54：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_54: ReadonlyArray<number> = [
  379, 380, 381, 382, 383, 384,
]

/** 占位算子 2-55：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_55(left: number, right: number): number {
  const weighted = left * 56 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-55：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_55: ReadonlyArray<number> = [
  386, 387, 388, 389, 390, 391,
]

/** 占位算子 2-56：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_56(left: number, right: number): number {
  const weighted = left * 57 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-56：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_56: ReadonlyArray<number> = [
  393, 394, 395, 396, 397, 398,
]

/** 占位算子 2-57：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_57(left: number, right: number): number {
  const weighted = left * 58 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-57：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_57: ReadonlyArray<number> = [
  400, 401, 402, 403, 404, 405,
]

/** 占位算子 2-58：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_58(left: number, right: number): number {
  const weighted = left * 59 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-58：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_58: ReadonlyArray<number> = [
  407, 408, 409, 410, 411, 412,
]

/** 占位算子 2-59：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_59(left: number, right: number): number {
  const weighted = left * 60 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-59：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_59: ReadonlyArray<number> = [
  414, 415, 416, 417, 418, 419,
]

/** 占位算子 2-60：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_60(left: number, right: number): number {
  const weighted = left * 61 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-60：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_60: ReadonlyArray<number> = [
  421, 422, 423, 424, 425, 426,
]

/** 占位算子 2-61：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_61(left: number, right: number): number {
  const weighted = left * 62 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-61：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_61: ReadonlyArray<number> = [
  428, 429, 430, 431, 432, 433,
]

/** 占位算子 2-62：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_62(left: number, right: number): number {
  const weighted = left * 63 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-62：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_62: ReadonlyArray<number> = [
  435, 436, 437, 438, 439, 440,
]

/** 占位算子 2-63：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_63(left: number, right: number): number {
  const weighted = left * 64 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-63：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_63: ReadonlyArray<number> = [
  442, 443, 444, 445, 446, 447,
]

/** 占位算子 2-64：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_64(left: number, right: number): number {
  const weighted = left * 65 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-64：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_64: ReadonlyArray<number> = [
  449, 450, 451, 452, 453, 454,
]

/** 占位算子 2-65：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_65(left: number, right: number): number {
  const weighted = left * 66 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-65：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_65: ReadonlyArray<number> = [
  456, 457, 458, 459, 460, 461,
]

/** 占位算子 2-66：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_66(left: number, right: number): number {
  const weighted = left * 67 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-66：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_66: ReadonlyArray<number> = [
  463, 464, 465, 466, 467, 468,
]

/** 占位算子 2-67：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_67(left: number, right: number): number {
  const weighted = left * 68 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-67：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_67: ReadonlyArray<number> = [
  470, 471, 472, 473, 474, 475,
]

/** 占位算子 2-68：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_68(left: number, right: number): number {
  const weighted = left * 69 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-68：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_68: ReadonlyArray<number> = [
  477, 478, 479, 480, 481, 482,
]

/** 占位算子 2-69：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_69(left: number, right: number): number {
  const weighted = left * 70 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-69：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_69: ReadonlyArray<number> = [
  484, 485, 486, 487, 488, 489,
]

/** 占位算子 2-70：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_70(left: number, right: number): number {
  const weighted = left * 71 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-70：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_70: ReadonlyArray<number> = [
  491, 492, 493, 494, 495, 496,
]

/** 占位算子 2-71：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_71(left: number, right: number): number {
  const weighted = left * 72 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-71：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_71: ReadonlyArray<number> = [
  498, 499, 500, 501, 502, 503,
]

/** 占位算子 2-72：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_72(left: number, right: number): number {
  const weighted = left * 73 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-72：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_72: ReadonlyArray<number> = [
  505, 506, 507, 508, 509, 510,
]

/** 占位算子 2-73：把两个计数折成一个稳定的整数，无副作用。 */
export function probeReduce2_73(left: number, right: number): number {
  const weighted = left * 74 + right * 3
  const folded = weighted % 1_000_003
  return folded < 0 ? folded + 1_000_003 : folded
}

/** 占位常量 2-73：给上面的算子一组确定的输入。 */
export const PROBE_SEED_2_73: ReadonlyArray<number> = [
  512, 513, 514, 515, 516, 517,
]

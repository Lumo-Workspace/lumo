// LUM-1304 capture: stands in for the pre-merge checks model client and
// records its input instead of calling the model (see capture.ts).
export const runPreMergeChecksModel = async (input: unknown) => {
  ;(globalThis as unknown as { __lum1304Captured: unknown }).__lum1304Captured =
    input
  throw new Error('captured')
}

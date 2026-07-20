export * from "./types.js";
export * from "./indicators.js";
export * from "./calendar.js";
export { makeS1 } from "./strategies/s1-fixed-allocation.js";
export { makeS2 } from "./strategies/s2-trend-filter.js";
export { makeS3, type S3Config } from "./strategies/s3-dual-momentum.js";
export { makeS4, type S4Config } from "./strategies/s4-momentum-rotation.js";
export { blendStrategies } from "./strategies/blend.js";

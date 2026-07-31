export * from "./dsl-types.js";
export { normalizeAll, normalizeCard, splitName, parseColors, isLorcanaCard } from "./normalize.js";
export type { RawBulkCard } from "./normalize.js";
export { generateAll, printReport } from "./generate-scripts.js";
export type { CoverageReport, GenerateResult } from "./generate-scripts.js";
export {
  generateScript,
  parseKeywordHeader,
  matchSentence,
  splitBlocks,
  splitAbilityName,
  stripReminders,
  SENTENCE_TEMPLATES,
} from "./templates.js";
export type { GeneratedCard, SentenceContext, SentenceResult } from "./templates.js";

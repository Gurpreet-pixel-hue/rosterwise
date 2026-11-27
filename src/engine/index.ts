export * from "./types";
export * from "./calendar";
export * from "./demand";
export * from "./availability";
export { generateRoster, type GenerateOptions, type GenerateResult } from "./generate";
export { validateRoster, sortIssues } from "./validate";
export { analyzeRoster, compOffEarnedFor } from "./analyze";
export { suggestionsFor, applySuggestion, attachSuggestions } from "./suggest";
export { applyEdits, type EditFlags } from "./edit";
export {
  diffRosters,
  type RosterDiff,
  type RosterSnapshot,
  type CellChange,
  type CellState,
} from "./diff";
export { explainIssue } from "./explain";
export { simulateChange, applyChange, type SimulationResult } from "./change";
export { coverageTable, type CoverageTable, type CoverageCell } from "./coverage";
export {
  backupReport,
  DEFAULT_BACKUP_PCT,
  type BackupReport,
  type BackupCandidate,
  type BackupStatus,
} from "./backup";
export { fairnessReport, type FairnessReport, type FairnessRow, type Spread } from "./fairness";

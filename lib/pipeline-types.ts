/**
 * Types for the document → refined → distilled → build pipeline.
 */

export interface PipelineInput {
  /** Plan / execution plan text */
  plan: string;
  /** Requirements text */
  requirements: string;
  /** PRD text */
  prd: string;
  /** Research text */
  research: string;
}

export interface RefinedDocs {
  prd: string;
  executionPlan: string;
  research: string;
  requirements: string;
}

export interface RepoDoc {
  name: string;
  content: string;
}

/** Projgen output: repo docs (AGENTS.md, README.md, docs/*.md). */
export type DistilledDocs = RepoDoc[];

export interface HumanGateQuestion {
  stage: "refiner" | "projgen" | "builder";
  question: string;
  options: string[];
  recommendedIndex: number;
  context?: string;
}

export interface PipelinePolicy {
  /** Consensus threshold 0–100. Above = auto-pick; below = ask human. */
  consensusThresholdPercent: number;
  /** Number of models to ask for consensus (e.g. 3 or 5). */
  consensusModelCount: number;
  /** Max models to try before giving up and asking human (e.g. 10 or 20). */
  consensusMaxModels: number;
}

export const DEFAULT_POLICY: PipelinePolicy = {
  consensusThresholdPercent: 80,
  consensusModelCount: 3,
  consensusMaxModels: 10,
};

/**
 * Cheap OpenRouter models for simple Q&A (consensus on clarification questions).
 * Pick-one-from-options doesn't need Opus/Sonnet; these keep cost low.
 */
export const CONSENSUS_MODELS = [
  "openai/gpt-4o-mini",
  "anthropic/claude-3-haiku",
  "google/gemini-flash-1.5",
  "meta-llama/llama-3.1-8b-instruct",
  "mistralai/mistral-7b-instruct",
] as const;

export type PipelineStageName =
  | "input"
  | "refiner"
  | "projgen"
  | "builder"
  | "finished";

export interface PipelineState {
  stage: PipelineStageName;
  input?: PipelineInput;
  refinedDocs?: RefinedDocs;
  distilledDocs?: DistilledDocs;
  /** When stage is paused for human. */
  humanGate?: HumanGateQuestion;
  /** Decisions made (for log). */
  decisionLog: Array<{
    stage: string;
    question?: string;
    consensusPercent?: number;
    chosenAnswer?: string;
    humanAnswer?: string;
  }>;
  /** Refiner conversation (for multi-step). */
  refinerConversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Projgen conversation (for multi-step). */
  projgenConversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Builder output path when finished (temp dir path; client may zip/download). */
  outputPath?: string;
  error?: string;
}

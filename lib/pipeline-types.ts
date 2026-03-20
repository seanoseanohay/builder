/**
 * Types for the document → refined → distilled → build pipeline.
 * Pipeline can start from intake (wizard-style) or from four docs (legacy).
 */

/** Intake-based input: company, website, problem, requirements, stack. */
export interface PipelineIntake {
  company: string;
  website: string;
  projectName: string;
  problemStatement: string;
  functionalReqs: string;
  languages?: string;
  status?: string;
  additionalNotes?: string;
}

/** Legacy: four docs pasted in (plan, requirements, PRD, research). */
export interface PipelineInput {
  plan: string;
  requirements: string;
  prd: string;
  research: string;
}

export type PipelineInputMode = "intake" | "documents";

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
  /** Consensus threshold 0–100. Above = auto-pick; below = escalate then ask human at 20. */
  consensusThresholdPercent: number;
  /** Initial number of models for consensus (first tier). */
  consensusModelCount: number;
  /** Max models to try before asking human. We escalate: 5 → 10 → 20; only at 20 do we ask human. */
  consensusMaxModels: number;
}

export const DEFAULT_POLICY: PipelinePolicy = {
  consensusThresholdPercent: 80,
  consensusModelCount: 3,
  consensusMaxModels: 20,
};

/** Escalation tiers: try 5 agents, then 10, then 20. Only after 20 with no consensus do we ask human. */
export const CONSENSUS_ESCALATION_TIERS = [5, 10, 20] as const;

/**
 * OpenRouter models for consensus Q&A (clarification / pick-one). Priority models first (GPT-5.4, Kimi K2.5).
 * We need at least 20 for escalation (5 → 10 → 20).
 */
export const CONSENSUS_MODELS = [
  "openai/gpt-5.4",
  "moonshotai/kimi-k2.5",
  "openai/gpt-4o-mini",
  "anthropic/claude-3-haiku",
  "google/gemini-flash-1.5",
  "meta-llama/llama-3.1-8b-instruct",
  "mistralai/mistral-7b-instruct",
  "google/gemini-2.0-flash-001",
  "anthropic/claude-3.5-haiku",
  "deepseek/deepseek-chat-v3",
  "deepseek/deepseek-chat-v3.1",
  "qwen/qwen-2.5-7b-instruct",
  "cohere/command-r-plus",
  "meta-llama/llama-3.3-70b-instruct",
  "google/gemini-flash-1.5-8b",
  "microsoft/phi-3-mini-4k-instruct",
  "anthropic/claude-3-haiku",
  "google/gemini-2.5-flash",
  "openai/gpt-4o-mini",
  "mistralai/mistral-7b-instruct",
] as const;

export type PipelineStageName =
  | "intake"
  | "research"
  | "layers"
  | "sds"
  | "prd"
  | "plan"
  | "refiner"
  | "projgen"
  | "builder"
  | "finished";

/** Partner research + inferred + discovered sections (from research stage). */
export interface PipelineResearchResult {
  partnerResearch: { summary: string; domain?: string; targetUsers?: string[]; products?: string[]; constraints?: string[]; notes?: string[]; sources?: Array<{ type: string; label: string; url?: string }> };
  inferred: { projectType?: string; stack?: string[]; constraints?: string[]; integrations?: string[]; targetUsers?: string[]; domain?: string };
  discoveredSections: Array<{ id: string; icon: string; label: string; sub: string; reason: string; priority: "required" | "optional"; category: string }>;
}

/** One locked SDS choice per section. */
export interface SDSDecision {
  sectionId: string;
  optionIndex: number;
  optionName: string;
}

export interface PipelineState {
  stage: PipelineStageName;
  /** When starting from intake. */
  intake?: PipelineIntake;
  /** When starting from four docs (legacy). */
  input?: PipelineInput;
  inputMode?: PipelineInputMode;
  /** After research stage. */
  researchResult?: PipelineResearchResult;
  /** Merged layers (core + discovered) for SDS. */
  proposedLayers?: PipelineResearchResult["discoveredSections"];
  /** Locked SDS choices (consensus or human). */
  sdsDecisions?: SDSDecision[];
  /** Cached options per section (for SDS stage). */
  sdsOptionsBySection?: Record<string, { recommendation: string; options: Array<{ name: string; verdict: string; reason: string }> }>;
  /** Generated PRD (after prd stage). */
  prd?: string;
  /** Generated plan + optional memory bank (after plan stage). */
  plan?: string;
  planMemoryBank?: Record<string, string>;
  /** Refined docs (after refiner). */
  refinedDocs?: RefinedDocs;
  /** Repo docs (after projgen). */
  distilledDocs?: DistilledDocs;
  /** When stage is paused for human. */
  humanGate?: HumanGateQuestion;
  /** For SDS human gate: which section we're asking about. */
  humanGateSectionId?: string;
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
  /** Builder output path when finished. */
  outputPath?: string;
  error?: string;
}

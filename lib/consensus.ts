/**
 * Consensus: given N model answers, compute agreement and whether to auto-pick or ask human.
 * Escalation: try 5 agents, then 10, then 20; only at 20 with no consensus do we ask human.
 */

import {
  CONSENSUS_ESCALATION_TIERS,
  CONSENSUS_MODELS,
  CONSENSUS_VOTER_TIERS,
  type PipelinePolicy,
} from "./pipeline-types";

export interface ConsensusResult {
  /** Percentage of answers that agree with the chosen answer (0–100). */
  consensusPercent: number;
  /** The answer that had the most votes (normalized). */
  chosenAnswer: string;
  /** Raw answers from each model (for logging). */
  rawAnswers: string[];
  /** True when consensus is below threshold → need human (only after trying 20 agents). */
  needsHuman: boolean;
  /** Normalized answer -> count, for building per-option consensus %. */
  answerCounts: Record<string, number>;
  /** Total number of answers (for percent calculation). */
  totalCount: number;
}

/** Normalize an answer for comparison: trim, lowercase, collapse whitespace. */
function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Compute consensus from N model answers.
 * @param answers Raw text answers from each model (e.g. "A", "Option B", "PostgreSQL").
 * @param thresholdPercent Minimum agreement (0–100) to auto-pick; below this needsHuman.
 */
export function computeConsensus(
  answers: string[],
  thresholdPercent: number,
): ConsensusResult {
  if (answers.length === 0) {
    return {
      consensusPercent: 0,
      chosenAnswer: "",
      rawAnswers: answers,
      needsHuman: true,
      answerCounts: {},
      totalCount: 0,
    };
  }

  const normalized = answers.map((a) => normalize(a));
  const counts = new Map<string, { count: number; canonical: string }>();

  for (let i = 0; i < normalized.length; i++) {
    const n = normalized[i];
    const raw = answers[i];
    if (!n) continue;
    const existing = counts.get(n);
    if (existing) {
      existing.count++;
    } else {
      counts.set(n, { count: 1, canonical: raw });
    }
  }

  let best: { count: number; canonical: string } = { count: 0, canonical: "" };
  for (const v of Array.from(counts.values())) {
    if (v.count > best.count) best = v;
  }

  const consensusPercent = Math.round((best.count / answers.length) * 100);
  const needsHuman = consensusPercent < thresholdPercent;
  const answerCounts: Record<string, number> = {};
  for (const entry of Array.from(counts.entries())) {
    answerCounts[entry[0]] = entry[1].count;
  }

  return {
    consensusPercent,
    chosenAnswer: best.canonical,
    rawAnswers: answers,
    needsHuman,
    answerCounts,
    totalCount: answers.length,
  };
}

/**
 * Run consensus with escalation: try 5, then 10, then 20 agents. Only when we've tried 20
 * and consensus is still below threshold do we return needsHuman.
 */
export async function runConsensusWithEscalation(
  prompt: string,
  policy: PipelinePolicy,
  callModel: (model: string) => Promise<string>,
): Promise<ConsensusResult> {
  const answers: string[] = [];
  const models = [...CONSENSUS_MODELS];

  for (const target of CONSENSUS_ESCALATION_TIERS) {
    while (answers.length < target && answers.length < models.length) {
      const model = models[answers.length];
      try {
        const ans = await callModel(model);
        answers.push(ans.trim());
      } catch {
        answers.push("");
      }
    }
    const valid = answers.filter((a) => a.length > 0);
    const result = computeConsensus(valid, policy.consensusThresholdPercent);
    if (!result.needsHuman) return result;
    if (answers.length >= 20) return result;
  }

  const valid = answers.filter((a) => a.length > 0);
  return computeConsensus(valid, policy.consensusThresholdPercent);
}

/**
 * Voter-only consensus: options are already set (e.g. A–E + F=Other). First model is the proposer (not used here).
 * Voters = models 1..20. Escalation: 4, then 8, 12, 16, 20. Normalize answers to letter A–F.
 */
export async function runConsensusVotersOnly(
  optionLabels: string[],
  policy: PipelinePolicy,
  callModel: (model: string) => Promise<string>,
): Promise<ConsensusResult> {
  const voterModels = CONSENSUS_MODELS.slice(1);
  const prompt = `Choose ONE option (reply with only the letter A, B, C, D, E, or F). No explanation.

Options:
${optionLabels.join("\n")}

Answer:`;
  const validLetters = ["A", "B", "C", "D", "E", "F"];
  const answers: string[] = [];
  for (const target of CONSENSUS_VOTER_TIERS) {
    while (answers.length < target && answers.length < voterModels.length) {
      const model = voterModels[answers.length];
      try {
        const ans = await callModel(model);
        const letter = ans.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1) || "A";
        answers.push(validLetters.includes(letter) ? letter : "A");
      } catch {
        answers.push("A");
      }
    }
    const valid = answers.filter((a) => a.length > 0);
    const result = computeConsensus(valid, policy.consensusThresholdPercent);
    if (!result.needsHuman) return result;
    if (answers.length >= 20) return result;
  }
  const valid = answers.filter((a) => a.length > 0);
  return computeConsensus(valid, policy.consensusThresholdPercent);
}

function normalizeOption(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Build per-option breakdown (label, text, percent) from options and consensus result.
 * Options are expected as "A. OptionName", "B. OptionName", etc.
 * Counts are attributed by letter (a, b, c) and by normalized option text so both letter and full-text answers are counted.
 */
export function buildOptionBreakdown(
  options: string[],
  result: ConsensusResult,
): { optionLabel: string; optionText: string; percent: number }[] {
  const total = result.totalCount || 1;
  return options.map((opt, i) => {
    const letter = (opt.match(/^([A-F])\./i)?.[1] ?? String.fromCharCode(65 + i)).toUpperCase();
    const keyLetter = letter.toLowerCase();
    const optionText = opt.replace(/^[A-Z]\.\s*/i, "").trim() || opt;
    const keyText = normalizeOption(optionText);
    const countLetter = result.answerCounts?.[keyLetter] ?? 0;
    const countText = keyText !== keyLetter ? (result.answerCounts?.[keyText] ?? 0) : 0;
    const count = countLetter + countText;
    const percent = Math.round((count / total) * 100);
    return { optionLabel: letter, optionText, percent };
  });
}

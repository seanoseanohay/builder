/**
 * Consensus: given N model answers, compute agreement and whether to auto-pick or ask human.
 * Escalation: try 5 agents, then 10, then 20; only at 20 with no consensus do we ask human.
 */

import {
  CONSENSUS_ESCALATION_TIERS,
  CONSENSUS_MODELS,
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

  return {
    consensusPercent,
    chosenAnswer: best.canonical,
    rawAnswers: answers,
    needsHuman,
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

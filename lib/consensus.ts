/**
 * Consensus: given N model answers, compute agreement and whether to auto-pick or ask human.
 */

export interface ConsensusResult {
  /** Percentage of answers that agree with the chosen answer (0–100). */
  consensusPercent: number;
  /** The answer that had the most votes (normalized). */
  chosenAnswer: string;
  /** Raw answers from each model (for logging). */
  rawAnswers: string[];
  /** True when consensus is below threshold → need human. */
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

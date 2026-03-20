/**
 * Helpers for human gate when there is no consensus: per-option percent, defense, con.
 */
import { callOpenRouterServer } from "./openrouter-server";
import { buildOptionBreakdown } from "./consensus";
import type { ConsensusResult } from "./consensus";
import type { HumanGateOptionBreakdown } from "./pipeline-types";

/** One short sentence defense and con per option. When existingDefenses provided, use as defense and LLM fills only con. */
export async function getDefenseAndConForOptions(
  optionLabels: string[],
  apiKey: string | null | undefined,
  existingDefenses?: string[],
): Promise<{ defense: string; con: string }[]> {
  const needFromLlm = existingDefenses == null || existingDefenses.length === 0;
  const prompt = needFromLlm
    ? `For each option below, give one short sentence "defense" (why choose it) and one short sentence "con" (drawback). Reply with JSON: [{"defense":"...","con":"..."}, ...] in order A, B, C, etc. No other text.\n\nOptions:\n${optionLabels.join("\n")}`
    : `For each option below, give one short sentence "con" (drawback only). Reply with JSON: [{"con":"..."}, ...] in order A, B, C, etc. No other text.\n\nOptions:\n${optionLabels.join("\n")}`;
  try {
    const raw = await callOpenRouterServer({
      model: "openai/gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 512,
      apiKey,
    });
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()) as {
      defense?: string;
      con: string;
    }[];
    if (!Array.isArray(parsed) || parsed.length < optionLabels.length) {
      return optionLabels.map(() => ({ defense: "—", con: "—" }));
    }
    return parsed.slice(0, optionLabels.length).map((p, i) => ({
      defense: needFromLlm ? (p.defense ?? "—") : (existingDefenses?.[i] ?? "—"),
      con: p.con ?? "—",
    }));
  } catch {
    return optionLabels.map((_, i) => ({
      defense: existingDefenses?.[i] ?? "—",
      con: "—",
    }));
  }
}

/** Build full option breakdown: percent from consensus, defense/con from existing or LLM. */
export async function buildHumanGateOptionBreakdown(
  optionLabels: string[],
  consensusResult: ConsensusResult,
  apiKey: string | null | undefined,
  existingDefenses?: string[],
): Promise<HumanGateOptionBreakdown[]> {
  const base = buildOptionBreakdown(optionLabels, consensusResult);
  const defenseCon = await getDefenseAndConForOptions(
    optionLabels,
    apiKey,
    existingDefenses,
  );
  return base.map((b, i) => ({
    ...b,
    defense: defenseCon[i]?.defense ?? "—",
    con: defenseCon[i]?.con ?? "—",
  }));
}

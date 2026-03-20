/**
 * SDS stage: get options for one section (OpenRouter), then consensus on which option.
 * Server-only.
 */
import { callOpenRouterServer } from "./openrouter-server";
import { runConsensusWithEscalation } from "./consensus";
import { safeParseJSON } from "./json";
import { SECTION_PROMPTS } from "./sections";
import type { SectionId } from "./sections";
import type { PipelinePolicy, PipelineResearchResult, SDSDecision } from "./pipeline-types";

const SDS_MODEL = "anthropic/claude-sonnet-4";

interface SDSData {
  recommendation: string;
  options: Array<{ name: string; verdict: string; reason: string }>;
}

function buildSDSContext(
  intake: { company: string; website: string; projectName: string; problemStatement: string; functionalReqs: string; languages?: string },
  researchResult: PipelineResearchResult | undefined,
  sectionLabel: string,
  sectionReason: string,
): string {
  const pr = researchResult?.partnerResearch;
  const inf = researchResult?.inferred;
  return `
COMPANY: ${intake.company}
PROJECT: ${intake.projectName}
PROBLEM: ${intake.problemStatement}
REQUIREMENTS: ${intake.functionalReqs}
STACK HINTS: ${intake.languages || "none"}
PARTNER DOMAIN: ${pr?.domain || inf?.domain || "unknown"}
PARTNER USERS: ${(pr?.targetUsers || inf?.targetUsers || []).join(", ") || "unknown"}
PARTNER PRODUCTS: ${(pr?.products || []).join(", ") || "unknown"}
PARTNER CONSTRAINTS: ${(pr?.constraints || inf?.constraints || []).join(", ") || "none"}

Perform analysis for the ${sectionLabel.toUpperCase()} layer. Why this layer matters: ${sectionReason}
`.trim();
}

export async function getSectionOptions(
  section: { id: string; label: string; sub: string; reason: string },
  intake: { company: string; website: string; projectName: string; problemStatement: string; functionalReqs: string; languages?: string },
  researchResult: PipelineResearchResult | undefined,
  apiKey: string | null | undefined,
): Promise<SDSData> {
  const basePrompt = SECTION_PROMPTS[section.id as SectionId] ||
    `Perform a SYSTEM DESIGN analysis for the ${section.label} layer. Evaluate realistic implementation options. Use technical criteria: data flow, latency, throughput, failure modes, consistency, observability, security, scale.`;
  const context = buildSDSContext(intake, researchResult, section.label, section.reason);
  const sys = "You are a senior system architect. Return ONLY valid JSON — no markdown, no extra text.";
  const prompt = `${basePrompt}

Project context:
${context}

Return this exact JSON:
{
  "recommendation": "2-4 sentences defending the chosen option.",
  "options": [
    { "name": "Option name", "verdict": "recommended" | "viable" | "avoid", "reason": "1-2 sentences." }
  ]
}
Rules: 3-5 options, exactly one "recommended". JSON only.`;

  const raw = await callOpenRouterServer({
    model: SDS_MODEL,
    messages: [{ role: "system", content: sys }, { role: "user", content: prompt }],
    max_tokens: 2048,
    apiKey,
  });
  const parsed = safeParseJSON<SDSData>(raw.replace(/```json|```/gi, "").trim());
  return {
    recommendation: parsed.recommendation || "",
    options: Array.isArray(parsed.options) ? parsed.options : [],
  };
}

export async function runConsensusForSection(
  options: Array<{ name: string }>,
  sectionLabel: string,
  policy: PipelinePolicy,
  apiKey: string | null | undefined,
): Promise<{ chosenIndex: number; chosenName: string; consensusPercent: number; needsHuman: boolean }> {
  if (options.length === 0) {
    return { chosenIndex: 0, chosenName: "", consensusPercent: 0, needsHuman: true };
  }
  const optionList = options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o.name}`).join("\n");
  const consensusPrompt = `For the ${sectionLabel} layer, choose ONE option (reply with only the letter A, B, C, D, or E). No explanation.

Options:
${optionList}

Answer:`;

  const consensus = await runConsensusWithEscalation(
    consensusPrompt,
    policy,
    async (model) => {
      const ans = await callOpenRouterServer({
        model,
        messages: [{ role: "user", content: consensusPrompt }],
        max_tokens: 50,
        apiKey,
      });
      return ans.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1) || "A";
    },
  );
  const letter = consensus.chosenAnswer.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1) || "A";
  const index = letter.charCodeAt(0) - 65;
  const chosenIndex = Math.max(0, Math.min(index, options.length - 1));
  const chosenName = options[chosenIndex]?.name ?? options[0].name;
  return {
    chosenIndex,
    chosenName,
    consensusPercent: consensus.consensusPercent,
    needsHuman: consensus.needsHuman,
  };
}

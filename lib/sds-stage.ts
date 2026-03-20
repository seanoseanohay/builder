/**
 * SDS stage: get options for one section (OpenRouter), then consensus on which option.
 * Server-only.
 */
import { CONSENSUS_MODELS } from "./pipeline-types";
import { callOpenRouterServer } from "./openrouter-server";
import { runConsensusVotersOnly } from "./consensus";
import { buildHumanGateOptionBreakdown } from "./human-gate-options";
import { SECTION_PROMPTS } from "./sections";
import type { SectionId } from "./sections";
import type { PipelinePolicy, PipelineResearchResult, SDSDecision } from "./pipeline-types";

interface SDSData {
  recommendation: string;
  options: Array<{ name: string; verdict: string; reason: string }>;
}

/** First model (proposer) suggests options A–E plus F=Other. */
const PROPOSER_MODEL = CONSENSUS_MODELS[0];

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

/** Parse proposer response into 6 options: A. ... B. ... C. ... D. ... E. ... F. Other */
function parseProposerOptions(raw: string): string[] {
  const lines = raw
    .replace(/```[\s\S]*?```/g, "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const options: string[] = [];
  for (let i = 0; i <= 5; i++) {
    const label = i === 5 ? "F" : String.fromCharCode(65 + i);
    const re = new RegExp(`^${label}\\.\\s*(.+)$`, "i");
    const line = lines.find((l) => re.test(l));
    if (line) {
      const m = line.match(re);
      options.push(`${label}. ${(m?.[1] ?? line).trim()}`);
    } else if (i === 5) {
      options.push("F. Other");
    } else {
      options.push(`${label}. Option ${label}`);
    }
  }
  return options;
}

export async function getSectionOptions(
  section: { id: string; label: string; sub: string; reason: string },
  intake: { company: string; website: string; projectName: string; problemStatement: string; functionalReqs: string; languages?: string },
  researchResult: PipelineResearchResult | undefined,
  apiKey: string | null | undefined,
): Promise<SDSData> {
  const basePrompt = SECTION_PROMPTS[section.id as SectionId] ||
    `Perform a SYSTEM DESIGN analysis for the ${section.label} layer. Propose 5 concrete implementation options.`;
  const context = buildSDSContext(intake, researchResult, section.label, section.reason);
  const prompt = `${basePrompt}

Project context:
${context}

Reply with exactly 6 lines. Lines must be:
A. <first option name>
B. <second option name>
C. <third option name>
D. <fourth option name>
E. <fifth option name>
F. Other

No other text. One option per line.`;

  const raw = await callOpenRouterServer({
    model: PROPOSER_MODEL,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 512,
    apiKey,
  });
  const optionStrings = parseProposerOptions(raw);
  const options = optionStrings.map((name, i) => ({
    name,
    verdict: "viable" as const,
    reason: "",
  }));
  return {
    recommendation: "",
    options,
  };
}

export interface RunConsensusForSectionResult {
  chosenIndex: number;
  chosenName: string;
  consensusPercent: number;
  needsHuman: boolean;
  /** Full consensus result for building option breakdown when needsHuman. */
  consensusResult?: import("./consensus").ConsensusResult;
}

export async function runConsensusForSection(
  options: Array<{ name: string }>,
  sectionLabel: string,
  policy: PipelinePolicy,
  apiKey: string | null | undefined,
): Promise<RunConsensusForSectionResult> {
  if (options.length === 0) {
    return { chosenIndex: 0, chosenName: "", consensusPercent: 0, needsHuman: true };
  }
  const optionLabels = options.map((o) => o.name);
  const consensus = await runConsensusVotersOnly(
    optionLabels,
    policy,
    async (model) => {
      const prompt = `For the ${sectionLabel} layer, choose ONE option (reply with only the letter A, B, C, D, E, or F). No explanation.

Options:
${optionLabels.join("\n")}

Answer:`;
      return callOpenRouterServer({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 50,
        apiKey,
      });
    },
  );
  const letter = consensus.chosenAnswer.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1) || "A";
  const index = letter === "F" ? 5 : Math.min(letter.charCodeAt(0) - 65, options.length - 1);
  const chosenIndex = Math.max(0, Math.min(index, options.length - 1));
  const chosenName = options[chosenIndex]?.name ?? options[0].name;
  return {
    chosenIndex,
    chosenName,
    consensusPercent: consensus.consensusPercent,
    needsHuman: consensus.needsHuman,
    consensusResult: consensus,
  };
}

/** Build option breakdown with percent; defense from option.reason, con from LLM. */
export async function buildSdsHumanGateBreakdown(
  options: Array<{ name: string; reason: string }>,
  consensusResult: import("./consensus").ConsensusResult,
  apiKey: string | null | undefined,
): Promise<import("./pipeline-types").HumanGateOptionBreakdown[]> {
  const optLabels = options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o.name}`);
  const existingDefenses = options.map((o) => o.reason);
  return buildHumanGateOptionBreakdown(
    optLabels,
    consensusResult,
    apiKey,
    existingDefenses,
  );
}

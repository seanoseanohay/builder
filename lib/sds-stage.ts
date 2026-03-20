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

/** First model (proposer) suggests architecturally distinct options + F=Other. */
const PROPOSER_MODEL = CONSENSUS_MODELS[0];

/** Shared instructions so options are distinct and consensus can succeed (any section / project). */
const PROPOSER_OPTION_RULES = `
Rules for the options you list:
- Each option must represent a DIFFERENT architectural approach or tradeoff (e.g. scale model, operational complexity, consistency vs latency, process shape)—not minor technology variants.
- Do NOT list multiple options that differ only by framework, library, or small stack tweak (e.g. do not give Fastify vs Express vs NestJS as separate options unless they imply clearly different architectures).
- Keep each option SHORT (under 10 words): name the approach/pattern, not a full recommendation. No explanations on the option lines.
- Keep each option generalizable: a reader should see the architectural difference at a glance; avoid overfitting to exact wording of the brief.
- Do NOT duplicate or rephrase an earlier option. If you would repeat an idea, omit it and skip that letter.
- F MUST be EXACTLY the two words: F. Other — nothing else. Never write a recommendation on the F line.`;

const GENERIC_SECTION_ANALYSIS = (label: string) =>
  `Perform a SYSTEM DESIGN analysis for the ${label} layer. Propose options that differ by architecture and tradeoffs, not by interchangeable frameworks.`;

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

/**
 * Parse proposer: required A–D + F. Other; optional E if a fifth distinct family exists.
 * F is ALWAYS replaced with "F. Other" regardless of what the model writes.
 */
function parseProposerOptions(raw: string): string[] {
  const lines = raw
    .replace(/```[\s\S]*?```/g, "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  function lineFor(label: string): string | null {
    const re = new RegExp(`^${label}\\.\\s*(.+)$`, "i");
    const line = lines.find((l) => re.test(l));
    if (!line) return null;
    const m = line.match(re);
    // Truncate to first 12 words so F-style verbose text can't slip through on A-E either
    const text = (m?.[1] ?? line).trim().split(/\s+/).slice(0, 12).join(" ");
    return `${label}. ${text}`;
  }

  const options: string[] = [];
  for (const label of ["A", "B", "C", "D"] as const) {
    const parsed = lineFor(label);
    options.push(parsed ?? `${label}. Distinct approach ${label}`);
  }
  const eLine = lineFor("E");
  if (eLine) options.push(eLine);
  // F is always "F. Other" — never trust the model's F line
  options.push("F. Other");
  return options;
}

export function optionIndexForLetter(
  letter: string,
  options: Array<{ name: string }>,
): number {
  const L = letter.toUpperCase();
  const i = options.findIndex((o) => {
    const m = o.name.match(/^([A-Z])\./i);
    return m?.[1]?.toUpperCase() === L;
  });
  return i >= 0 ? i : 0;
}

export async function getSectionOptions(
  section: { id: string; label: string; sub: string; reason: string },
  intake: { company: string; website: string; projectName: string; problemStatement: string; functionalReqs: string; languages?: string },
  researchResult: PipelineResearchResult | undefined,
  apiKey: string | null | undefined,
): Promise<SDSData> {
  const basePrompt =
    SECTION_PROMPTS[section.id as SectionId] || GENERIC_SECTION_ANALYSIS(section.label);
  const context = buildSDSContext(intake, researchResult, section.label, section.reason);
  const prompt = `${basePrompt}
${PROPOSER_OPTION_RULES}

Project context:
${context}

Reply with exactly these lines (one per line, no other text):
A. <SHORT name — max 8 words — for first distinct architectural family>
B. <SHORT name — max 8 words — for second distinct family>
C. <SHORT name — max 8 words — for third distinct family>
D. <SHORT name — max 8 words — for fourth distinct family>
E. <SHORT name — ONLY if you have a fifth GENUINELY DIFFERENT family; skip this line if not>
F. Other

IMPORTANT: F must be exactly two words "F. Other" — no explanation, no recommendation. Do not repeat or rephrase any earlier option on the F line.`;

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
  const validLetters = optionLabels
    .map((l) => l.match(/^([A-Z])\./i)?.[1]?.toUpperCase())
    .filter(Boolean) as string[];
  const letterHint = validLetters.length ? validLetters.join(", ") : "A, B, C, D, E, or F";

  const consensus = await runConsensusVotersOnly(
    optionLabels,
    policy,
    async (model) => {
      const prompt = `For the ${sectionLabel} layer, choose ONE option (reply with only a single letter: ${letterHint}). No explanation.

Choose the option that best fits the general architecture needed—not the most specific or over-tailored choice.

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
  const chosenIndex = optionIndexForLetter(letter, options);
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
  const optLabels = options.map((o) => o.name);
  const existingDefenses = options.map((o) => o.reason);
  return buildHumanGateOptionBreakdown(
    optLabels,
    consensusResult,
    apiKey,
    existingDefenses,
  );
}

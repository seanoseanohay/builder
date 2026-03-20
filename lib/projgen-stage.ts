/**
 * Projgen stage: refined docs → repo docs. Same pattern as refiner (consensus on questions).
 * Server-only.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { callOpenRouterServer } from "./openrouter-server";
import { computeConsensus } from "./consensus";
import { parseStructuredOutput } from "./parse-structured";
import type { RefinedDocs, PipelinePolicy, HumanGateQuestion, DistilledDocs } from "./pipeline-types";
import { CONSENSUS_MODELS } from "./pipeline-types";

/** Heavy doc generation: use a capable model. */
const PROJGEN_MODEL = "anthropic/claude-sonnet-4";

function loadPrompt(name: string): string {
  try {
    return readFileSync(join(process.cwd(), "prompts", name), "utf8");
  } catch {
    return "";
  }
}

function buildProjgenUserPrompt(
  refined: RefinedDocs,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
): string {
  if (conversationHistory.length === 0) {
    return `# Input documents\n\n## PRD\n${refined.prd}\n\n## Execution Plan\n${refined.executionPlan}\n\n## Research\n${refined.research}\n\n## Requirements\n${refined.requirements}\n\nAnalyze and output either ONE clarification question (---QUESTION--- ... ---END---) or the full repository documentation (---DOCUMENTS--- with all .md files ... ---END---).`;
  }
  return "Continue. Output the next clarification question (---QUESTION--- ... ---END---) or the full ---DOCUMENTS--- block.";
}

export interface ProjgenStepResult {
  done: boolean;
  distilledDocs?: DistilledDocs;
  humanGate?: HumanGateQuestion;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  decisionLog: Array<{ stage: string; question?: string; consensusPercent?: number; chosenAnswer?: string; humanAnswer?: string }>;
}

export async function runProjgenStep(params: {
  refinedDocs: RefinedDocs;
  policy: PipelinePolicy;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  humanAnswer?: string | null;
  decisionLog: Array<{ stage: string; question?: string; consensusPercent?: number; chosenAnswer?: string; humanAnswer?: string }>;
  apiKey?: string | null;
}): Promise<ProjgenStepResult> {
  const { refinedDocs, policy, conversationHistory, humanAnswer, decisionLog, apiKey } = params;
  const history = [...conversationHistory];

  const projgenBase = loadPrompt("projgen.md");
  const projgenStructured = loadPrompt("projgen-structured-output.md");
  const systemPrompt = projgenBase + "\n\n" + projgenStructured;

  if (humanAnswer != null && humanAnswer.trim() !== "") {
    history.push({ role: "user", content: `User's answer: ${humanAnswer.trim()}` });
  }

  const userPrompt = buildProjgenUserPrompt(refinedDocs, history);
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: userPrompt },
  ];

  const text = await callOpenRouterServer({
    model: PROJGEN_MODEL,
    messages,
    max_tokens: 16384,
    apiKey,
  });

  history.push({ role: "assistant", content: text });
  const parsed = parseStructuredOutput(text);

  if (parsed?.kind === "documents" && parsed.files.length > 0) {
    return {
      done: true,
      distilledDocs: parsed.files,
      conversationHistory: history,
      decisionLog,
    };
  }

  if (parsed?.kind === "question") {
    const { question, options, recommendedIndex } = parsed;
    const consensusModels = [...CONSENSUS_MODELS].slice(0, policy.consensusModelCount);

    const consensusPrompt = `Answer this project clarification with ONE option (letter or exact text). No explanation.\n\nQuestion: ${question}\n\nOptions:\n${options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join("\n")}\n\nAnswer:`;

    const answers: string[] = [];
    for (const model of consensusModels) {
      try {
        const ans = await callOpenRouterServer({
          model,
          messages: [{ role: "user", content: consensusPrompt }],
          max_tokens: 100,
          apiKey,
        });
        answers.push(ans.trim());
      } catch {
        answers.push("");
      }
    }

    const validAnswers = answers.filter((a) => a.length > 0);
    const consensus = computeConsensus(validAnswers, policy.consensusThresholdPercent);

    decisionLog.push({
      stage: "projgen",
      question,
      consensusPercent: consensus.consensusPercent,
      chosenAnswer: consensus.chosenAnswer,
      ...(humanAnswer != null && { humanAnswer }),
    });

    if (consensus.needsHuman) {
      return {
        done: false,
        humanGate: {
          stage: "projgen",
          question,
          options,
          recommendedIndex,
          context: `Consensus: ${consensus.consensusPercent}% (threshold: ${policy.consensusThresholdPercent}%).`,
        },
        conversationHistory: history,
        decisionLog,
      };
    }

    history.push({ role: "user", content: `User's answer (consensus): ${consensus.chosenAnswer}` });
    return {
      done: false,
      conversationHistory: history,
      decisionLog,
    };
  }

  return {
    done: false,
    humanGate: {
      stage: "projgen",
      question: "Projgen output could not be parsed. Retry or provide guidance.",
      options: ["Retry", "Abort"],
      recommendedIndex: 0,
      context: text.slice(0, 500),
    },
    conversationHistory: history,
    decisionLog,
  };
}

/**
 * Refiner stage: run refiner model, parse structured output, optionally run consensus.
 * Server-only (uses openrouter-server and prompts).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { callOpenRouterServer } from "./openrouter-server";
import { runConsensusVotersOnly } from "./consensus";
import { buildHumanGateOptionBreakdown } from "./human-gate-options";
import { parseStructuredOutput } from "./parse-structured";
import type { PipelineInput, RefinedDocs, PipelinePolicy, HumanGateQuestion } from "./pipeline-types";

/** Heavy doc generation: use GPT-5.4. */
const REFINER_MODEL = "openai/gpt-5.4";

function loadPrompt(name: string): string {
  try {
    return readFileSync(join(process.cwd(), "prompts", name), "utf8");
  } catch {
    return "";
  }
}

function buildRefinerUserPrompt(
  input: PipelineInput,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
): string {
  if (conversationHistory.length === 0) {
    return `# Input documents\n\n## PRD\n${input.prd}\n\n## Execution Plan\n${input.plan}\n\n## Research\n${input.research}\n\n## Requirements\n${input.requirements}\n\nNow output either ONE clarification question (using the ---QUESTION--- format) or the final ---DOCUMENTS--- block.`;
  }
  return "Continue. Output the next clarification question (---QUESTION--- ... ---END---) or the final four documents (---DOCUMENTS--- ... ---END---).";
}

export interface RefinerStepResult {
  done: boolean;
  refinedDocs?: RefinedDocs;
  humanGate?: HumanGateQuestion;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  decisionLog: Array<{ stage: string; question?: string; consensusPercent?: number; chosenAnswer?: string; humanAnswer?: string }>;
}

export async function runRefinerStep(params: {
  input: PipelineInput;
  policy: PipelinePolicy;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  humanAnswer?: string | null;
  decisionLog: Array<{ stage: string; question?: string; consensusPercent?: number; chosenAnswer?: string; humanAnswer?: string }>;
  apiKey?: string | null;
}): Promise<RefinerStepResult> {
  const { input, policy, conversationHistory, humanAnswer, decisionLog, apiKey } = params;
  const history = [...conversationHistory];

  const refinerBase = loadPrompt("refiner.md");
  const refinerStructured = loadPrompt("refiner-structured-output.md");
  const systemPrompt = refinerBase + "\n\n" + refinerStructured;

  // If we have a human answer from the previous step, append it and continue
  if (humanAnswer != null && humanAnswer.trim() !== "") {
    history.push({ role: "user", content: `User's answer: ${humanAnswer.trim()}` });
  }

  const userPrompt = buildRefinerUserPrompt(input, history);
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: userPrompt },
  ];

  const text = await callOpenRouterServer({
    model: REFINER_MODEL,
    messages,
    max_tokens: 8192,
    apiKey,
  });

  history.push({ role: "assistant", content: text });

  const parsed = parseStructuredOutput(text);

  if (parsed?.kind === "documents" && parsed.files.length >= 4) {
    const byName: Record<string, string> = {};
    for (const f of parsed.files) {
      byName[f.name] = f.content;
    }
    return {
      done: true,
      refinedDocs: {
        prd: byName["PRD.md"] ?? byName["prd.md"] ?? "",
        executionPlan: byName["execution-plan.md"] ?? "",
        research: byName["research.md"] ?? "",
        requirements: byName["requirements.md"] ?? "",
      },
      conversationHistory: history,
      decisionLog,
    };
  }

  if (parsed?.kind === "question") {
    const { question, options, recommendedIndex } = parsed;
    const optionLabels = [
      ...options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`),
      "F. Other",
    ];

    const consensus = await runConsensusVotersOnly(
      optionLabels,
      policy,
      async (model) => {
        const prompt = `Answer this clarification with ONE option (reply with only the letter A, B, C, D, E, or F). No explanation.

Question: ${question}

Options:
${optionLabels.join("\n")}

Answer:`;
        return callOpenRouterServer({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 100,
          apiKey,
        });
      },
    );

    decisionLog.push({
      stage: "refiner",
      question,
      consensusPercent: consensus.consensusPercent,
      chosenAnswer: consensus.chosenAnswer,
      ...(humanAnswer != null && { humanAnswer }),
    });

    if (consensus.needsHuman) {
      const optionBreakdown = await buildHumanGateOptionBreakdown(
        optionLabels,
        consensus,
        apiKey,
      );
      return {
        done: false,
        humanGate: {
          stage: "refiner",
          question,
          options: optionLabels,
          recommendedIndex: Math.min(recommendedIndex, optionLabels.length - 1),
          context: `No consensus after 20 agents (${consensus.consensusPercent}% best; threshold: ${policy.consensusThresholdPercent}%).`,
          optionBreakdown,
        },
        conversationHistory: history,
        decisionLog,
      };
    }

    // Consensus ok: return updated history with chosen answer so caller can run next step
    const chosenLetter = consensus.chosenAnswer.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1) || "A";
    const chosenLabel = chosenLetter === "F" ? "F. Other" : optionLabels[chosenLetter.charCodeAt(0) - 65] ?? consensus.chosenAnswer;
    history.push({ role: "user", content: `User's answer (consensus): ${chosenLabel}` });
    return {
      done: false,
      conversationHistory: history,
      decisionLog,
    };
  }

  // Unparseable or no question/documents yet — treat as needing another turn or human
  return {
    done: false,
    humanGate: {
      stage: "refiner",
      question: "The refiner produced output that could not be parsed. Please review and provide guidance or paste the next question.",
      options: ["Retry", "Use output as-is", "Abort"],
      recommendedIndex: 0,
      context: text.slice(0, 500),
    },
    conversationHistory: history,
    decisionLog,
  };
}

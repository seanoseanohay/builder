/**
 * Refiner stage: run refiner model, parse structured output, optionally run consensus.
 * Server-only (uses openrouter-server and prompts).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { callOpenRouterServer } from "./openrouter-server";
import { computeConsensus } from "./consensus";
import { parseStructuredOutput } from "./parse-structured";
import type { PipelineInput, RefinedDocs, PipelinePolicy, HumanGateQuestion } from "./pipeline-types";
import { CONSENSUS_MODELS } from "./pipeline-types";

/** Heavy doc generation: use a capable model. */
const REFINER_MODEL = "anthropic/claude-sonnet-4";

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
    const consensusModels = [...CONSENSUS_MODELS].slice(0, policy.consensusModelCount);

    const consensusPrompt = `You are answering a single clarification question for a project refinement. Choose ONE option (by letter or by repeating the option text). No explanation.

Question: ${question}

Options:
${options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join("\n")}

Answer with only the letter (A, B, C, or D) or the exact option text.`;

    const answers: string[] = [];
    for (const model of consensusModels) {
      try {
        const ans = await callOpenRouterServer({
          model,
          messages: [
            { role: "user", content: consensusPrompt },
          ],
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
      stage: "refiner",
      question,
      consensusPercent: consensus.consensusPercent,
      chosenAnswer: consensus.chosenAnswer,
      ...(humanAnswer != null && { humanAnswer }),
    });

    if (consensus.needsHuman) {
      return {
        done: false,
        humanGate: {
          stage: "refiner",
          question,
          options,
          recommendedIndex,
          context: `Consensus: ${consensus.consensusPercent}% (threshold: ${policy.consensusThresholdPercent}%). Raw answers: ${consensus.rawAnswers.join(" | ")}`,
        },
        conversationHistory: history,
        decisionLog,
      };
    }

    // Consensus ok: return updated history with chosen answer so caller can run next step
    history.push({ role: "user", content: `User's answer (consensus): ${consensus.chosenAnswer}` });
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

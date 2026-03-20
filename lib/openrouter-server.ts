/**
 * Server-only OpenRouter client. Use from API routes (e.g. pipeline).
 * Calls OpenRouter directly with the provided API key (or OPENROUTER_API_KEY).
 * When LANGSMITH_TRACING=true and LANGSMITH_API_KEY are set, each call is traced to LangSmith.
 */

import { traceable } from "langsmith/traceable";

export type OpenRouterMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type CallOpenRouterParams = {
  model: string;
  messages: OpenRouterMessage[];
  max_tokens?: number;
  temperature?: number;
  apiKey?: string | null;
};

async function callOpenRouterServerImpl(params: CallOpenRouterParams): Promise<string> {
  const apiKey = params.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "No OpenRouter API key. Set OPENROUTER_API_KEY or pass apiKey.",
    );
  }

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      max_tokens: params.max_tokens ?? 4096,
      ...(params.temperature != null && { temperature: params.temperature }),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${err}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  return data.choices?.[0]?.message?.content ?? "";
}

const tracedOpenRouter = traceable(callOpenRouterServerImpl, {
  name: "OpenRouter",
  run_type: "llm",
});

export async function callOpenRouterServer(params: CallOpenRouterParams): Promise<string> {
  const tracing =
    process.env.LANGSMITH_TRACING === "true" ||
    process.env.LANGCHAIN_TRACING_V2 === "true";
  if (tracing && process.env.LANGSMITH_API_KEY) {
    return tracedOpenRouter(params);
  }
  return callOpenRouterServerImpl(params);
}

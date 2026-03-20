/**
 * OpenRouter client. Uses /api/openrouter (server or client can call).
 * Pass apiKey when calling from client; server can use OPENROUTER_API_KEY.
 */
export type OpenRouterMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

export interface OpenRouterOptions {
  model: string;
  messages: OpenRouterMessage[];
  max_tokens?: number;
  temperature?: number;
  apiKey?: string | null;
}

export async function callOpenRouter(
  options: OpenRouterOptions,
): Promise<string> {
  const { model, messages, max_tokens, temperature, apiKey } = options;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["X-OpenRouter-API-Key"] = apiKey;

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: max_tokens ?? 4096,
  };
  if (temperature != null) body.temperature = temperature;
  if (apiKey) (body as Record<string, string>).apiKey = apiKey;

  const res = await fetch("/api/openrouter", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as { error?: string; text?: string };
  if (!res.ok) {
    throw new Error(data.error || `OpenRouter error: ${res.status}`);
  }
  return data.text ?? "";
}

/** Cheap models used for consensus Q&A (OpenRouter ids). Matches server CONSENSUS_MODELS. */
export const DEFAULT_CONSENSUS_MODELS = [
  "openai/gpt-4o-mini",
  "anthropic/claude-3-haiku",
  "google/gemini-flash-1.5",
  "meta-llama/llama-3.1-8b-instruct",
  "mistralai/mistral-7b-instruct",
] as const;

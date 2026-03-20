import { NextRequest, NextResponse } from "next/server";

/**
 * OpenRouter API proxy. One key for multiple models (Claude, GPT, Grok, etc.).
 * Key from header/body or OPENROUTER_API_KEY. Not logged or stored.
 */
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MAX_TOKENS = 4096;

const NO_KEY_MESSAGE =
  "No API key. Add your OpenRouter API key in the app or set OPENROUTER_API_KEY in the server environment.";

export async function POST(request: NextRequest) {
  let body: {
    model: string;
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    max_tokens?: number;
    temperature?: number;
    apiKey?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    model,
    messages,
    max_tokens: requestedMaxTokens,
    temperature,
    apiKey: bodyKey,
  } = body;

  const maxTokens =
    requestedMaxTokens != null && requestedMaxTokens > 0
      ? Math.min(requestedMaxTokens, 32768)
      : DEFAULT_MAX_TOKENS;

  const requestKey =
    request.headers.get("x-openrouter-api-key")?.trim() ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    bodyKey?.trim();
  const apiKey = requestKey || process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: NO_KEY_MESSAGE }, { status: 401 });
  }

  if (!model || !messages?.length) {
    return NextResponse.json(
      { error: "model and messages are required" },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": request.headers.get("origin") || "",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        ...(temperature != null && { temperature }),
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `OpenRouter error: ${res.status} — ${errText}` },
        { status: res.status },
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (data.error) {
      return NextResponse.json(
        { error: data.error.message || "OpenRouter error" },
        { status: 502 },
      );
    }

    const text =
      data.choices?.[0]?.message?.content ??
      "";

    return NextResponse.json({ text });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: `OpenRouter request failed: ${message}` },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";

/**
 * Claude API proxy. Your API key is used only to forward the request to Anthropic.
 * We do NOT log, store, or transmit your key anywhere else. See the source to verify.
 */
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 4000;

const NO_KEY_MESSAGE =
  "No API key. Add your Anthropic API key in the app (header) or set ANTHROPIC_API_KEY in the server environment.";

export async function POST(request: NextRequest) {
  let body: { systemPrompt: string; userPrompt: string; apiKey?: string; stream?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { systemPrompt, userPrompt, apiKey: bodyKey, stream: wantStream } = body;
  const requestKey = request.headers.get("x-anthropic-api-key")?.trim() || bodyKey?.trim();
  const apiKey = requestKey || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: NO_KEY_MESSAGE },
      { status: 401 }
    );
  }

  if (!systemPrompt || !userPrompt) {
    return NextResponse.json(
      { error: "systemPrompt and userPrompt are required" },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        stream: wantStream === true,
      }),
    });

    if (response.status === 429) {
      return NextResponse.json(
        { error: "Rate limited — too many requests. Wait a moment and retry." },
        { status: 429 }
      );
    }

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { error: `Anthropic API error: ${response.status} — ${errText}` },
        { status: response.status }
      );
    }

    if (wantStream === true && response.body) {
      return new Response(response.body, {
        headers: {
          "Content-Type": response.headers.get("content-type") || "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text =
      data.content
        ?.filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("") ?? "";

    return NextResponse.json({ text });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: `Claude request failed: ${message}` },
      { status: 500 }
    );
  }
}

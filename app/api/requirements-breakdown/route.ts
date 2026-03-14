import { NextRequest, NextResponse } from "next/server";
import type {
  Inferred,
  Intake,
  PartnerResearch,
} from "@/lib/types";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 4000;

async function callClaude(
  apiKey: string,
  system: string,
  user: string,
): Promise<string> {
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
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error: ${response.status} — ${errText}`);
  }

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };

  return (
    data.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("") ?? ""
  );
}

export async function POST(request: NextRequest) {
  let body: {
    intake?: Intake;
    companyProfile?: string;
    partnerResearch?: PartnerResearch;
    inferred?: Inferred;
    apiKey?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const intake = body.intake;
  const companyProfile = body.companyProfile ?? "";
  const partnerResearch = body.partnerResearch;
  const inferred = body.inferred;
  const requestKey =
    request.headers.get("x-anthropic-api-key")?.trim() || body.apiKey?.trim();
  const apiKey = requestKey || process.env.ANTHROPIC_API_KEY;

  if (!intake?.company || !intake.problemStatement) {
    return NextResponse.json(
      { error: "intake.company and intake.problemStatement are required" },
      { status: 400 },
    );
  }

  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "No API key. Add your Anthropic API key in the app or configure ANTHROPIC_API_KEY.",
      },
      { status: 401 },
    );
  }

  const systemPrompt = `You are a senior product manager. Turn a project brief and company context into a clear, line-by-line product requirement list. Each requirement must have a short explanation (1–2 sentences) of how you interpret it or why it matters given the company. Output only valid markdown: use a numbered list, one requirement per item, then the explanation on the same or next line. No preamble.`;

  const userPrompt = `
Company: ${intake.company}${intake.website ? ` — ${intake.website}` : ""}
Project: ${intake.projectName}

Company profile / research:
${companyProfile}

${partnerResearch ? `
Partner research:
- Domain: ${partnerResearch.domain ?? "—"}
- Target users: ${(partnerResearch.targetUsers ?? []).join(", ") || "—"}
- Products: ${(partnerResearch.products ?? []).join(", ") || "—"}
- Constraints: ${(partnerResearch.constraints ?? []).join("; ") || "—"}
- Notes: ${(partnerResearch.notes ?? []).join("; ") || "—"}
` : ""}

${inferred ? `
Inferred context:
- Project type: ${inferred.projectType ?? "—"}
- Stack: ${(inferred.stack ?? []).join(", ") || "—"}
- Integrations: ${(inferred.integrations ?? []).join(", ") || "—"}
` : ""}

Problem statement:
${intake.problemStatement}

Functional requirements:
${intake.functionalReqs || "None specified."}

Additional notes: ${intake.additionalNotes || "None."}

Produce a numbered list of product requirements. For each requirement:
1. One clear requirement (what we will build or guarantee).
2. A short explanation (why or how we interpret it given the company and problem).

Use markdown. Number the list. Output only the list, no other sections.
`.trim();

  try {
    const markdown = await callClaude(apiKey, systemPrompt, userPrompt);
    return NextResponse.json({ markdown: markdown.trim() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

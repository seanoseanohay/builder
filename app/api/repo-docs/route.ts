import { NextRequest, NextResponse } from "next/server";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 16000;

const NO_KEY_MESSAGE =
  "No API key. Add your Anthropic API key in the app (header) or set ANTHROPIC_API_KEY in the server environment.";

const SYSTEM_PROMPT = `You are helping convert product planning documents into a repository structure designed for agentic development using tools like Codex and Claude Code.

The goal is to transform the provided PRD, execution plan, and research into **clean, structured project documentation** that can be dropped into a repository.

The project follows this structure:

project/
AGENTS.md
README.md
docs/
requirements.md
scope.md
phases.md
architecture.md
decisions.md

Important rules:

1. The codebase will be the source of truth for implementation.
2. Documentation should represent **intent, scope, and architectural decisions**, not duplicate the code.
3. Keep documents concise and structured so AI coding agents can read them efficiently.
4. Avoid unnecessary narrative explanations.
5. Break execution into practical phases.
6. Capture major architectural decisions so they are not repeatedly reconsidered.
7. Only describe architecture that is reasonably certain — do not speculate.

Produce the following documents.

---

requirements.md (in docs/)

Describe the product intent and outcomes.

Include:
* problem statement
* target users
* key use cases
* must-have functionality
* optional functionality
* constraints or assumptions

---

scope.md (in docs/)

Define project boundaries.

Include:
* in-scope functionality
* out-of-scope functionality
* current priorities
* deferred ideas

---

phases.md (in docs/)

Break implementation into logical development phases.

For each phase include:
Phase name
Goal
Key deliverables
Success criteria

---

architecture.md (in docs/)

Describe the high-level system structure.

Include:
* system overview
* major components
* data flow
* external services or integrations
* major technical constraints

Do not include implementation-level detail.

---

decisions.md (in docs/)

Record major technical decisions.

For each decision include:
Decision
Reason
Tradeoffs

Include decisions such as:
* framework choice
* database choice
* hosting/deployment
* authentication model
* API approach
* major infrastructure choices

---

AGENTS.md

A short file that orients AI coding agents (e.g. Codex, Claude Code) to this repo: what the project is, where key docs live (docs/requirements.md, docs/scope.md, etc.), and how to use them when planning or implementing. Be concise.

---

README.md

A brief project README for humans: project name, one-line description, how to run (if known from the plan), and pointer to docs/ for details. Do not duplicate the full PRD.

---

You must respond with a single JSON object (no markdown code fence, no other text) with exactly these keys, each value being the full file content as a string:

{
  "docs/requirements.md": "...",
  "docs/scope.md": "...",
  "docs/phases.md": "...",
  "docs/architecture.md": "...",
  "docs/decisions.md": "...",
  "AGENTS.md": "...",
  "README.md": "..."
}`;

export interface RepoDocsResponse {
  files: Record<string, string>;
}

export async function POST(request: NextRequest) {
  let body: {
    prd: string;
    executionPlan: string;
    research: string;
    apiKey?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { prd, executionPlan, research, apiKey: bodyKey } = body;
  const requestKey =
    request.headers.get("x-anthropic-api-key")?.trim() || bodyKey?.trim();
  const apiKey = requestKey || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: NO_KEY_MESSAGE }, { status: 401 });
  }

  if (!prd || !executionPlan) {
    return NextResponse.json(
      { error: "prd and executionPlan are required" },
      { status: 400 },
    );
  }

  const userPrompt = `Input documents:

PRD:
${prd}

Execution Plan:
${executionPlan}

Research:
${research || "(none provided)"}

Output the single JSON object with the seven keys (docs/requirements.md, docs/scope.md, docs/phases.md, docs/architecture.md, docs/decisions.md, AGENTS.md, README.md) and no other text.`;

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
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { error: `Anthropic API error: ${response.status} — ${errText}` },
        { status: response.status },
      );
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const raw =
      data.content
        ?.filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("") ?? "";

    const trimmed = raw.trim();
    const jsonStr =
      trimmed.startsWith("```") && trimmed.endsWith("```")
        ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
        : trimmed;

    let files: Record<string, string>;
    try {
      files = JSON.parse(jsonStr) as Record<string, string>;
    } catch {
      return NextResponse.json(
        {
          error:
            "Claude did not return valid JSON. Raw response (first 500 chars): " +
            raw.slice(0, 500),
        },
        { status: 502 },
      );
    }

    const expected = [
      "docs/requirements.md",
      "docs/scope.md",
      "docs/phases.md",
      "docs/architecture.md",
      "docs/decisions.md",
      "AGENTS.md",
      "README.md",
    ];
    for (const key of expected) {
      if (typeof files[key] !== "string") {
        return NextResponse.json(
          { error: `Missing or invalid key in response: ${key}` },
          { status: 502 },
        );
      }
    }

    return NextResponse.json({ files });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: `Repo docs request failed: ${message}` },
      { status: 500 },
    );
  }
}

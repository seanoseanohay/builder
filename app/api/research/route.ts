import { NextRequest, NextResponse } from "next/server";
import { safeParseJSON } from "@/lib/json";
import {
  buildWebsiteTargets,
  normalizeResearchResult,
  parseSearchResults,
  stripHtml,
} from "@/lib/research";
import type {
  Intake,
  Inferred,
  PartnerResearch,
  ResearchSection,
} from "@/lib/types";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 4000;

interface ResearchResponse {
  partnerResearch: PartnerResearch;
  inferred: Inferred;
  discoveredSections: ResearchSection[];
}

async function callClaudeJson(
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
    const error = new Error(
      `Anthropic API error: ${response.status} — ${errText}`,
    ) as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
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

async function fetchPageText(
  url: string,
): Promise<{ url: string; text: string } | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 ProjectKickstarterResearchBot/1.0",
      },
      redirect: "follow",
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return null;
    const html = await response.text();
    const text = stripHtml(html).slice(0, 5000);
    if (!text) return null;
    return { url, text };
  } catch {
    return null;
  }
}

async function fetchSearchFallback(query: string) {
  try {
    const response = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 ProjectKickstarterResearchBot/1.0",
        },
      },
    );
    if (!response.ok) return [];
    const html = await response.text();
    return parseSearchResults(html).slice(0, 5);
  } catch {
    return [];
  }
}

export async function POST(request: NextRequest) {
  let body: { intake?: Intake; apiKey?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const intake = body.intake;
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

  try {
    const websiteDocs = intake.website
      ? (
          await Promise.all(
            buildWebsiteTargets(intake.website).map((url) =>
              fetchPageText(url),
            ),
          )
        ).filter((doc): doc is { url: string; text: string } => Boolean(doc))
      : [];

    const needsSearchFallback =
      websiteDocs.length < 2 ||
      websiteDocs.reduce((sum, doc) => sum + doc.text.length, 0) < 2500;
    const searchResults = needsSearchFallback
      ? await fetchSearchFallback(
          `${intake.company} ${intake.projectName} ${intake.problemStatement}`,
        )
      : [];

    const websiteContext = websiteDocs
      .map((doc, index) => `WEBSITE PAGE ${index + 1}: ${doc.url}\n${doc.text}`)
      .join("\n\n");
    const searchContext = searchResults
      .map(
        (result, index) =>
          `SEARCH RESULT ${index + 1}: ${result.title}\nURL: ${result.url}\nSNIPPET: ${result.snippet}`,
      )
      .join("\n\n");

    const systemPrompt =
      "You are a senior product strategist and system architect. Research the company and infer the architecture this project actually needs. Return ONLY valid JSON. Be specific and grounded in the provided website and search evidence. If evidence is weak, say so explicitly.";

    const userPrompt = `
Project intake:
Company: ${intake.company}
Website: ${intake.website || "not provided"}
Project: ${intake.projectName}
Status: ${intake.status}
Problem Statement: ${intake.problemStatement}
Functional Requirements: ${intake.functionalReqs}
Required Languages / Stack: ${intake.languages || "not provided"}
Technical Contact: ${intake.techContact || "not provided"}
Additional Notes: ${intake.additionalNotes || "none"}

Website evidence:
${websiteContext || "No website content available."}

Search evidence:
${searchContext || "No external search results used."}

Return JSON with this exact shape:
{
  "partnerResearch": {
    "summary": "2-4 sentence partner summary",
    "domain": "business domain",
    "targetUsers": ["specific end users"],
    "products": ["product or service lines"],
    "constraints": ["domain/compliance/business constraints"],
    "notes": ["important observations and caveats"],
    "sources": [
      {
        "type": "website" | "search" | "intake",
        "label": "short source label",
        "url": "optional source url"
      }
    ]
  },
  "inferred": {
    "projectType": "project type",
    "stack": ["recommended stack items"],
    "constraints": ["technical constraints"],
    "integrations": ["likely integrations"],
    "targetUsers": ["project users"],
    "domain": "business domain"
  },
  "discoveredSections": [
    {
      "id": "stable-kebab-id",
      "label": "Section label",
      "sub": "short subtitle",
      "reason": "why this layer matters for this project",
      "priority": "required" | "optional"
    }
  ]
}

Rules:
- Include layers that the problem implies even if the user did not explicitly ask for them.
- Cover hidden layers like payments, notifications, file storage, search, analytics, admin tooling, observability, workflows, reporting, integrations, multi-tenant/org management, vector/RAG, or mobile only when relevant.
- Do not duplicate obvious core layers like frontend/backend/database/hosting/auth unless they need special emphasis.
- If company evidence is weak, keep the recommendation cautious and say so in notes.
- JSON only.
`.trim();

    const raw = await callClaudeJson(apiKey, systemPrompt, userPrompt);
    const parsed = safeParseJSON<ResearchResponse>(
      raw.replace(/```json|```/gi, "").trim(),
    );
    const actualSources = [
      ...websiteDocs.map((doc) => ({
        type: "website" as const,
        label: doc.url,
        url: doc.url,
      })),
      ...searchResults.map((result) => ({
        type: "search" as const,
        label: result.title,
        url: result.url,
      })),
    ];

    return NextResponse.json(normalizeResearchResult(parsed, actualSources));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status =
      typeof error === "object" &&
      error &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

import type {
  Inferred,
  PartnerResearch,
  PartnerResearchSource,
  ResearchSection,
  SDSStateSection,
} from "./types";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const CORE_RESEARCH_SECTIONS: ResearchSection[] = [
  {
    id: "frontend",
    icon: "🖥️",
    label: "Frontend",
    sub: "Framework · UI library · State management",
    reason:
      "Every product needs a clear client experience or delivery surface.",
    priority: "required",
    category: "core",
  },
  {
    id: "backend",
    icon: "⚙️",
    label: "Backend",
    sub: "Runtime · Framework · API style",
    reason:
      "Business logic, orchestration, and integrations need a service layer.",
    priority: "required",
    category: "core",
  },
  {
    id: "database",
    icon: "🗄️",
    label: "Database",
    sub: "Primary store · Schema approach",
    reason:
      "The system needs durable application data and access patterns defined.",
    priority: "required",
    category: "core",
  },
  {
    id: "hosting",
    icon: "☁️",
    label: "Hosting & Infra",
    sub: "Cloud provider · Deployment · CI/CD",
    reason: "The project needs a deployment and runtime strategy.",
    priority: "required",
    category: "core",
  },
  {
    id: "auth",
    icon: "🔐",
    label: "Auth & Security",
    sub: "Auth provider · Permissions · Compliance",
    reason: "Access control and security tradeoffs should be explicit.",
    priority: "required",
    category: "core",
  },
  {
    id: "competitive",
    icon: "🏁",
    label: "Competitive & Risk",
    sub: "Market landscape · Alternatives · Key risks",
    reason: "The product needs a differentiation and risk posture.",
    priority: "required",
    category: "core",
  },
];

export function normalizeDiscoveredSections(raw: unknown): ResearchSection[] {
  if (!Array.isArray(raw)) return [];

  return raw.reduce<ResearchSection[]>((sections, value) => {
    if (!value || typeof value !== "object") return sections;
    const item = value as Record<string, unknown>;
    const label = typeof item.label === "string" ? item.label.trim() : "";
    if (!label) return sections;

    const idCandidate =
      typeof item.id === "string" && item.id.trim()
        ? item.id.trim()
        : slugify(label);

    sections.push({
      id: slugify(idCandidate),
      icon:
        typeof item.icon === "string" && item.icon.trim()
          ? item.icon.trim()
          : "🧩",
      label,
      sub: typeof item.sub === "string" ? item.sub.trim() : "",
      reason: typeof item.reason === "string" ? item.reason.trim() : "",
      priority: item.priority === "optional" ? "optional" : "required",
      category: "dynamic",
    });
    return sections;
  }, []);
}

export function mergeResearchSections(
  coreSections: ResearchSection[],
  discoveredSections: ResearchSection[],
): ResearchSection[] {
  const merged = [...coreSections];
  const seen = new Set(coreSections.map((section) => section.id));

  for (const section of discoveredSections) {
    if (seen.has(section.id)) continue;
    seen.add(section.id);
    merged.push(section);
  }

  return merged;
}

export function buildWebsiteTargets(website: string): string[] {
  try {
    const normalized = website.match(/^https?:\/\//i)
      ? website
      : `https://${website}`;
    const url = new URL(normalized);
    const origin = url.origin;

    return [
      `${origin}/`,
      `${origin}/about`,
      `${origin}/product`,
      `${origin}/features`,
      `${origin}/pricing`,
      `${origin}/docs`,
      `${origin}/security`,
      `${origin}/customers`,
    ];
  } catch {
    return [];
  }
}

export function parseSearchResults(html: string): SearchResult[] {
  const linkPattern =
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetPattern =
    /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippets = Array.from(html.matchAll(snippetPattern)).map((match) =>
    match[1].replace(/<[^>]+>/g, "").trim(),
  );

  return Array.from(html.matchAll(linkPattern)).map((match, index) => {
    const href = match[1];
    const title = match[2].replace(/<[^>]+>/g, "").trim();
    const parsed = new URL(href.startsWith("http") ? href : `https:${href}`);
    const decoded = parsed.searchParams.get("uddg");

    return {
      title,
      url: decoded ? decodeURIComponent(decoded) : href,
      snippet: snippets[index] || "",
    };
  });
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeResearchResult(
  raw: {
    partnerResearch?: Partial<PartnerResearch>;
    inferred?: Inferred;
    discoveredSections?: unknown;
  },
  actualSources: PartnerResearchSource[],
): {
  partnerResearch: PartnerResearch;
  inferred: Inferred;
  discoveredSections: ResearchSection[];
} {
  const inferred = raw.inferred || {};
  const partnerResearch: PartnerResearch = {
    summary:
      raw.partnerResearch?.summary?.trim() ||
      "Partner research was incomplete; proceeding with project intake context.",
    domain: raw.partnerResearch?.domain || inferred.domain,
    targetUsers: raw.partnerResearch?.targetUsers || inferred.targetUsers || [],
    products: raw.partnerResearch?.products || [],
    constraints: raw.partnerResearch?.constraints || inferred.constraints || [],
    notes: raw.partnerResearch?.notes || [],
    sources: actualSources.length
      ? actualSources
      : [{ type: "intake", label: "Project intake" }],
  };

  return {
    partnerResearch,
    inferred,
    discoveredSections: normalizeDiscoveredSections(raw.discoveredSections),
  };
}

export function getResearchGrounding(
  partnerResearch?: Partial<PartnerResearch>,
  inferred?: Inferred,
): { domain: string; targetUsers: string[]; constraints: string[] } {
  return {
    domain: partnerResearch?.domain || inferred?.domain || "TBD",
    targetUsers: partnerResearch?.targetUsers || inferred?.targetUsers || [],
    constraints: partnerResearch?.constraints || inferred?.constraints || [],
  };
}

export function buildInitialSdsState(
  sections: Array<Pick<ResearchSection, "id">>,
): Record<string, SDSStateSection> {
  return sections.reduce<Record<string, SDSStateSection>>((acc, section) => {
    acc[section.id] = {
      status: "pending",
      chatHistory: [],
      selectedOption: null,
    };
    return acc;
  }, {});
}

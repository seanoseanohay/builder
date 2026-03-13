import { describe, expect, it } from "vitest";
import {
  CORE_RESEARCH_SECTIONS,
  buildInitialSdsState,
  buildWebsiteTargets,
  getResearchGrounding,
  mergeResearchSections,
  normalizeResearchResult,
  normalizeDiscoveredSections,
  parseSearchResults,
} from "../lib/research";

describe("normalizeDiscoveredSections", () => {
  it("normalizes dynamic sections and filters invalid entries", () => {
    const sections = normalizeDiscoveredSections([
      {
        id: "payments",
        label: "Payments",
        sub: "Billing provider and checkout flows",
        reason: "The product charges customers directly.",
        priority: "required",
      },
      {
        label: "",
      },
    ]);

    expect(sections).toEqual([
      {
        id: "payments",
        icon: "🧩",
        label: "Payments",
        sub: "Billing provider and checkout flows",
        reason: "The product charges customers directly.",
        priority: "required",
        category: "dynamic",
      },
    ]);
  });
});

describe("mergeResearchSections", () => {
  it("keeps core sections, adds dynamic sections, and removes duplicates", () => {
    const merged = mergeResearchSections(CORE_RESEARCH_SECTIONS, [
      {
        id: "frontend",
        icon: "🧩",
        label: "Frontend",
        sub: "Duplicate should be ignored",
        reason: "Duplicate",
        priority: "required",
        category: "dynamic",
      },
      {
        id: "notifications",
        icon: "🧩",
        label: "Notifications",
        sub: "Email, SMS, push",
        reason: "Users need alerts and reminders.",
        priority: "optional",
        category: "dynamic",
      },
    ]);

    expect(merged.some((section) => section.id === "frontend")).toBe(true);
    expect(merged.filter((section) => section.id === "frontend")).toHaveLength(
      1,
    );
    expect(merged.some((section) => section.id === "notifications")).toBe(true);
  });
});

describe("buildInitialSdsState", () => {
  it("builds empty SDS state entries for all sections", () => {
    const state = buildInitialSdsState([
      ...CORE_RESEARCH_SECTIONS,
      {
        id: "analytics",
        icon: "🧩",
        label: "Analytics",
        sub: "Product and business telemetry",
        reason: "The team needs funnel visibility.",
        priority: "required",
        category: "dynamic",
      },
    ]);

    expect(Object.keys(state)).toContain("analytics");
    expect(state.analytics.selectedOption).toBeNull();
    expect(state.analytics.chatHistory).toEqual([]);
    expect(state.analytics.status).toBe("pending");
  });
});

describe("buildWebsiteTargets", () => {
  it("normalizes the site and adds common research pages", () => {
    expect(buildWebsiteTargets("acme.com")).toEqual([
      "https://acme.com/",
      "https://acme.com/about",
      "https://acme.com/product",
      "https://acme.com/features",
      "https://acme.com/pricing",
      "https://acme.com/docs",
      "https://acme.com/security",
      "https://acme.com/customers",
    ]);
  });

  it("returns no targets for an invalid website", () => {
    expect(buildWebsiteTargets("://bad url")).toEqual([]);
  });
});

describe("parseSearchResults", () => {
  it("extracts fallback search results from duckduckgo html", () => {
    const html = `
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Facme.com%2Fabout">Acme About</a>
      <a class="result__snippet">Cloud workflow automation for finance teams.</a>
    `;

    expect(parseSearchResults(html)).toEqual([
      {
        title: "Acme About",
        url: "https://acme.com/about",
        snippet: "Cloud workflow automation for finance teams.",
      },
    ]);
  });
});

describe("normalizeResearchResult", () => {
  it("normalizes dynamic sections and prefers actual route sources", () => {
    const result = normalizeResearchResult(
      {
        partnerResearch: {
          summary: "Acme builds workflow tools.",
          sources: [{ type: "intake", label: "Model hallucinated source" }],
        },
        inferred: {
          domain: "Finance",
        },
        discoveredSections: [
          { label: "Payments", reason: "Needed for billing." },
        ],
      },
      [{ type: "website", label: "Company website", url: "https://acme.com" }],
    );

    expect(result.partnerResearch.sources).toEqual([
      { type: "website", label: "Company website", url: "https://acme.com" },
    ]);
    expect(result.discoveredSections[0]).toMatchObject({
      id: "payments",
      label: "Payments",
      category: "dynamic",
      icon: "🧩",
    });
  });

  it("falls back to intake as the only source when no real sources were fetched", () => {
    const result = normalizeResearchResult(
      {
        partnerResearch: {
          summary: "Acme builds workflow tools.",
          sources: [{ type: "search", label: "Invented source" }],
        },
        inferred: {},
        discoveredSections: [],
      },
      [],
    );

    expect(result.partnerResearch.sources).toEqual([
      { type: "intake", label: "Project intake" },
    ]);
  });
});

describe("getResearchGrounding", () => {
  it("prefers researched partner context over inferred fallback", () => {
    expect(
      getResearchGrounding(
        {
          summary: "Acme",
          domain: "FinTech",
          targetUsers: ["finance ops managers"],
          constraints: ["SOC 2"],
        },
        {
          domain: "Software",
          targetUsers: ["admins"],
          constraints: ["none"],
        },
      ),
    ).toEqual({
      domain: "FinTech",
      targetUsers: ["finance ops managers"],
      constraints: ["SOC 2"],
    });
  });
});

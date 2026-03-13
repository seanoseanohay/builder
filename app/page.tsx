"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import { callClaude, callClaudeStream, getStoredApiKeyIfSet, setStoredApiKey } from "@/lib/api";
import { safeParseJSON } from "@/lib/json";
import {
  buildInitialSdsState,
  CORE_RESEARCH_SECTIONS,
  getResearchGrounding,
  mergeResearchSections,
  slugify,
} from "@/lib/research";
import { loadSession, saveSession, deleteSession } from "@/lib/session";
import { SECTION_PROMPTS } from "@/lib/sections";
import type {
  AppState,
  BriefState,
  Intake,
  Inferred,
  PartnerResearch,
  PlanState,
  ResearchSection,
  SDSData,
  SDSStateSection,
  SavedSession,
} from "@/lib/types";

const initialIntake: Intake = {
  company: "",
  website: "",
  projectName: "",
  status: "ACTIVE",
  problemStatement: "",
  functionalReqs: "",
  languages: "",
  techContact: "",
  additionalNotes: "",
};

function buildBriefSummary(
  intake: Intake,
  inferred: Inferred | undefined,
  companyProfile: string
): string {
  return `
COMPANY: ${intake.company}${intake.website ? " — " + intake.website : ""}
${companyProfile ? "COMPANY PROFILE:\n" + companyProfile + "\n" : ""}
PROJECT: ${intake.projectName}
STATUS: ${intake.status}
TECHNICAL CONTACT: ${intake.techContact || "not specified"}

PROBLEM STATEMENT:
${intake.problemStatement}

FUNCTIONAL REQUIREMENTS:
${intake.functionalReqs}

Required Languages/Stack: ${intake.languages || "not specified"}
Additional Notes: ${intake.additionalNotes || "none"}
${
  inferred
    ? `
Inferred Project Type: ${inferred.projectType || "TBD"}
Inferred Full Stack: ${(inferred.stack || []).join(", ") || "TBD"}
Inferred Constraints: ${(inferred.constraints || []).join(", ") || "none"}
Inferred Integrations: ${(inferred.integrations || []).join(", ") || "TBD"}
Target Users: ${(inferred.targetUsers || []).join(", ") || "TBD"}`
    : ""
}
`.trim();
}

export default function Home() {
  const [intake, setIntake] = useState<Intake>(initialIntake);
  const [brief, setBrief] = useState<BriefState>({});
  const [prd, setPrd] = useState("");
  const [plan, setPlan] = useState<PlanState>({});
  const [sdsState, setSdsState] = useState<Record<string, SDSStateSection>>(() =>
    buildInitialSdsState(CORE_RESEARCH_SECTIONS)
  );
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [currentStep, setCurrentStep] = useState(1);
  const [openCards, setOpenCards] = useState<Set<string>>(new Set(["prd-full", "ep-plan"]));
  const [showRestoreBanner, setShowRestoreBanner] = useState(false);
  const [restoreInfo, setRestoreInfo] = useState("");
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchLoadingText, setResearchLoadingText] = useState(
    "Researching company and analyzing system requirements..."
  );
  const [researchOutputVisible, setResearchOutputVisible] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [prdLoading, setPrdLoading] = useState(false);
  const [prdOutputVisible, setPrdOutputVisible] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [planOutputVisible, setPlanOutputVisible] = useState(false);
  const [planStreamingText, setPlanStreamingText] = useState("");
  const [inferLoading, setInferLoading] = useState(false);
  const [inferredVisible, setInferredVisible] = useState(false);
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [showApiKeyPanel, setShowApiKeyPanel] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiKeySavedFeedback, setApiKeySavedFeedback] = useState(false);
  const [hasStoredApiKey, setHasStoredApiKey] = useState(false);
  const savedSessionRef = useRef<SavedSession | null>(null);

  const mergedFromBrief = mergeResearchSections(CORE_RESEARCH_SECTIONS, brief.discoveredSections || []);
  const researchSections =
    brief.proposedLayers && brief.proposedLayers.length > 0 ? brief.proposedLayers : mergedFromBrief;

  const callClaudeWithKeyCheck = useCallback(
    async (systemPrompt: string, userPrompt: string, keyFromInput?: string): Promise<string> => {
      if (keyFromInput?.trim() && !getStoredApiKeyIfSet()) {
        setStoredApiKey(keyFromInput);
        setHasStoredApiKey(true);
      }
      setApiKeyError(null);
      try {
        return await callClaude(systemPrompt, userPrompt);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith("NO_API_KEY:")) {
          setApiKeyError(msg.replace(/^NO_API_KEY:/, ""));
          setShowApiKeyPanel(true);
        }
        throw e;
      }
    },
    []
  );

  const persistSession = useCallback(() => {
    const snap: Record<string, Partial<SDSStateSection>> = {};
    researchSections.forEach((sec) => {
      const s = sdsState[sec.id];
      if (s)
        snap[sec.id] = {
          status: s.status,
          data: s.data,
          selectedOption: s.selectedOption,
          decisionRecord: s.decisionRecord,
          chatHistory: s.chatHistory,
        };
    });
    saveSession({
      state: { brief, research: {}, prd, plan },
      snap,
      completedSteps: Array.from(completedSteps),
      currentStep,
    });
  }, [brief, sdsState, completedSteps, currentStep, prd, plan, researchSections]);

  useEffect(() => {
    const stored = !!getStoredApiKeyIfSet();
    setHasStoredApiKey(stored);
    if (!stored) setShowApiKeyPanel(true);
  }, []);

  useEffect(() => {
    const saved = loadSession();
    if (!saved?.state?.brief?.intake?.company) return;
    const age = Math.round((Date.now() - saved.savedAt) / 60000);
    const company = saved.state.brief.intake.company;
    const project = saved.state.brief.intake.projectName;
    setRestoreInfo(
      `${company} — ${project} (saved ${age < 1 ? "just now" : age + "m ago"})`
    );
    setShowRestoreBanner(true);
    savedSessionRef.current = saved;
  }, []);

  useEffect(() => {
    if (!brief.intake?.company) return;
    persistSession();
  }, [brief, sdsState, completedSteps, currentStep, prd, plan, persistSession]);

  const restoreSession = useCallback(() => {
    const saved = savedSessionRef.current;
    if (!saved) return;
    setShowRestoreBanner(false);
    setBrief(saved.state.brief || {});
    setIntake(saved.state.brief?.intake || initialIntake);
    setPrd(saved.state.prd || "");
    setPlan(saved.state.plan || {});
    setResearchError(null);
    setCompletedSteps(new Set(saved.completedSteps || []));
    setCurrentStep(saved.currentStep || 1);
    if (saved.snap) {
      const restoredSections =
        (saved.state.brief?.proposedLayers?.length ?? 0) > 0
          ? saved.state.brief!.proposedLayers!
          : mergeResearchSections(CORE_RESEARCH_SECTIONS, saved.state.brief?.discoveredSections || []);
      const next: Record<string, SDSStateSection> = buildInitialSdsState(restoredSections);
      Object.entries(saved.snap).forEach(([k, v]) => {
        if (next[k]) {
          next[k] = { ...next[k], ...v, chatHistory: v.chatHistory || [] };
        }
      });
      setSdsState(next);
    }
    setResearchOutputVisible((saved.snap && Object.keys(saved.snap).length > 0) || false);
    setPrdOutputVisible(!!(saved.state.prd && saved.currentStep >= 4));
    setPlanOutputVisible(!!(saved.state.plan?.plan && saved.currentStep >= 5));
    savedSessionRef.current = null;
  }, []);

  const discardSessionHandler = useCallback(() => {
    setShowRestoreBanner(false);
    savedSessionRef.current = null;
    deleteSession();
  }, []);

  const goToStep = useCallback(
    (n: number) => {
      if (n > currentStep && !completedSteps.has(currentStep)) return;
      setCurrentStep(n);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [currentStep, completedSteps]
  );

  const toggleCard = useCallback((id: string) => {
    setOpenCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const copyContent = useCallback((text: string, btnId: string) => {
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.textContent = "✓ Copied";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = "Copy";
          btn.classList.remove("copied");
        }, 2000);
      }
    });
  }, []);

  const inferFromBrief = useCallback(async () => {
    if (!intake.company || !intake.problemStatement) {
      alert("Fill in at least Company Name and Problem Statement first.");
      return;
    }
    setInferLoading(true);
    try {
      const result = await callClaudeWithKeyCheck(
        `You are a technical analyst. From a project intake form, extract and infer key technical facts as JSON. Return ONLY valid JSON, no explanation, no markdown fences.`,
        `Extract from this project intake:

Company: ${intake.company}${intake.website ? " (" + intake.website + ")" : ""}
Project: ${intake.projectName}
Problem: ${intake.problemStatement}
Functional Requirements: ${intake.functionalReqs}
Given Languages: ${intake.languages}
Notes: ${intake.additionalNotes}

Return JSON with these keys:
- projectType: string (e.g. "Web Application", "API Service", "Mobile App", "CLI Tool", "MCP Server", "AI Agent", "Browser Tool")
- stack: array of strings (full recommended tech stack, 4-8 items — build on the given languages, infer the rest)
- constraints: array of strings (inferred constraints, compliance needs, performance requirements — empty if none)
- integrations: array of strings (third-party APIs/services likely needed based on the problem)
- targetUsers: array of strings (who will actually use this — be specific based on the company's domain)
- domain: string (the business domain e.g. "EdTech / AI Tutoring", "FinTech", "Healthcare", "Developer Tools")

JSON only:`,
        apiKeyValue
      );
      const parsed = safeParseJSON<Inferred>(result.replace(/```json|```/gi, "").trim());
      setBrief((b) => ({ ...b, inferred: parsed, intake }));
      setInferredVisible(true);
    } catch {
      setInferredVisible(true);
    }
    setInferLoading(false);
  }, [intake, apiKeyValue, callClaudeWithKeyCheck]);

  const analyzeSection = useCallback(
    async (
      secId: string,
      contextOverride?: {
        intake: Intake;
        companyProfile?: string;
        partnerResearch?: PartnerResearch;
        discoveredSections?: ResearchSection[];
        /** When set, use this exact list instead of core + discovered */
        sectionsOverride?: ResearchSection[];
      }
    ) => {
      const availableSections =
        contextOverride?.sectionsOverride ??
        (contextOverride?.discoveredSections
          ? mergeResearchSections(CORE_RESEARCH_SECTIONS, contextOverride.discoveredSections)
          : researchSections);
      const sec = availableSections.find((s) => s.id === secId);
      if (!sec) return;
      const intakeContext = contextOverride?.intake || brief.intake || intake;
      const companyProfile =
        contextOverride?.companyProfile ||
        contextOverride?.partnerResearch?.summary ||
        brief.companyProfile ||
        "";
      const partnerResearch = contextOverride?.partnerResearch || brief.partnerResearch;
      const discoveredSectionSummary = availableSections
        .map((section) => `${section.label} (${section.priority}) — ${section.reason}`)
        .join("\n");
      setSdsState((prev) => ({
        ...prev,
        [secId]: {
          ...prev[secId],
          status: "analyzing",
        },
      }));

      const contextBlock = `
COMPANY: ${intakeContext.company}
COMPANY PROFILE: ${companyProfile}
PROJECT: ${intakeContext.projectName}
PROBLEM: ${intakeContext.problemStatement}
REQUIREMENTS: ${intakeContext.functionalReqs}
GIVEN STACK HINTS: ${intakeContext.languages || "none"}
NOTES: ${intakeContext.additionalNotes || "none"}
PARTNER DOMAIN: ${partnerResearch?.domain || brief.inferred?.domain || "unknown"}
PARTNER USERS: ${(partnerResearch?.targetUsers || brief.inferred?.targetUsers || []).join(", ") || "unknown"}
PARTNER PRODUCTS: ${(partnerResearch?.products || []).join(", ") || "unknown"}
PARTNER CONSTRAINTS: ${(partnerResearch?.constraints || brief.inferred?.constraints || []).join(", ") || "none"}
DISCOVERED LAYERS:
${discoveredSectionSummary || "none"}
`.trim();

      const sys = `You are a senior system architect doing a system design review. You understand the company's context deeply. Return ONLY valid JSON — no markdown, no extra text. Be opinionated and specific.`;
      const basePrompt = SECTION_PROMPTS[secId as keyof typeof SECTION_PROMPTS];
      const dynamicPrompt = `Perform a SYSTEM DESIGN analysis for the ${sec.label.toUpperCase()} layer. Evaluate realistic implementation options for this layer in the context of this project. Use technical criteria only: data flow, latency, throughput, failure modes, consistency, observability, security, scale, and operational risk. Pay close attention to why this layer is needed: ${sec.reason}.`;

      const prompt = `${basePrompt || dynamicPrompt}

Project context:
${contextBlock}

Return this exact JSON — no markdown, no extra text:
{
  "recommendation": "2-4 sentences defending the chosen option using system design criteria: data access patterns, consistency guarantees, scaling characteristics, latency profile, protocol semantics, or other relevant technical properties. Name the specific technical reasons it fits this project's requirements.",
  "options": [
    {
      "name": "Option name",
      "verdict": "recommended" | "viable" | "avoid",
      "reason": "1-2 sentences using technical criteria: e.g. ACID compliance, eventual consistency trade-off, cold start latency, throughput ceiling, memory model, CAP theorem position, etc. Be specific to this project's load and access patterns."
    }
  ]
}

Rules:
- Include 3-5 options total. Mark exactly one as "recommended".
- Reasons must be technical system design arguments — NOT ease-of-use, developer experience, or team familiarity.
- "avoid" options should explain the specific technical failure mode for this project.
- Be opinionated. A staff engineer is presenting this at a design review.`;

      try {
        const raw = await callClaudeWithKeyCheck(sys, prompt, apiKeyValue);
        const parsed = safeParseJSON<SDSData>(raw);
        setSdsState((prev) => {
          const sectionState = prev[secId] || {
            status: "pending",
            chatHistory: [],
            selectedOption: null,
          };
          let selectedOption = sectionState.selectedOption;
          const recIndex = (parsed.options || []).findIndex((o) => o.verdict === "recommended");
          if (recIndex >= 0 && !selectedOption) {
            selectedOption = { index: recIndex, name: parsed.options![recIndex].name };
          }
          const firstMsg = `I've recommended ${selectedOption?.name || "the top option"} for ${sec.label.toLowerCase()}. Ask me why, push back on any option, or say "use X instead" to swap the recommendation.`;
          return {
            ...prev,
            [secId]: {
              ...prev[secId],
              status: "ready",
              data: parsed,
              selectedOption: selectedOption || null,
              chatHistory: [
                ...(prev[secId]?.chatHistory || []),
                { role: "assistant", content: firstMsg },
              ],
            },
          };
        });
        persistSession();
      } catch (e) {
        setSdsState((prev) => ({
          ...prev,
          [secId]: {
            ...prev[secId],
            status: "ready",
            data: {
              recommendation: `Analysis failed: ${e instanceof Error ? e.message : String(e)}`,
              options: [],
            },
          },
        }));
      }
    },
    [brief, intake, persistSession, apiKeyValue, researchSections, callClaudeWithKeyCheck]
  );

  const runResearch = useCallback(async () => {
    if (!intake.company || !intake.problemStatement) {
      alert("Please fill in at least Company Name and Problem Statement.");
      return;
    }
    setCompletedSteps((s) => new Set([...Array.from(s), 1]));
    goToStep(2);
    setResearchOutputVisible(false);
    setResearchError(null);
    setResearchLoading(true);
    setResearchLoadingText(`Researching ${intake.company} and discovering required system layers...`);

    if (apiKeyValue?.trim() && !getStoredApiKeyIfSet()) {
      setStoredApiKey(apiKeyValue);
      setHasStoredApiKey(true);
    }
    setApiKeyError(null);

    try {
      const apiKey = getStoredApiKeyIfSet();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers["X-Anthropic-API-Key"] = apiKey;

      const response = await fetch("/api/research", {
        method: "POST",
        headers,
        body: JSON.stringify({
          intake,
          apiKey: apiKey || apiKeyValue || undefined,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        inferred?: Inferred;
        partnerResearch?: PartnerResearch;
        discoveredSections?: ResearchSection[];
      };

      if (!response.ok) {
        const message = data.error || `Research error: ${response.status}`;
        if (response.status === 401) {
          setApiKeyError(message);
          setShowApiKeyPanel(true);
        }
        throw new Error(message);
      }

      const inferred = data.inferred || {
        projectType: "Software Project",
        stack: intake.languages ? [intake.languages] : [],
        constraints: [],
        integrations: [],
        targetUsers: [],
        domain: "Software",
      };
      const partnerResearch = data.partnerResearch || {
        summary: `${intake.company} — proceeding from project context.`,
        domain: inferred.domain,
        targetUsers: inferred.targetUsers,
        constraints: inferred.constraints,
        sources: [{ type: "intake", label: "Project intake" }],
      };
      const discoveredSections = data.discoveredSections || [];
      const mergedSections = mergeResearchSections(CORE_RESEARCH_SECTIONS, discoveredSections);
      const nextBrief: BriefState = {
        intake,
        inferred,
        companyProfile: partnerResearch.summary,
        partnerResearch,
        discoveredSections,
        proposedLayers: mergedSections,
      };

      setBrief(nextBrief);
      setResearchOutputVisible(false);
    } catch (e) {
      setResearchError(e instanceof Error ? e.message : String(e));
      setResearchOutputVisible(false);
    }
    setResearchLoading(false);
  }, [intake, goToStep, apiKeyValue]);

  const continueToResearch = useCallback(() => {
    const layers = brief.proposedLayers && brief.proposedLayers.length > 0 ? brief.proposedLayers : mergedFromBrief;
    setResearchOutputVisible(true);
    setCompletedSteps((s) => new Set([...Array.from(s), 2]));
    goToStep(3);
    setSdsState((prev) => {
      const next = { ...buildInitialSdsState(layers) };
      Object.entries(prev).forEach(([id, value]) => {
        if (next[id]) next[id] = value;
      });
      return next;
    });
    layers.forEach((sec) =>
      analyzeSection(sec.id, {
        intake,
        companyProfile: brief.partnerResearch?.summary,
        partnerResearch: brief.partnerResearch,
        discoveredSections: brief.discoveredSections,
        sectionsOverride: layers,
      })
    );
  }, [brief.proposedLayers, brief.partnerResearch, brief.discoveredSections, mergedFromBrief, intake, goToStep, analyzeSection]);

  const selectOption = useCallback((secId: string, index: number, name: string) => {
    setSdsState((prev) => {
      const current = prev[secId];
      const wasLocked = current?.status === "locked";
      const selectionChanged =
        current?.selectedOption?.index !== index || current?.selectedOption?.name !== name;
      const shouldUnlock = wasLocked && selectionChanged;
      const sec = researchSections.find((s) => s.id === secId);
      const newChatSeed = sec
        ? [{ role: "assistant" as const, content: `You've selected ${name} for ${sec.label.toLowerCase()}. Ask me why, push back, or lock this decision when ready.` }]
        : [];
      return {
        ...prev,
        [secId]: {
          ...prev[secId],
          selectedOption: { index, name },
          ...(shouldUnlock
            ? {
                status: "ready",
                decisionRecord: undefined,
                chatHistory: newChatSeed,
              }
            : {}),
        },
      };
    });
  }, [researchSections]);

  const addChatMsg = useCallback((secId: string, role: string, text: string) => {
    setSdsState((prev) => {
      const next = { ...prev };
      const sec = next[secId] || { status: "pending", chatHistory: [], selectedOption: null };
      next[secId] = {
        ...sec,
        chatHistory: [
          ...sec.chatHistory,
          { role: role === "user" ? "user" : "assistant", content: text },
        ],
      };
      return next;
    });
  }, []);

  const sendChat = useCallback(
    async (secId: string) => {
      const input = document.getElementById(`chat-input-${secId}`) as HTMLInputElement | null;
      if (!input) return;
      const msg = input.value.trim();
      if (!msg) return;
      input.value = "";
      addChatMsg(secId, "user", msg);

      const sec = researchSections.find((s) => s.id === secId);
      const data = sdsState[secId]?.data;
      const selected = sdsState[secId]?.selectedOption;
      const sys = `You are a staff engineer presenting at a system design review. Defend or revise architecture choices using technical arguments only: consistency models, latency profiles, throughput limits, failure modes, protocol semantics, scaling characteristics, CAP theorem trade-offs, etc. Never justify choices with developer experience, ease of use, or team familiarity. Be direct and concise — under 100 words. Plain text only.`;
      const history = sdsState[secId]?.chatHistory || [];
      const messages = [...history.slice(-8), { role: "user", content: msg }];
      const contextPrefix = `Project: ${brief.intake?.projectName} for ${brief.intake?.company}. Current recommendation: ${selected?.name || "TBD"}. Options analyzed: ${(data?.options || []).map((o) => o.name).join(", ")}.`;

      try {
        const reply = await callClaudeWithKeyCheck(
          sys,
          `${contextPrefix}\n\n${messages.map((m) => m.role + ": " + m.content).join("\n")}`,
          apiKeyValue
        );
        addChatMsg(secId, "ai", reply);
        const optNames = (data?.options || []).map((o) => o.name.toLowerCase());
        optNames.forEach((name, i) => {
          const lower = msg.toLowerCase();
          if (
            lower.includes(name) &&
            (lower.includes("use ") ||
              lower.includes("go with") ||
              lower.includes("pick") ||
              lower.includes("choose"))
          ) {
            selectOption(secId, i, data!.options![i].name);
          }
        });
      } catch (e) {
        addChatMsg(secId, "ai", `Sorry, hit an error: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [brief.intake, sdsState, addChatMsg, selectOption, apiKeyValue, researchSections, callClaudeWithKeyCheck]
  );

  const lockSection = useCallback((secId: string) => {
    setSdsState((prev) => ({
      ...prev,
      [secId]: {
        ...prev[secId],
        status: "locked",
      },
    }));
    persistSession();
  }, [persistSession]);

  const [customOptionLoading, setCustomOptionLoading] = useState<string | null>(null);
  const submitCustomOption = useCallback(
    async (secId: string) => {
      const userText = window.prompt(
        "Describe your option (e.g. \"We'll use our internal Foo service\" or \"Custom in-house solution\"):"
      );
      if (!userText?.trim()) return;
      setCustomOptionLoading(secId);
      try {
        const sys = "You are a technical editor. Rewrite the user's architecture choice as a clear, concise option. Return ONLY valid JSON, no markdown: { \"name\": \"Short option name\", \"reason\": \"1-2 sentences explaining why this fits the project.\" }";
        const raw = await callClaudeWithKeyCheck(sys, userText.trim(), apiKeyValue);
        const parsed = safeParseJSON<{ name?: string; reason?: string }>(raw.replace(/```json|```/gi, "").trim());
        const name = (parsed?.name ?? userText).trim().slice(0, 120);
        const reason = (parsed?.reason ?? "Custom choice.").trim().slice(0, 300);
        setSdsState((prev) => {
          const sec = prev[secId];
          const options = [...(sec?.data?.options || []), { name, verdict: "recommended" as const, reason }];
          const index = options.length - 1;
          return {
            ...prev,
            [secId]: {
              ...prev[secId],
              data: sec?.data ? { ...sec.data, options } : { recommendation: sec?.data?.recommendation ?? "", options },
              selectedOption: { index, name },
              status: "ready",
              decisionRecord: undefined,
              chatHistory: [
                ...(sec?.chatHistory || []),
                { role: "assistant", content: `You've selected "${name}" (your custom option). You can lock this decision when ready.` },
              ],
            },
          };
        });
        persistSession();
      } catch (e) {
        alert(`Could not rewrite option: ${e instanceof Error ? e.message : String(e)}`);
      }
      setCustomOptionLoading(null);
    },
    [callClaudeWithKeyCheck, apiKeyValue, persistSession]
  );

  const lockedCount = researchSections.filter((s) => sdsState[s.id]?.status === "locked").length;
  const totalSections = researchSections.length;

  const runPRD = useCallback(async () => {
    setCompletedSteps((s) => new Set([...Array.from(s), 3]));
    goToStep(4);
    setPrdLoading(true);
    setPrdOutputVisible(false);

    const intakeData = intake;
    const inf = brief.inferred || {};
    const companyProfile = brief.partnerResearch?.summary || brief.companyProfile || "";
    const grounding = getResearchGrounding(brief.partnerResearch, inf);
    const partnerNotes = [
      `Partner Domain: ${grounding.domain}`,
      `Partner Products: ${(brief.partnerResearch?.products || []).join(", ") || "unknown"}`,
      `Partner Constraints: ${(grounding.constraints || []).join(", ") || "none"}`,
      `Partner Notes: ${(brief.partnerResearch?.notes || []).join("; ") || "none"}`,
      `Discovered Layers: ${researchSections.map((sec) => `${sec.label} (${sec.priority})`).join(", ") || "none"}`,
    ].join("\n");
    const decisionRecordSys = `You are a technical decision recorder. Write a concise Decision Record for this system design choice. Plain text, structured with clear labels. Under 200 words.`;

    const newRecords: Record<string, string> = {};
    for (const sec of researchSections) {
      const s = sdsState[sec.id];
      if (s?.status !== "locked" || s?.decisionRecord) continue;
      const data = s.data;
      const selected = s.selectedOption;
      const chatSummary = (s.chatHistory || [])
        .filter((m) => m.role === "user")
        .map((m) => m.content)
        .join("; ");
      const prompt = `Write a Decision Record for the ${sec.label} layer of this project.

Project: ${brief.intake?.projectName} for ${brief.intake?.company}
Section: ${sec.label}
CHOSEN: ${selected?.name || "default recommendation"}
All options considered: ${(data?.options || []).map((o) => `${o.name} (${o.verdict})`).join(", ")}
Recommendation rationale: ${data?.recommendation || ""}
Discussion points from review: ${chatSummary || "none — accepted recommendation"}

Format:
DECISION: [chosen option]
RATIONALE: [why this was chosen for this specific project]
ALTERNATIVES CONSIDERED: [what else was evaluated and why rejected]
TRADE-OFFS ACCEPTED: [what we're giving up]
REVIEW NOTES: [anything surfaced in discussion]`;
      try {
        const record = await callClaudeWithKeyCheck(decisionRecordSys, prompt, apiKeyValue);
        newRecords[sec.id] = record;
      } catch {
        newRecords[sec.id] = `${sec.label}: ${selected?.name || "default"} (record generation failed)`;
      }
    }

    setSdsState((prev) => {
      const next = { ...prev };
      for (const [id, r] of Object.entries(newRecords)) {
        next[id] = { ...next[id], decisionRecord: r };
      }
      return next;
    });

    const decisionRecords = researchSections.map((sec) => {
      const s = sdsState[sec.id];
      const record = newRecords[sec.id] ?? s?.decisionRecord;
      const chosen = s?.selectedOption?.name || "default";
      const text = record ?? `${sec.label}: ${chosen} (selected, not yet locked)`;
      return `### ${sec.label}\n${text}`;
    }).join("\n\n");

    const sys = `You are a senior product manager. Write a comprehensive, developer-ready PRD in clean markdown format. Be specific, structured, and thorough. This document will be given directly to an AI coding agent to build from.`;
    const prompt = `Write a full Product Requirements Document (PRD) for the following project. Every section must be written through the lens of ${intakeData?.company}'s actual business context. The system design decisions below are FINAL — reflect them throughout the document.

COMPANY: ${intakeData?.company}${intakeData?.website ? " (" + intakeData.website + ")" : ""}
COMPANY PROFILE: ${companyProfile}

PROJECT: ${intakeData?.projectName}
STATUS: ${intakeData?.status}
TECHNICAL CONTACT: ${intakeData?.techContact || "not specified"}

PROBLEM STATEMENT:
${intakeData?.problemStatement}

FUNCTIONAL REQUIREMENTS:
${intakeData?.functionalReqs}

ADDITIONAL NOTES: ${intakeData?.additionalNotes || "none"}

TARGET USERS: ${(grounding.targetUsers || []).join(", ") || "TBD"}
DOMAIN: ${grounding.domain || "TBD"}

## LOCKED SYSTEM DESIGN DECISIONS:
${decisionRecords}

RESEARCH FINDINGS:
${partnerNotes}

The PRD must include:
1. Executive Summary
2. Problem Statement
3. Goals & Success Metrics (with measurable KPIs)
4. User Personas (2-3 specific personas)
5. User Stories (10-15, in "As a [user], I want to [action] so that [benefit]" format)
6. Functional Requirements (organized by feature area, numbered)
7. Non-Functional Requirements (performance, security, scalability)
8. Out of Scope (what we are NOT building)
9. Technical Architecture Overview
10. Data Models (key entities and relationships)
11. API Endpoints (if applicable)
12. UI/UX Requirements
13. Dependencies & Integrations
14. Acceptance Criteria

Format as clean markdown with proper headers.`;

    try {
      const prdText = await callClaudeWithKeyCheck(sys, prompt, apiKeyValue);
      setPrd(prdText);
      setPrdOutputVisible(true);
      persistSession();
    } catch (e) {
      setPrd(`Error: ${e instanceof Error ? e.message : String(e)}`);
      setPrdOutputVisible(true);
    }
    setPrdLoading(false);
  }, [brief, intake, sdsState, goToStep, persistSession, apiKeyValue, researchSections, callClaudeWithKeyCheck]);

  const runExecutionPlan = useCallback(async () => {
    setCompletedSteps((s) => new Set([...Array.from(s), 4]));
    goToStep(5);
    setPlanLoading(true);
    setPlanOutputVisible(true);
    setPlanStreamingText("");

    const intake2 = brief.intake || intake;
    const inf2 = brief.inferred || {};
    const cp2 = brief.partnerResearch?.summary || brief.companyProfile || "";
    const grounding = getResearchGrounding(brief.partnerResearch, inf2);
    const decisions2 = researchSections.map((sec) => {
      const s = sdsState[sec.id];
      return s?.selectedOption ? `${sec.label}: ${s.selectedOption.name}` : null;
    })
      .filter(Boolean)
      .join("\n");
    const context = `
Company: ${intake2?.company}
Company Profile: ${cp2.substring(0, 300)}...
Project: ${intake2?.projectName}
Domain: ${grounding.domain || "TBD"}
Problem: ${intake2?.problemStatement}
Functional Requirements: ${intake2?.functionalReqs}
Target Users: ${(grounding.targetUsers || []).join(", ") || "TBD"}
Partner Products: ${(brief.partnerResearch?.products || []).join(", ") || "unknown"}
Partner Constraints: ${(grounding.constraints || []).join(", ") || "none"}
Discovered Layers: ${researchSections.map((sec) => `${sec.label} (${sec.priority})`).join(", ") || "none"}

LOCKED STACK DECISIONS:
${decisions2 || "See PRD for details"}

PRD Summary: ${prd.substring(0, 600)}...
`.trim();

    const sys = `You are a senior software architect and technical project manager. Write detailed, actionable project planning documents that will be used by an AI coding agent (Claude) inside Cursor. All content should be in clean markdown. Be specific, thorough, and opinionated about the right approach.`;

    const planPrompt = `Write a detailed phased EXECUTION PLAN in markdown for this project. Include 4-6 phases. For each phase: phase name, goal, list of specific tasks with checkboxes, estimated complexity (S/M/L), dependencies, and definition of done. End with a "Quick Start" section — the exact first 3 commands or actions to run.\n\nContext:\n${context}`;

    try {
      const planText = await callClaudeStream(sys, planPrompt, (chunk) => {
        setPlanStreamingText((prev) => prev + chunk);
      });
      setPlan((prev) => ({ ...prev, plan: planText }));
      setPlanStreamingText("");

      const [projectbrief, productcontext, systempatterns, techcontext, activecontext, progressfile] =
        await Promise.all([
          callClaudeWithKeyCheck(
            sys,
            `Write the memory-bank/projectbrief.md file for this project. This is the foundation document — source of truth for scope. Include: project name, one-line description, core requirements (numbered), goals, scope boundaries (in scope / out of scope), target users, and success criteria. Format in clean markdown.\n\nContext:\n${context}`,
            apiKeyValue
          ),
          callClaudeWithKeyCheck(
            sys,
            `Write the memory-bank/productContext.md file. Cover: why this project exists, the exact problem it solves, how the product should work (user flow narrative), key user experience goals, and what "done" looks like from a user perspective. Clean markdown.\n\nContext:\n${context}`,
            apiKeyValue
          ),
          callClaudeWithKeyCheck(
            sys,
            `Write the memory-bank/systemPatterns.md file. Cover: system architecture overview, key technical decisions with rationale, design patterns to use, component/module relationships, data flow, and coding conventions. Be opinionated and specific.\n\nContext:\n${context}`,
            apiKeyValue
          ),
          callClaudeWithKeyCheck(
            sys,
            `Write the memory-bank/techContext.md file. Cover: full tech stack with versions, development environment setup (step by step), all dependencies, environment variables needed, deployment approach, and technical constraints.\n\nContext:\n${context}`,
            apiKeyValue
          ),
          callClaudeWithKeyCheck(
            sys,
            `Write the memory-bank/activeContext.md file for project kickoff. This represents current state at the START of the project. Include: current phase (Phase 1), immediate next steps (top 3), open questions that need answers, initial decisions made, and what should be focused on first session.\n\nContext:\n${context}`,
            apiKeyValue
          ),
          callClaudeWithKeyCheck(
            sys,
            `Write the memory-bank/progress.md file for project kickoff. This is the living progress tracker. At project start include: what works (nothing yet — project scaffolding), what's left to build (full feature backlog organized by phase), current status (Phase 1 - Not Started), and known unknowns. Include a checklist format for features.\n\nContext:\n${context}`,
            apiKeyValue
          ),
        ]);

      setPlan((prev) => ({
        ...prev,
        projectbrief,
        productcontext,
        systempatterns,
        techcontext,
        activecontext,
        progressfile,
      }));
      setCompletedSteps((s) => new Set([...Array.from(s), 4]));
      setPlanOutputVisible(true);
      persistSession();
    } catch (e) {
      setPlanStreamingText("");
      setPlan({ plan: `Error: ${e instanceof Error ? e.message : String(e)}` });
      setPlanOutputVisible(true);
    }
    setPlanLoading(false);
  }, [brief, intake, sdsState, prd, goToStep, persistSession, apiKeyValue, researchSections, callClaudeWithKeyCheck]);

  const downloadAll = useCallback(async () => {
    const files: [string, string][] = [
      ["PRD.md", prd],
      ["PLAN.md", plan.plan || ""],
      ["memory-bank/projectbrief.md", plan.projectbrief || ""],
      ["memory-bank/productContext.md", plan.productcontext || ""],
      ["memory-bank/systemPatterns.md", plan.systempatterns || ""],
      ["memory-bank/techContext.md", plan.techcontext || ""],
      ["memory-bank/activeContext.md", plan.activecontext || ""],
      ["memory-bank/progress.md", plan.progressfile || ""],
    ];
    const zip = new JSZip();
    for (const [filename, content] of files) {
      if (content) zip.file(filename, content);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ProjectBundle.zip";
    a.click();
    URL.revokeObjectURL(url);
  }, [prd, plan]);

  const startOver = useCallback(() => {
    if (!confirm("Start a new project? This will clear all generated content.")) return;
    setCompletedSteps(new Set());
    setBrief({});
    setPrd("");
    setPlan({});
    setIntake(initialIntake);
    setSdsState(buildInitialSdsState(CORE_RESEARCH_SECTIONS));
    setInferredVisible(false);
    setResearchOutputVisible(false);
    setResearchError(null);
    setPrdOutputVisible(false);
    setPlanOutputVisible(false);
    setPlanStreamingText("");
    setOpenCards(new Set(["prd-full", "ep-plan"]));
    deleteSession();
    goToStep(1);
  }, [goToStep]);

  const toggleSDS = useCallback((secId: string) => {
    setOpenCards((prev) => {
      const next = new Set(prev);
      const key = `sds-body-${secId}`;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return (
    <div className="container">
      {showRestoreBanner && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: "rgba(108,99,255,0.1)",
            border: "1px solid rgba(108,99,255,0.3)",
            borderRadius: 4,
            padding: "12px 16px",
            marginBottom: 20,
            fontSize: 12,
          }}
        >
          <span style={{ flex: 1, color: "var(--text)" }}>
            ↺ <strong>Resume session:</strong> {restoreInfo}
          </span>
          <button className="btn btn-primary" style={{ padding: "6px 14px", fontSize: 11 }} onClick={restoreSession}>
            Resume
          </button>
          <button className="btn btn-secondary" style={{ padding: "6px 14px", fontSize: 11 }} onClick={discardSessionHandler}>
            Start fresh
          </button>
        </div>
      )}

      <header>
        <div className="header-tag">{"// cursor + claude code workflow"}</div>
        <h1>Project Kickstarter</h1>
        <p className="subtitle">Brief → Proposing layers → Research → PRD → Plan → Export</p>

        <div className="api-key-strip">
          <button
            type="button"
            className="api-key-toggle"
            onClick={() => setShowApiKeyPanel((v) => !v)}
            aria-expanded={showApiKeyPanel}
          >
            {hasStoredApiKey ? "✓ API key saved (persists in this browser)" : "⚙ Add your Anthropic API key (for demo)"}
          </button>
          {showApiKeyPanel && (
            <div className="api-key-panel">
              {apiKeyError && (
                <div className="alert alert-warning" style={{ marginBottom: 12 }}>
                  {apiKeyError}
                </div>
              )}
              {apiKeySavedFeedback && (
                <div className="alert alert-success" style={{ marginBottom: 12 }}>
                  Key saved. It will persist in this browser so you don&apos;t have to re-enter it. Use &quot;Preview Inferred Details&quot; or &quot;Run Research &amp; Continue&quot; below.
                </div>
              )}
              <p className="section-desc" style={{ marginBottom: 12 }}>
                Paste your Anthropic API key below and click Save. The app will use it for the next action (e.g. Run Research). Get a key at{" "}
                <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>console.anthropic.com</a>.
              </p>
              <div className="trust-note">
                <strong>Trust &amp; privacy</strong> — Your key is stored only in this browser (localStorage) and is not sent to our server except to forward each request to Anthropic. We do not log or store it. You can verify this in the source: <code>app/api/claude/route.ts</code>.
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="password"
                  className="api-key-input"
                  placeholder="sk-ant-..."
                  value={apiKeyValue}
                  onChange={(e) => {
                    setApiKeyValue(e.target.value);
                    setApiKeyError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setStoredApiKey(apiKeyValue);
                      setHasStoredApiKey(!!apiKeyValue.trim());
                      setApiKeyValue("");
                      setApiKeyError(null);
                      setApiKeySavedFeedback(true);
                      setTimeout(() => setApiKeySavedFeedback(false), 5000);
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: "8px 16px", fontSize: 12 }}
                  onClick={() => {
                    setStoredApiKey(apiKeyValue);
                    setHasStoredApiKey(!!apiKeyValue.trim());
                    setApiKeyValue("");
                    setApiKeyError(null);
                    setApiKeySavedFeedback(true);
                    setTimeout(() => setApiKeySavedFeedback(false), 5000);
                  }}
                >
                  Save (persists until you clear it)
                </button>
                {hasStoredApiKey && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: "8px 16px", fontSize: 12 }}
                    onClick={() => {
                      setStoredApiKey(null);
                      setHasStoredApiKey(false);
                      setApiKeyValue("");
                      setApiKeyError(null);
                      setApiKeySavedFeedback(false);
                    }}
                  >
                    Clear key
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="steps-bar">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <div
            key={n}
            className={`step-indicator ${currentStep === n ? "active" : ""} ${completedSteps.has(n) ? "done" : ""}`}
            onClick={() => goToStep(n)}
          >
            <span className="step-num">{String(n).padStart(2, "0")}</span>
            {n === 1 && "Brief"}
            {n === 2 && "Proposing layers"}
            {n === 3 && "Research"}
            {n === 4 && "PRD"}
            {n === 5 && "Plan"}
            {n === 6 && "Export"}
          </div>
        ))}
      </div>

      {/* Panel 1: Brief */}
      <div className={`panel ${currentStep === 1 ? "active" : ""}`} id="panel-1">
        <div className="section-title">Project Intake</div>
        <p className="section-desc">
          Fill in the client&apos;s project details. Claude will research the company first — understanding who they are, what they build, and who their users are — then generate every document through that lens.
        </p>

        <div className="grid-2">
          <div className="field-group" style={{ margin: 0 }}>
            <label>Company Name</label>
            <input
              type="text"
              value={intake.company}
              onChange={(e) => setIntake((i) => ({ ...i, company: e.target.value }))}
              placeholder="fake company"
            />
          </div>
          <div className="field-group" style={{ margin: 0 }}>
            <label>Website</label>
            <input
              type="text"
              value={intake.website}
              onChange={(e) => setIntake((i) => ({ ...i, website: e.target.value }))}
              placeholder="fake website"
            />
          </div>
        </div>

        <div className="grid-2-1">
          <div className="field-group" style={{ margin: 0 }}>
            <label>Project Name</label>
            <input
              type="text"
              value={intake.projectName}
              onChange={(e) => setIntake((i) => ({ ...i, projectName: e.target.value }))}
              placeholder="awesome project name"
            />
          </div>
          <div className="field-group" style={{ margin: 0 }}>
            <label>Status</label>
            <select
              value={intake.status}
              onChange={(e) => setIntake((i) => ({ ...i, status: e.target.value }))}
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="PLANNING">PLANNING</option>
              <option value="ON HOLD">ON HOLD</option>
              <option value="COMPLETE">COMPLETE</option>
            </select>
          </div>
        </div>

        <div className="field-group">
          <label>Problem Statement</label>
          <textarea
            value={intake.problemStatement}
            onChange={(e) => setIntake((i) => ({ ...i, problemStatement: e.target.value }))}
            style={{ minHeight: 120 }}
            placeholder="Describe the problem and what success looks like..."
          />
        </div>

        <div className="field-group">
          <label>Functional Requirements</label>
          <textarea
            value={intake.functionalReqs}
            onChange={(e) => setIntake((i) => ({ ...i, functionalReqs: e.target.value }))}
            style={{ minHeight: 90 }}
            placeholder="List main features or requirements..."
          />
        </div>

        <div className="grid-2">
          <div className="field-group" style={{ margin: 0 }}>
            <label>Required Languages / Stack</label>
            <input
              type="text"
              value={intake.languages}
              onChange={(e) => setIntake((i) => ({ ...i, languages: e.target.value }))}
              placeholder="preferred languages or stack"
            />
          </div>
          <div className="field-group" style={{ margin: 0 }}>
            <label>Technical Contact</label>
            <input
              type="text"
              value={intake.techContact}
              onChange={(e) => setIntake((i) => ({ ...i, techContact: e.target.value }))}
              placeholder="fake person name"
            />
          </div>
        </div>

        <div className="field-group">
          <label>Additional Notes (optional)</label>
          <input
            type="text"
            value={intake.additionalNotes}
            onChange={(e) => setIntake((i) => ({ ...i, additionalNotes: e.target.value }))}
            placeholder="Constraints, integrations, or compliance needs..."
          />
        </div>

        {inferredVisible && brief.inferred && (
          <div className="inferred-block visible">
            <div className="inferred-label">⚙ Inferred from intake</div>
            <div>
              <div style={{ marginBottom: 6 }}>
                <strong style={{ color: "var(--muted)", fontSize: 11 }}>Domain: </strong>
                <span className="inferred-tag">{brief.inferred.domain || "—"}</span>
                <strong style={{ color: "var(--muted)", fontSize: 11 }}> Type: </strong>
                <span className="inferred-tag">{brief.inferred.projectType || "—"}</span>
              </div>
              <div style={{ marginBottom: 6 }}>
                <strong style={{ color: "var(--muted)", fontSize: 11 }}>Target Users: </strong>
                {(brief.inferred.targetUsers || []).map((u) => (
                  <span key={u} className="inferred-tag">
                    {u}
                  </span>
                ))}
              </div>
              <div style={{ marginBottom: 6 }}>
                <strong style={{ color: "var(--muted)", fontSize: 11 }}>Full Stack: </strong>
                {(brief.inferred.stack || []).map((s) => (
                  <span key={s} className="inferred-tag">
                    {s}
                  </span>
                ))}
              </div>
              <div style={{ marginBottom: 4 }}>
                <strong style={{ color: "var(--muted)", fontSize: 11 }}>Constraints: </strong>
                {(brief.inferred.constraints || []).length
                  ? brief.inferred.constraints!.map((c) => (
                      <span key={c} className="inferred-tag">
                        {c}
                      </span>
                    ))
                  : "none detected"}
                <strong style={{ color: "var(--muted)", fontSize: 11 }}> Integrations: </strong>
                {(brief.inferred.integrations || []).map((i) => (
                  <span key={i} className="inferred-tag">
                    {i}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="btn-row">
          <button className="btn btn-secondary" onClick={inferFromBrief} disabled={inferLoading}>
            {inferLoading ? "...inferring" : "🔎 Preview Inferred Details"}
          </button>
          <button className="btn btn-primary" onClick={runResearch}>⚡ Run Research & Continue</button>
        </div>
      </div>

      {/* Panel 2: Proposing layers */}
      <div className={`panel ${currentStep === 2 ? "active" : ""}`} id="panel-2">
        <div className="section-title">Proposing layers</div>
        <p className="section-desc">
          Review recommended layers and why each is needed. Remove any you don&apos;t need, add any that are missing, then continue to research options for each layer.
        </p>

        {currentStep === 2 && researchLoading && (
          <div className="loading-block active">
            <div className="spinner" />
            <div className="loading-text">
              <span className="status-dot" />
              {researchLoadingText}
            </div>
          </div>
        )}

        {currentStep === 2 && !researchLoading && researchError && (
          <div className="alert alert-warning" style={{ marginTop: 12 }}>
            {researchError}
          </div>
        )}

        {currentStep === 2 && !researchLoading && !researchError && (brief.proposedLayers?.length ?? 0) > 0 && (
          <div className="output-card" style={{ marginBottom: 16 }}>
            <div className="output-card-header">
              <div className="card-title">Recommended layers</div>
            </div>
            <div className="output-card-body open">
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {(brief.proposedLayers || []).map((section, index) => (
                  <div
                    key={section.id}
                    style={{
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 8,
                      padding: 14,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                      <div>
                        <strong style={{ fontSize: 15 }}>{section.label}</strong>
                        {section.sub && (
                          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>{section.sub}</div>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: "4px 10px", fontSize: 11 }}
                        onClick={() => {
                          const next = (brief.proposedLayers || []).filter((_, i) => i !== index);
                          setBrief((b) => ({ ...b, proposedLayers: next.length ? next : undefined }));
                        }}
                      >
                        Remove
                      </button>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text)" }}>
                      <span style={{ color: "var(--muted)", marginRight: 6 }}>Why we need it:</span>
                      {section.reason || "—"}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    const label = window.prompt("Layer name (e.g. Search / Data Exploration):");
                    if (!label?.trim()) return;
                    const reason = window.prompt("Why we need this layer (optional):")?.trim() || "User-added layer.";
                    const id = slugify(label);
                    const existingIds = new Set((brief.proposedLayers || []).map((s) => s.id));
                    let finalId = id;
                    let n = 1;
                    while (existingIds.has(finalId)) {
                      finalId = `${id}-${++n}`;
                    }
                    const newSection: ResearchSection = {
                      id: finalId,
                      icon: "🧩",
                      label: label.trim(),
                      sub: "",
                      reason,
                      priority: "required",
                      category: "dynamic",
                    };
                    setBrief((b) => ({
                      ...b,
                      proposedLayers: [...(b.proposedLayers || []), newSection],
                    }));
                  }}
                >
                  + Add layer
                </button>
                <button type="button" className="btn btn-primary" onClick={continueToResearch}>
                  Continue to Research →
                </button>
              </div>
            </div>
          </div>
        )}

        {currentStep === 2 && !researchLoading && !researchError && (!brief.proposedLayers || brief.proposedLayers.length === 0) && (
          <p className="section-desc">
            Run &quot;Run Research &amp; Continue&quot; from the Brief step to get recommended layers, then return here to review and edit them.
          </p>
        )}
      </div>

      {/* Panel 3: Research */}
      <div className={`panel ${currentStep === 3 ? "active" : ""}`} id="panel-3">
        <div className="section-title">System Design Review</div>
        <p className="section-desc">
          Claude analyzes each layer of the system and recommends options. Debate any decision inline — then lock it in.
        </p>

        {!researchOutputVisible && !researchError && (
          <div className="loading-block active">
            <div className="spinner" />
            <div className="loading-text">
              <span className="status-dot" />
              {researchLoadingText}
            </div>
          </div>
        )}

        {!researchOutputVisible && researchError && (
          <div className="alert alert-warning" style={{ marginTop: 12 }}>
            {researchError}
          </div>
        )}

        {researchOutputVisible && (
          <div>
            {brief.partnerResearch && (
              <div className="output-card" style={{ marginBottom: 16 }}>
                <div className="output-card-header">
                  <div className="card-title">🏢 Partner Context <span className="card-badge">research</span></div>
                </div>
                <div className="output-card-body open">
                  <div className="output-content">{brief.partnerResearch.summary}</div>
                  <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <span className="inferred-tag">{brief.partnerResearch.domain || "Unknown domain"}</span>
                    {(brief.partnerResearch.targetUsers || []).map((user) => (
                      <span key={user} className="inferred-tag">{user}</span>
                    ))}
                    {(brief.partnerResearch.constraints || []).map((constraint) => (
                      <span key={constraint} className="inferred-tag">{constraint}</span>
                    ))}
                  </div>
                  {!!brief.partnerResearch.sources?.length && (
                    <div style={{ marginTop: 12, fontSize: 12, color: "var(--muted)" }}>
                      Sources used:{" "}
                      {brief.partnerResearch.sources
                        .map((source) => source.label)
                        .join(", ")}
                    </div>
                  )}
                </div>
              </div>
            )}

            {brief.inferred && (
              <div className="output-card" style={{ marginBottom: 16 }}>
                <div className="output-card-header">
                  <div className="card-title">⚙ Inferred Project Context <span className="card-badge">context</span></div>
                </div>
                <div className="output-card-body open">
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <span className="inferred-tag">{brief.inferred.domain || "Unknown domain"}</span>
                    <span className="inferred-tag">{brief.inferred.projectType || "Unknown project type"}</span>
                    {(brief.inferred.stack || []).map((item) => (
                      <span key={item} className="inferred-tag">{item}</span>
                    ))}
                    {(brief.inferred.integrations || []).map((item) => (
                      <span key={item} className="inferred-tag">{item}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {!!brief.discoveredSections?.length && (
              <div className="output-card" style={{ marginBottom: 16 }}>
                <div className="output-card-header">
                  <div className="card-title">🧭 Discovered Layers <span className="card-badge">dynamic</span></div>
                </div>
                <div className="output-card-body open">
                  <div style={{ marginBottom: 10, fontSize: 13, color: "var(--muted)" }}>
                    The research pass inferred additional layers from the brief and partner context.
                  </div>
                  <div style={{ display: "grid", gap: 16 }}>
                    {(["required", "optional"] as const).map((priority) => {
                      const sections = brief.discoveredSections?.filter((section) => section.priority === priority) || [];
                      if (!sections.length) return null;
                      return (
                        <div key={priority}>
                          <div style={{ marginBottom: 8, fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>
                            {priority} layers
                          </div>
                          <div style={{ display: "grid", gap: 10 }}>
                            {sections.map((section) => (
                              <div key={section.id} style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 12 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
                                  <strong>{section.label}</strong>
                                  <span className="card-badge">{section.priority}</span>
                                </div>
                                <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 6 }}>{section.sub}</div>
                                <div style={{ fontSize: 13 }}>{section.reason}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            <div className="sections-progress">
              <span>{lockedCount} of {totalSections} sections locked</span>
              <div className="progress-bar-track">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${totalSections ? (lockedCount / totalSections) * 100 : 0}%` }}
                />
              </div>
              <span>{totalSections ? Math.round((lockedCount / totalSections) * 100) : 0}%</span>
            </div>

            <div style={{ marginBottom: 16 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  const label = window.prompt("Layer name (e.g. Search / Data Exploration):");
                  if (!label?.trim()) return;
                  const reason = window.prompt("Why we need this layer (optional):")?.trim() || "User-added layer.";
                  const id = slugify(label);
                  const existingIds = new Set(researchSections.map((s) => s.id));
                  let finalId = id;
                  let n = 1;
                  while (existingIds.has(finalId)) finalId = `${id}-${++n}`;
                  const newSection: ResearchSection = {
                    id: finalId,
                    icon: "🧩",
                    label: label.trim(),
                    sub: "",
                    reason,
                    priority: "required",
                    category: "dynamic",
                  };
                  const nextLayers = [...researchSections, newSection];
                  setBrief((b) => ({ ...b, proposedLayers: nextLayers }));
                  setSdsState((prev) => ({
                    ...prev,
                    [finalId]: { status: "pending", chatHistory: [], selectedOption: null },
                  }));
                  analyzeSection(finalId, {
                    intake: brief.intake || intake,
                    companyProfile: brief.partnerResearch?.summary,
                    partnerResearch: brief.partnerResearch,
                    discoveredSections: brief.discoveredSections,
                    sectionsOverride: nextLayers,
                  });
                }}
              >
                + Add layer
              </button>
            </div>

            {researchSections.map((sec) => {
              const sv = sdsState[sec.id];
              const bodyOpen = sv?.status !== "locked" || openCards.has(`sds-body-${sec.id}`);
              return (
                <div
                  key={sec.id}
                  className={`sds-section ${sv?.status === "locked" ? "locked" : ""}`}
                >
                  <div className="sds-header" onClick={() => toggleSDS(sec.id)}>
                    <span className="sds-icon">{sec.icon}</span>
                    <span className="sds-label">{sec.label}</span>
                    <span className="sds-sublabel">{sec.sub}</span>
                    <span className={`sds-status ${sv?.status || "pending"}`}>
                      {sv?.status === "locked" ? "✓ Locked" : sv?.status === "ready" ? "Ready" : sv?.status === "analyzing" ? "Analyzing..." : "Pending"}
                    </span>
                  </div>
                  <div className={`sds-body ${bodyOpen ? "open" : ""}`}>
                    {sv?.data && (
                      <>
                        <div className="sds-rec">
                          <div className="sds-rec-label">★ Recommendation & Rationale</div>
                          <div className="sds-rec-content">{sv.data.recommendation}</div>
                        </div>
                        <div className="sds-options">
                          <div className="sds-options-label">Options — click to select</div>
                          <div className="options-grid">
                            {(sv.data.options || []).map((opt, i) => (
                              <div
                                key={i}
                                className={`option-card ${opt.verdict === "recommended" ? "recommended" : ""} ${sv.selectedOption?.index === i ? "selected" : ""}`}
                                onClick={() => selectOption(sec.id, i, opt.name)}
                              >
                                <div className="option-check">✓</div>
                                <div className="option-name">{opt.name}</div>
                                <div className={`option-verdict ${opt.verdict === "recommended" ? "rec" : opt.verdict === "avoid" ? "avoid" : "alt"}`}>
                                  {opt.verdict === "recommended" ? "★ Recommended" : opt.verdict === "avoid" ? "✗ Avoid" : "◇ Viable alternative"}
                                </div>
                                <div className="option-desc">{opt.reason}</div>
                              </div>
                            ))}
                            {sv?.status !== "locked" && (
                              <div
                                className="option-card alt"
                                style={{ borderStyle: "dashed" }}
                                onClick={() => customOptionLoading === sec.id ? undefined : submitCustomOption(sec.id)}
                              >
                                <div className="option-name">E: None of the above</div>
                                <div className="option-desc" style={{ color: "var(--muted)" }}>
                                  {customOptionLoading === sec.id ? "Rewriting..." : "Enter your own option →"}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                    {sv?.status !== "locked" && sv?.data && (
                      <>
                        <div className="sds-chat">
                          <div className="chat-thread">
                            {(sv.chatHistory || []).map((m, i) => (
                              <div key={i} className={`chat-msg ${m.role === "user" ? "user" : "ai"}`}>
                                {m.content}
                              </div>
                            ))}
                          </div>
                          <div className="chat-input-row">
                            <input
                              type="text"
                              id={`chat-input-${sec.id}`}
                              placeholder="Ask why, push back, or suggest an alternative..."
                              onKeyDown={(e) => {
                                if (e.key === "Enter") sendChat(sec.id);
                              }}
                            />
                            <button className="chat-send" onClick={() => sendChat(sec.id)}>Send</button>
                          </div>
                        </div>
                        <div className="sds-lock-bar">
                          <button className="lock-btn" onClick={() => lockSection(sec.id)}>Lock this decision</button>
                          <span className="lock-hint">Select your preferred option above, debate in chat if needed, then lock to generate the Decision Record.</span>
                        </div>
                      </>
                    )}
                    {sv?.status === "locked" && (
                      <div className="decision-record">
                        {sv?.decisionRecord ?? "Decision record will be generated when you click Generate PRD below."}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {lockedCount === totalSections ? (
              <div>
                <div className="alert alert-success" style={{ marginBottom: 16 }}>
                  ✓ All sections reviewed. Your decisions are locked and will flow into the PRD and memory bank.
                </div>
                <div className="btn-row">
                  <button className="btn btn-primary" onClick={runPRD}>→ Generate PRD</button>
                  <button className="btn btn-secondary" onClick={() => goToStep(2)}>← Edit layers</button>
                  <button className="btn btn-secondary" onClick={() => goToStep(1)}>← Edit Intake</button>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 16 }}>
                <button className="btn btn-secondary" onClick={runPRD} style={{ opacity: 0.6 }}>
                  → Generate PRD with current decisions
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Panel 4: PRD */}
      <div className={`panel ${currentStep === 4 ? "active" : ""}`} id="panel-4">
        <div className="section-title">Product Requirements Document</div>
        <p className="section-desc">Full PRD generated from your brief and research — ready to paste into Claude Code.</p>

        {prdLoading && (
          <div className="loading-block active">
            <div className="spinner" />
            <div className="loading-text">
              <span className="status-dot" /> Writing PRD with goals, user stories, features...
            </div>
          </div>
        )}

        {prdOutputVisible && !prdLoading && (
          <div>
            <div className="output-card">
              <div className="output-card-header" onClick={() => toggleCard("prd-full")}>
                <div className="card-title">📋 Full PRD <span className="card-badge green">PRD.md</span></div>
                <span className={`chevron ${openCards.has("prd-full") ? "open" : ""}`}>▼</span>
              </div>
              <div className={`output-card-body ${openCards.has("prd-full") ? "open" : ""}`}>
                <div className="output-content" id="prd-content">{prd}</div>
                <div style={{ marginTop: 10 }}>
                  <button
                    id="btn-copy-prd"
                    className="copy-btn"
                    onClick={() => copyContent(prd, "btn-copy-prd")}
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={runExecutionPlan}>→ Generate Execution Plan</button>
              <button className="btn btn-secondary" onClick={() => goToStep(3)}>← Back to Research</button>
            </div>
          </div>
        )}
      </div>

      {/* Panel 4: Plan */}
      <div className={`panel ${currentStep === 5 ? "active" : ""}`} id="panel-5">
        <div className="section-title">Execution Plan + Memory Bank</div>
        <p className="section-desc">Phased execution plan and all 6 memory-bank files — drop them straight into your Cursor project.</p>

        {planLoading && planStreamingText === "" && (
          <div className="loading-block active">
            <div className="spinner" />
            <div className="loading-text">
              <span className="status-dot" /> Building phased plan + memory-bank files...
            </div>
          </div>
        )}

        {planOutputVisible && (
          <div>
            {[
              { id: "ep-plan", title: "🗺️ Execution Plan", badge: "PLAN.md", badgeGreen: true, content: planStreamingText || plan.plan || "" },
              { id: "mb-brief", title: "🧠 projectbrief.md", badge: "memory-bank", content: plan.projectbrief },
              { id: "mb-product", title: "🧠 productContext.md", badge: "memory-bank", content: plan.productcontext },
              { id: "mb-system", title: "🧠 systemPatterns.md", badge: "memory-bank", content: plan.systempatterns },
              { id: "mb-tech", title: "🧠 techContext.md", badge: "memory-bank", content: plan.techcontext },
              { id: "mb-active", title: "🧠 activeContext.md", badge: "memory-bank", content: plan.activecontext },
              { id: "mb-progress", title: "🧠 progress.md", badge: "memory-bank", content: plan.progressfile },
            ].map(({ id, title, badge, badgeGreen, content }) => (
              <div key={id} className="output-card">
                <div className="output-card-header" onClick={() => toggleCard(id)}>
                  <div className="card-title">{title} <span className={`card-badge ${badgeGreen ? "green" : ""}`}>{badge}</span></div>
                  <span className={`chevron ${openCards.has(id) ? "open" : ""}`}>▼</span>
                </div>
                <div className={`output-card-body ${openCards.has(id) ? "open" : ""}`}>
                  <div className="output-content">{content || ""}</div>
                  <div style={{ marginTop: 10 }}>
                    <button
                      id={`btn-copy-${id}`}
                      className="copy-btn"
                      onClick={() => copyContent(content || "", `btn-copy-${id}`)}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <div className="btn-row">
              <button className="btn btn-success" onClick={() => goToStep(6)}>→ Get Setup Instructions</button>
              <button className="btn btn-secondary" onClick={() => goToStep(4)}>← Back to PRD</button>
            </div>
          </div>
        )}
      </div>

      {/* Panel 6: Export */}
      <div className={`panel ${currentStep === 6 ? "active" : ""}`} id="panel-6">
        <div className="section-title">Drop into Cursor / Claude Code</div>
        <p className="section-desc">Your project scaffold is ready. Follow these steps to get Claude building immediately.</p>

        <div className="file-tree">
          <div><span className="folder">📁 your-project/</span></div>
          <div style={{ paddingLeft: 20 }}><span className="folder">📁 memory-bank/</span></div>
          <div style={{ paddingLeft: 40 }}><span className="file new">✦ projectbrief.md</span></div>
          <div style={{ paddingLeft: 40 }}><span className="file new">✦ productContext.md</span></div>
          <div style={{ paddingLeft: 40 }}><span className="file new">✦ systemPatterns.md</span></div>
          <div style={{ paddingLeft: 40 }}><span className="file new">✦ techContext.md</span></div>
          <div style={{ paddingLeft: 40 }}><span className="file new">✦ activeContext.md</span></div>
          <div style={{ paddingLeft: 40 }}><span className="file new">✦ progress.md</span></div>
          <div style={{ paddingLeft: 20 }}><span className="folder">📁 .cursor/rules/</span></div>
          <div style={{ paddingLeft: 40 }}><span className="file new">✦ journal.mdc</span> (from cursor ruleset)</div>
          <div style={{ paddingLeft: 20 }}><span className="file new">✦ PRD.md</span></div>
          <div style={{ paddingLeft: 20 }}><span className="file new">✦ PLAN.md</span></div>
          <div style={{ paddingLeft: 20 }}><span className="file new">✦ CLAUDE.md</span> (your uploaded file)</div>
        </div>

        <div className="instruction-box">
          <strong>Step 1 — Create the project folder & paste files</strong><br />
          Create a new folder. Inside it, create a <span className="cmd">memory-bank/</span> folder and paste each of the 6 memory-bank files in (copy them from Step 04). Also paste <span className="cmd">PRD.md</span> and <span className="cmd">PLAN.md</span> into the root.
        </div>
        <div className="instruction-box">
          <strong>Step 2 — Add the Cursor rules</strong><br />
          In Cursor: <span className="cmd">Settings → Cursor Rules</span> → paste in the ruleset from the gist (ipenywis memory bank rules). Then create <span className="cmd">.cursor/rules/journal.mdc</span>.
        </div>
        <div className="instruction-box">
          <strong>Step 3 — Add your CLAUDE.md</strong><br />
          Paste your <span className="cmd">CLAUDE.md</span> into the project root. Claude Code reads this automatically at the start of every session.
        </div>
        <div className="instruction-box">
          <strong>Step 4 — Open in Cursor, start with Plan Mode</strong><br />
          Open the folder in Cursor. In the Claude Code panel, type:<br />
          <span className="cmd">/plan — read all memory-bank files and PRD.md, then ask me clarifying questions before we begin Phase 1</span><br /><br />
          Claude will read the full context, ask 4–6 questions, then present a plan for your approval before writing a single line of code.
        </div>
        <div className="instruction-box">
          <strong>Step 5 — Approve plan → Claude builds</strong><br />
          After approving the plan, Claude will execute phase by phase, updating <span className="cmd">activeContext.md</span> and <span className="cmd">progress.md</span> after each step.
        </div>

        <div className="download-all-card">
          <h3>📦 Download All Files</h3>
          <p>Get all generated files in one ZIP. Unzip into your project folder to add PRD, plan, and memory-bank files.</p>
          <button className="btn btn-success" onClick={downloadAll}>⬇ Download Project Bundle</button>
        </div>

        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={() => goToStep(5)}>← Back to Plan</button>
          <button className="btn btn-secondary" onClick={startOver}>↺ Start New Project</button>
        </div>
      </div>
    </div>
  );
}

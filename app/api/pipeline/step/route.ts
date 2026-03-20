import { NextRequest, NextResponse } from "next/server";
import { runRefinerStep } from "@/lib/refiner-stage";
import { runProjgenStep } from "@/lib/projgen-stage";
import { runBuilderStage, listWorkspaceFiles } from "@/lib/builder-stage";
import { getSectionOptions, runConsensusForSection, buildSdsHumanGateBreakdown } from "@/lib/sds-stage";
import { buildResearchDoc, buildPRDContext } from "@/lib/pipeline-wizard";
import { mergeResearchSections } from "@/lib/research";
import { CORE_RESEARCH_SECTIONS } from "@/lib/research";
import { callOpenRouterServer } from "@/lib/openrouter-server";
import {
  DEFAULT_POLICY,
  type PipelineState,
  type PipelineInput,
  type PipelinePolicy,
  type PipelineIntake,
  type PipelineResearchResult,
  type SDSDecision,
} from "@/lib/pipeline-types";
import type { ResearchSection } from "@/lib/types";

export const maxDuration = 120;

function intakeToResearchBody(intake: PipelineIntake): Record<string, unknown> {
  return {
    company: intake.company,
    website: intake.website,
    projectName: intake.projectName,
    status: intake.status ?? "ACTIVE",
    problemStatement: intake.problemStatement,
    functionalReqs: intake.functionalReqs,
    languages: intake.languages ?? "",
    techContact: "",
    additionalNotes: intake.additionalNotes ?? "",
  };
}

export async function POST(request: NextRequest) {
  let body: {
    state: PipelineState;
    policy?: Partial<PipelinePolicy>;
    humanAnswer?: string | null;
    openRouterApiKey?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    state: incomingState,
    policy: policyOverride,
    humanAnswer,
    openRouterApiKey,
  } = body;

  const policy = { ...DEFAULT_POLICY, ...policyOverride };
  const apiKey = openRouterApiKey?.trim() || undefined;

  let state: PipelineState = {
    ...incomingState,
    decisionLog: incomingState.decisionLog ?? [],
  };

  try {
    // Resolve human gate: if we have a human answer, feed it and continue
    if (state.humanGate && humanAnswer != null && humanAnswer.trim() !== "") {
      state = { ...state, humanGate: undefined };
    }

    const origin = request.headers.get("x-forwarded-host")
      ? `${request.headers.get("x-forwarded-proto") || "https"}://${request.headers.get("x-forwarded-host")}`
      : new URL(request.url).origin;

    // --- Intake → Research ---
    if (state.stage === "intake" && state.intake && !state.researchResult) {
      const res = await fetch(`${origin}/api/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intake: intakeToResearchBody(state.intake),
          openRouterApiKey: apiKey,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        return NextResponse.json({
          state: { ...state, error: data.error || `Research failed: ${res.status}` },
        }, { status: 200 });
      }
      const data = (await res.json()) as {
        partnerResearch: PipelineResearchResult["partnerResearch"];
        inferred: PipelineResearchResult["inferred"];
        discoveredSections: ResearchSection[];
      };
      const discovered = data.discoveredSections ?? [];
      const proposedLayers = mergeResearchSections(
        CORE_RESEARCH_SECTIONS as ResearchSection[],
        discovered,
      );
      return NextResponse.json({
        state: {
          ...state,
          stage: "sds",
          researchResult: {
            partnerResearch: data.partnerResearch,
            inferred: data.inferred ?? {},
            discoveredSections: discovered,
          },
          proposedLayers,
          error: undefined,
        },
      });
    }

    // --- SDS stage: one section per step ---
    if (state.stage === "sds" && state.intake && state.proposedLayers && state.researchResult) {
      const decisions = state.sdsDecisions ?? [];
      const optionsBySection = state.sdsOptionsBySection ?? {};
      const currentIndex = decisions.length;

      if (currentIndex >= state.proposedLayers.length) {
        return NextResponse.json({
          state: { ...state, stage: "prd" as const },
        });
      }

      const section = state.proposedLayers[currentIndex];
      let options = optionsBySection[section.id]?.options ?? null;

      if (!options || options.length === 0) {
        const sdsData = await getSectionOptions(
          section,
          state.intake,
          state.researchResult,
          apiKey,
        );
        options = sdsData.options;
        state = {
          ...state,
          sdsOptionsBySection: {
            ...optionsBySection,
            [section.id]: { recommendation: sdsData.recommendation, options },
          },
        };
      }

      if (state.humanGate && state.humanGateSectionId === section.id && humanAnswer != null && humanAnswer.trim() !== "") {
        const optNames = options.map((o) => o.name);
        const trimmed = humanAnswer.trim();
        let chosenIndex = optNames.findIndex((n) => n === trimmed || trimmed.endsWith(n));
        if (chosenIndex < 0) {
          const letter = trimmed.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
          if (letter) chosenIndex = letter.charCodeAt(0) - 65;
          chosenIndex = Math.max(0, Math.min(chosenIndex, options.length - 1));
        }
        const newDecision: SDSDecision = {
          sectionId: section.id,
          optionIndex: chosenIndex,
          optionName: options[chosenIndex]?.name ?? options[0].name,
        };
        return NextResponse.json({
          state: {
            ...state,
            humanGate: undefined,
            humanGateSectionId: undefined,
            sdsDecisions: [...decisions, newDecision],
            decisionLog: [
              ...state.decisionLog,
              { stage: "sds", question: section.label, humanAnswer: trimmed },
            ],
          },
        });
      }

      const consensus = await runConsensusForSection(
        options.map((o) => ({ name: o.name })),
        section.label,
        policy,
        apiKey,
      );

      state.decisionLog = [
        ...state.decisionLog,
        {
          stage: "sds",
          question: section.label,
          consensusPercent: consensus.consensusPercent,
          chosenAnswer: consensus.chosenName,
        },
      ];

      if (consensus.needsHuman && consensus.consensusResult) {
        const optLabels = options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o.name}`);
        const optionBreakdown = await buildSdsHumanGateBreakdown(
          options,
          consensus.consensusResult,
          apiKey,
        );
        return NextResponse.json({
          state: {
            ...state,
            humanGate: {
              stage: "sds",
              question: `Which option for ${section.label}?`,
              options: optLabels,
              recommendedIndex: Math.max(0, options.findIndex((o) => o.verdict === "recommended")),
              context: `No consensus after 20 agents (${consensus.consensusPercent}% best; threshold: ${policy.consensusThresholdPercent}%).`,
              optionBreakdown,
            },
            humanGateSectionId: section.id,
          },
        });
      }

      const newDecision: SDSDecision = {
        sectionId: section.id,
        optionIndex: consensus.chosenIndex,
        optionName: consensus.chosenName,
      };
      state = {
        ...state,
        sdsDecisions: [...decisions, newDecision],
      };
      if (state.sdsDecisions!.length >= state.proposedLayers!.length) {
        state.stage = "prd";
      }
      return NextResponse.json({ state });
    }

    // --- PRD stage ---
    if (state.stage === "prd" && state.intake && state.researchResult && state.sdsDecisions) {
      const sectionLabels = new Map(state.proposedLayers?.map((s) => [s.id, s.label]) ?? []);
      const context = buildPRDContext(state.intake, state.researchResult, state.sdsDecisions, sectionLabels);
      const sys = "You are a senior product manager. Write a comprehensive, developer-ready PRD in clean markdown. Be specific and structured. This will be used by an AI coding agent.";
      const prompt = `Write a full Product Requirements Document (PRD) for this project. Reflect the locked system design decisions throughout.

${context}

The PRD must include: Executive Summary, Problem Statement, Goals & Success Metrics, User Personas, User Stories (10-15), Functional Requirements, Non-Functional Requirements, Out of Scope, Technical Architecture Overview, Data Models, API Endpoints (if applicable), UI/UX Requirements, Dependencies & Integrations, Acceptance Criteria. Format as clean markdown with proper headers.`;

      const prdText = await callOpenRouterServer({
        model: "anthropic/claude-sonnet-4",
        messages: [{ role: "system", content: sys }, { role: "user", content: prompt }],
        max_tokens: 16384,
        apiKey,
      });
      return NextResponse.json({
        state: {
          ...state,
          prd: prdText,
          stage: "plan" as const,
        },
      });
    }

    // --- Plan stage ---
    if (state.stage === "plan" && state.intake && state.prd && state.researchResult && state.sdsDecisions) {
      const sectionLabels = new Map(state.proposedLayers?.map((s) => [s.id, s.label]) ?? []);
      const decisions2 = (state.sdsDecisions ?? [])
        .map((d) => `${sectionLabels.get(d.sectionId) ?? d.sectionId}: ${d.optionName}`)
        .join("\n");
      const context = `
Company: ${state.intake.company}
Project: ${state.intake.projectName}
Problem: ${state.intake.problemStatement}
Functional Requirements: ${state.intake.functionalReqs}
Target Users: ${(state.researchResult.partnerResearch?.targetUsers || state.researchResult.inferred?.targetUsers || []).join(", ") || "TBD"}
Locked Stack Decisions:
${decisions2}

PRD Summary: ${state.prd.slice(0, 800)}...
`.trim();

      const sys = "You are a senior software architect. Write detailed, actionable project planning documents for an AI coding agent. All content in clean markdown.";
      const planPrompt = `Write a detailed phased EXECUTION PLAN in markdown. Include 4-6 phases. For each phase: phase name, goal, list of specific tasks with checkboxes, estimated complexity (S/M/L), dependencies, and definition of done. End with a "Quick Start" section — the exact first 3 commands or actions to run.

Context:
${context}`;

      const planText = await callOpenRouterServer({
        model: "anthropic/claude-sonnet-4",
        messages: [{ role: "system", content: sys }, { role: "user", content: planPrompt }],
        max_tokens: 8192,
        apiKey,
      });

      const researchDoc = buildResearchDoc(
        state.researchResult,
        state.sdsDecisions,
        sectionLabels,
      );
      const input: PipelineInput = {
        plan: planText,
        requirements: state.intake.functionalReqs,
        prd: state.prd,
        research: researchDoc,
      };
      return NextResponse.json({
        state: {
          ...state,
          plan: planText,
          stage: "refiner" as const,
          input,
          inputMode: "documents",
        },
      });
    }

    // Refiner stage (input from either legacy four-doc paste or built in plan stage)
    if (state.stage === "refiner" && state.input) {
      const refinerHistory = state.refinerConversationHistory ?? [];
      const result = await runRefinerStep({
        input: state.input,
        policy,
        conversationHistory: refinerHistory,
        humanAnswer: state.humanGate ? humanAnswer : undefined,
        decisionLog: state.decisionLog,
        apiKey,
      });

      state = {
        ...state,
        refinerConversationHistory: result.conversationHistory,
        decisionLog: result.decisionLog,
        humanGate: result.humanGate,
        ...(result.refinedDocs && {
          refinedDocs: result.refinedDocs,
          stage: "projgen" as const,
        }),
      };

      if (result.humanGate) {
        return NextResponse.json({ state });
      }
      if (result.done && result.refinedDocs) {
        return NextResponse.json({ state });
      }
      // Not done, no human gate → caller should call again with same state (next refiner turn)
      return NextResponse.json({ state });
    }

    // Projgen stage
    if (state.stage === "projgen" && state.refinedDocs) {
      const projgenHistory = state.projgenConversationHistory ?? [];
      const result = await runProjgenStep({
        refinedDocs: state.refinedDocs,
        policy,
        conversationHistory: projgenHistory,
        humanAnswer: state.humanGate ? humanAnswer : undefined,
        decisionLog: state.decisionLog,
        apiKey,
      });

      state = {
        ...state,
        projgenConversationHistory: result.conversationHistory,
        decisionLog: result.decisionLog,
        humanGate: result.humanGate,
        ...(result.distilledDocs && {
          distilledDocs: result.distilledDocs,
          stage: "builder" as const,
        }),
      };

      if (result.humanGate) return NextResponse.json({ state });
      if (result.done && result.distilledDocs) return NextResponse.json({ state });
      return NextResponse.json({ state });
    }

    // Builder stage
    if (state.stage === "builder" && state.distilledDocs?.length) {
      const builderResult = await runBuilderStage({
        distilledDocs: state.distilledDocs,
      });

      if (!builderResult.success) {
        return NextResponse.json({
          state: {
            ...state,
            error: builderResult.error,
            humanGate: {
              stage: "builder",
              question: "Build failed. How do you want to proceed?",
              options: ["Retry", "Download docs only", "Abort"],
              recommendedIndex: 0,
              context: builderResult.error,
            },
          },
        });
      }

      const fileList = listWorkspaceFiles(builderResult.workspacePath);

      return NextResponse.json({
        state: {
          ...state,
          stage: "finished",
          outputPath: builderResult.workspacePath,
          decisionLog: [
            ...state.decisionLog,
            {
              stage: "builder",
              chosenAnswer: builderResult.summary,
            },
          ],
          error: undefined,
        },
        manifest: {
          workspacePath: builderResult.workspacePath,
          files: fileList,
          summary: builderResult.summary,
        },
      });
    }

    return NextResponse.json({ state });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      state: {
        ...state,
        error: message,
      },
    }, { status: 500 });
  }
}

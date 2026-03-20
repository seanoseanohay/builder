/**
 * Helpers to build PRD/plan context and research doc from pipeline state (intake + research + SDS).
 */
import type { PipelineResearchResult, SDSDecision, PipelineIntake } from "./pipeline-types";

export function buildResearchDoc(
  researchResult: PipelineResearchResult | undefined,
  sdsDecisions: SDSDecision[] | undefined,
  sectionLabels?: Map<string, string>,
): string {
  const parts: string[] = [];
  parts.push("# Pre-search / Research Context");
  parts.push("");
  parts.push(
    "Research output (company context, inferred project details, discovered layers) and locked system design decisions.",
  );
  parts.push("");

  if (researchResult?.partnerResearch) {
    const pr = researchResult.partnerResearch;
    parts.push("## Partner Research");
    parts.push("");
    parts.push(pr.summary);
    parts.push("");
    if (pr.domain) parts.push("- **Domain:** " + pr.domain);
    if (pr.targetUsers?.length) parts.push("- **Target users:** " + pr.targetUsers.join(", "));
    if (pr.products?.length) parts.push("- **Products:** " + pr.products.join(", "));
    if (pr.constraints?.length) parts.push("- **Constraints:** " + pr.constraints.join("; "));
    if (pr.notes?.length) pr.notes.forEach((n) => parts.push("  - " + n));
    parts.push("");
  }

  if (researchResult?.inferred) {
    const inf = researchResult.inferred;
    parts.push("## Inferred Project Context");
    parts.push("");
    if (inf.domain) parts.push("- **Domain:** " + inf.domain);
    if (inf.projectType) parts.push("- **Project type:** " + inf.projectType);
    if (inf.stack?.length) parts.push("- **Stack:** " + inf.stack.join(", "));
    if (inf.targetUsers?.length) parts.push("- **Target users:** " + inf.targetUsers.join(", "));
    parts.push("");
  }

  if (researchResult?.discoveredSections?.length) {
    parts.push("## Discovered Architecture Layers");
    parts.push("");
    for (const s of researchResult.discoveredSections) {
      parts.push(`- **${s.label}** (${s.priority}) — ${s.reason || s.sub}`);
    }
    parts.push("");
  }

  if (sdsDecisions?.length) {
    parts.push("## Locked System Design Decisions");
    parts.push("");
    for (const d of sdsDecisions) {
      const label = sectionLabels?.get(d.sectionId) ?? d.sectionId;
      parts.push(`- **${label}:** ${d.optionName}`);
    }
    parts.push("");
  }

  return parts.join("\n").trim() || "";
}

export function buildPRDContext(
  intake: PipelineIntake,
  researchResult: PipelineResearchResult | undefined,
  sdsDecisions: SDSDecision[] | undefined,
  sectionLabels?: Map<string, string>,
): string {
  const grounding = {
    domain: researchResult?.partnerResearch?.domain || researchResult?.inferred?.domain || "TBD",
    targetUsers: researchResult?.partnerResearch?.targetUsers || researchResult?.inferred?.targetUsers || [],
  };
  const decisionRecords =
    sdsDecisions
      ?.map((d) => {
        const label = sectionLabels?.get(d.sectionId) ?? d.sectionId;
        return `${label}: ${d.optionName}`;
      })
      .join("\n") || "None yet.";
  const partnerNotes =
    researchResult?.partnerResearch?.summary || "No partner research.";

  return `
COMPANY: ${intake.company}${intake.website ? " (" + intake.website + ")" : ""}
PROJECT: ${intake.projectName}
PROBLEM STATEMENT:
${intake.problemStatement}

FUNCTIONAL REQUIREMENTS:
${intake.functionalReqs}

REQUIRED LANGUAGES / STACK: ${intake.languages || "not specified"}
TARGET USERS: ${(grounding.targetUsers || []).join(", ") || "TBD"}
DOMAIN: ${grounding.domain}

LOCKED SYSTEM DESIGN DECISIONS:
${decisionRecords}

RESEARCH FINDINGS:
${partnerNotes}
`.trim();
}

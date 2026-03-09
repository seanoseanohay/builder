# Dynamic Research Pipeline Design

**Problem**

The current research step uses a fixed architecture checklist and a prompt-based company summary. It does not reliably discover missing system layers from the brief, and it does not ground recommendations in real partner context gathered from the company website or the broader web.

**Goals**

- Research the partner using the provided website first, then external web search when the site is thin.
- Infer required and optional architecture layers from the problem statement, requirements, and partner context.
- Generate 3-5 alternatives for every discovered section, not just a fixed list.
- Feed partner context and discovered sections into PRD and plan generation.
- Preserve the current wizard flow and interactive section review UX where possible.

**Recommended Approach**

Use a hybrid dynamic research pipeline.

1. Add a server-side partner research route that fetches the company website, attempts a small allowlist of likely pages, and falls back to web search when needed.
2. Normalize that result into structured partner context.
3. Add a section-discovery pass that combines the intake plus partner context to decide which architecture sections are core, required, and optional.
4. Reuse the existing section-analysis UX, but drive it from discovered sections instead of the hardcoded list alone.
5. Thread the partner context and discovered sections into PRD and execution-plan generation.

**Architecture**

The app should separate "research" into three phases:

1. Partner research
2. Architecture discovery
3. Per-section alternatives

The partner research phase produces a structured company context object rather than a freeform string only. The architecture discovery phase decides what layers the project needs. The per-section phase generates alternatives and recommendations for each discovered section.

**Data Model Changes**

- Extend brief state to include structured partner research, not just `companyProfile`.
- Extend research state to track discovered sections and their metadata.
- Keep per-section option analysis in the existing SDS-like state, but support dynamic sections.

**Partner Research Sources**

- Primary: provided company website
- Secondary: external web search if website content is incomplete
- Fallback: intake-only inference if both are weak

**Discovered Section Model**

Each section should include:

- stable id
- title
- subtitle
- why it matters for this project
- category: core or dynamic
- priority: required or optional

Core sections can stay available for consistency, but the UI should surface dynamic sections such as payments, notifications, analytics, file storage, search, admin, reporting, observability, workflows, RAG/vector, integrations, mobile, and multi-tenant/org management when relevant.

**User Experience**

The Research step should show:

- Partner context summary
- What sources were used
- Inferred project context
- Required layers
- Optional layers
- Alternatives per section

This keeps the workflow transparent and shows the user that the app is grounding recommendations in real partner context, not generic assumptions.

**Testing Strategy**

- Add a lightweight test runner and write failing tests first.
- Test partner research parsing and fallback behavior.
- Test section-discovery parsing and normalization.
- Test helper functions that merge core sections with dynamic sections.
- Run lint and build before claiming completion.

**Constraints**

- Keep implementation incremental; avoid a full app rewrite.
- Preserve current export, PRD, and execution-plan UX.
- Maintain streaming where already added.

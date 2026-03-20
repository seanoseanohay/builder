export const SD_SECTIONS = [
  {
    id: "frontend",
    icon: "🖥️",
    label: "Frontend",
    sub: "Framework · UI library · State management",
  },
  {
    id: "backend",
    icon: "⚙️",
    label: "Backend",
    sub: "Runtime · Framework · API style",
  },
  {
    id: "database",
    icon: "🗄️",
    label: "Database",
    sub: "Primary store · Schema approach",
  },
  {
    id: "hosting",
    icon: "☁️",
    label: "Hosting & Infra",
    sub: "Cloud provider · Deployment · CI/CD",
  },
  {
    id: "llm",
    icon: "🤖",
    label: "AI / LLM Layer",
    sub: "Model · Provider · Integration pattern",
  },
  {
    id: "caching",
    icon: "⚡",
    label: "Caching & Queues",
    sub: "Cache strategy · Message queue · Real-time",
  },
  {
    id: "auth",
    icon: "🔐",
    label: "Auth & Security",
    sub: "Auth provider · Permissions · Compliance",
  },
  {
    id: "competitive",
    icon: "🏁",
    label: "Competitive & Risk",
    sub: "Market landscape · Alternatives · Key risks",
  },
] as const;

export type SectionId = (typeof SD_SECTIONS)[number]["id"];

/** When the SDS proposer lists options, keep them architecturally distinct so consensus can succeed. */
const DISTINCT_OPTIONS = ` When proposing concrete options (A–D etc.), each must represent a different architectural tradeoff—not minor framework or library variants. Prefer generalizable choices over overfitting to the brief.`;

export const SECTION_PROMPTS: Record<SectionId, string> = {
  frontend: `Perform a FRONTEND architecture analysis. Evaluate options on: rendering model (CSR/SSR/SSG/ISR), bundle size and parse time implications, component model and reactivity approach, hydration cost, state management patterns (flux/signals/context), build toolchain performance, and fit with the data access patterns this app needs. Defend recommendations on technical merit.${DISTINCT_OPTIONS}`,

  backend: `Perform a BACKEND architecture analysis. Evaluate options on: concurrency model (event loop vs thread-based vs coroutines), request throughput and latency profile, cold start characteristics if serverless, type system and runtime safety, connection pooling behavior, middleware ecosystem maturity, and how well the API style (REST/GraphQL/tRPC/RPC) fits the client consumption patterns of this specific project.${DISTINCT_OPTIONS}`,

  database: `Perform a DATABASE architecture analysis. Evaluate options on: ACID compliance and transaction isolation levels, consistency model (strong vs eventual), read/write access patterns this project requires, query complexity and join support, indexing capabilities, storage engine characteristics, connection overhead, schema flexibility vs enforcement tradeoffs, and horizontal vs vertical scaling ceiling.${DISTINCT_OPTIONS}`,

  hosting: `Perform a HOSTING & INFRASTRUCTURE analysis. Evaluate options on: cold start latency vs always-on costs, geographic distribution and edge capabilities, container orchestration overhead, CI/CD pipeline integration, environment parity between dev/staging/prod, auto-scaling behavior under load spikes, egress costs, managed service tradeoffs vs operational control, and vendor lock-in risk.${DISTINCT_OPTIONS}`,

  llm: `Perform an AI/LLM LAYER architecture analysis. Evaluate options on: context window size and its implications for this use case, token throughput and latency (p50/p95), streaming support, function/tool calling reliability, fine-tuning availability, rate limits at production scale, cost per token at expected volume, fallback and retry patterns, and whether RAG, embeddings, or fine-tuning is the right approach for the problem.${DISTINCT_OPTIONS}`,

  caching: `Perform a CACHING & MESSAGING architecture analysis. Evaluate options on: cache invalidation strategy (TTL vs event-driven vs write-through), data structure support (strings vs hashes vs sorted sets), pub/sub vs queue semantics, at-least-once vs exactly-once delivery guarantees, persistence options, memory footprint, and whether the system actually needs async messaging or if synchronous is sufficient given the load profile.${DISTINCT_OPTIONS}`,

  auth: `Perform an AUTH & SECURITY architecture analysis. Evaluate options on: token type (JWT vs opaque vs session), signing algorithm security (RS256 vs HS256), token refresh flow, session storage attack surface, OAuth2/OIDC flow suitability for the client types involved, RBAC vs ABAC for the permission model required, data residency and compliance implications (COPPA, FERPA, GDPR depending on domain), and credential storage patterns.${DISTINCT_OPTIONS}`,

  competitive: `Perform a COMPETITIVE LANDSCAPE and RISK analysis. For competitors: evaluate feature parity gaps, architectural approaches they've taken and why, their moat, and where this project can differentiate technically. For risks: evaluate technical debt risks, integration failure modes, scalability cliff risks, third-party dependency risks, and security surface area. Prioritize by likelihood × impact.${DISTINCT_OPTIONS}`,
};

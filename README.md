# Project Kickstarter

A 6-step wizard that turns a project brief into Cursor-ready docs using Claude: **Brief → Proposing layers → Research → PRD → Plan → Export**.

- **Step 1 — Brief**: Intake form (company, project name, problem statement, functional requirements, stack). Optional “Preview Inferred Details”; then “Run Research & Continue”.
- **Step 2 — Proposing layers**: Review recommended layers and _why_ each is needed. Remove layers you don’t need, add any that are missing, then “Continue to Research”.
- **Step 3 — Research**: System Design Review: Claude recommends options per layer. Pick an option, use “E: None of the above” to enter your own (Claude rewrites it), chat, and “Lock Decision”. You can add more layers here too.
- **Step 4 — PRD**: Full Product Requirements Document from the brief and locked decisions.
- **Step 5 — Plan**: Phased execution plan (PLAN.md) plus 6 memory-bank files (projectbrief, productContext, systemPatterns, techContext, activeContext, progress).
- **Step 6 — Export**: Setup instructions and “Download All Files” (each file downloads separately).

Session is persisted in the browser (localStorage) so you can resume later.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

**API key:** You can either set `ANTHROPIC_API_KEY` in `.env.local` (so you never type it in the app), or leave it unset and **add your key in the app** (header: “Add your Anthropic API key”). The in-app key is stored only in that browser tab (sessionStorage) and is sent with each request. Do not commit `.env.local` or any file with real keys—`.env*` is gitignored.

## Deploy on Vercel (safe for demos)

1. Push this repo to GitHub (or connect your Git provider in Vercel).
2. In Vercel: **New Project** → import this repo.
3. **Do not set** `ANTHROPIC_API_KEY` if you want a “bring your own key” demo. Users will see “Add your Anthropic API key” in the header and paste their own key (stored only in their session).
4. Optionally set `ANTHROPIC_API_KEY` in **Settings → Environment Variables** for a private deployment where you don’t need to enter a key in the UI.
5. Deploy. The `/api/claude` route uses the key from the request (user’s key) when present, otherwise the server env key.

## Pipeline (OpenRouter)

The **Pipeline** (`/pipeline`) runs a document → build flow with limited human-in-the-loop:

1. **Input:** Plan, Requirements, PRD, Research (four text blobs).
2. **Refiner:** Improves docs using your refiner instructions; asks clarification questions. Each question is sent to 3–5 models via OpenRouter; if consensus is above the threshold (slider, default 80%), the system auto-picks; otherwise it asks a human.
3. **Projgen:** Turns refined docs into repo docs (requirements.md, scope, phases, architecture, etc.) with the same consensus behavior.
4. **Builder:** Writes repo docs to a workspace and runs **Claude Code** headless (`claude -p "..."`) to scaffold and build. Requires Claude CLI installed on the server.

**API key:** Set `OPENROUTER_API_KEY` in `.env.local` or enter it on the Pipeline page (stored in localStorage). One key for all models (Claude, GPT, etc.) via OpenRouter.

## Tech

- **Next.js 14** (App Router)
- **React** for the wizard UI
- **API route** `app/api/claude/route.ts` calls the Anthropic Messages API with `ANTHROPIC_API_KEY`
- **API route** `app/api/openrouter/route.ts` proxies OpenRouter for the pipeline
- **Pipeline** uses `prompts/refiner.md`, `prompts/projgen.md`, and structured output parsing in `lib/parse-structured.ts`

No database; state lives in React state and localStorage.

## Trust and transparency

When users enter their own API key:

- The key is stored only in the browser (sessionStorage, this tab).
- The server receives it only to forward each request to Anthropic; it is not written to disk, logs, or any database.
- You can verify this in the source: `app/api/claude/route.ts` (no logging or storage of the key).

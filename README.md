# Project Kickstarter

A 5-step wizard that turns a project brief into Cursor-ready docs using Claude: **Brief → Research → PRD → Execution Plan → Drop-in files**.

- **Step 1 — Brief**: Intake form (company, project name, problem statement, functional requirements, stack). Optional “Preview Inferred Details”; then “Run Research & Continue”.
- **Step 2 — Research**: System Design Review: 8 sections (Frontend, Backend, Database, Hosting, LLM, Caching, Auth, Competitive). Claude recommends options per section; you can chat, pick an option, and “Lock Decision” to generate a Decision Record.
- **Step 3 — PRD**: Full Product Requirements Document from the brief and locked decisions.
- **Step 4 — Plan**: Phased execution plan (PLAN.md) plus 6 memory-bank files (projectbrief, productContext, systemPatterns, techContext, activeContext, progress).
- **Step 5 — Export**: Setup instructions and “Download All Files” (each file downloads separately).

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

## Tech

- **Next.js 14** (App Router)
- **React** for the wizard UI
- **API route** `app/api/claude/route.ts` calls the Anthropic Messages API with `ANTHROPIC_API_KEY`

No database; state lives in React state and localStorage.

## Trust and transparency

When users enter their own API key:

- The key is stored only in the browser (sessionStorage, this tab).
- The server receives it only to forward each request to Anthropic; it is not written to disk, logs, or any database.
- You can verify this in the source: `app/api/claude/route.ts` (no logging or storage of the key).

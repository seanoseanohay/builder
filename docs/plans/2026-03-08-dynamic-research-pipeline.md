# Dynamic Research Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add real partner research, dynamic architecture-layer discovery, and per-layer alternatives grounded in company context.

**Architecture:** Introduce a server-side research pipeline that gathers company context from the website and fallback web search, normalize it into structured partner data, discover required and optional architecture sections from that context plus the brief, and reuse the current interactive section-analysis UI for both core and dynamic sections.

**Tech Stack:** Next.js App Router, TypeScript, Anthropic proxy route, lightweight test runner, fetch-based research helpers.

---

### Task 1: Add test harness

**Files:**

- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/research-helpers.test.ts`

**Step 1: Write the failing test**

Add tests for:

- normalizing dynamic sections from raw model output
- merging core and dynamic sections without duplicates
- preferring website sources over fallback search metadata

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL because test runner/config/helpers do not exist yet.

**Step 3: Write minimal implementation**

Install and configure a minimal test runner and create helper stubs needed for the failing tests.

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS for the new helper tests.

### Task 2: Introduce research types and helper library

**Files:**

- Modify: `lib/types.ts`
- Create: `lib/research.ts`
- Test: `tests/research-helpers.test.ts`

**Step 1: Write the failing test**

Add tests covering:

- normalized partner context shape
- dynamic section normalization
- fallback source handling

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL because the new types/helpers do not exist or return the wrong shape.

**Step 3: Write minimal implementation**

Add:

- partner research types
- discovered section types
- helper functions to sanitize, normalize, and merge discovered sections

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

### Task 3: Add partner research API route

**Files:**

- Create: `app/api/research/route.ts`
- Modify: `lib/research.ts`
- Test: `tests/research-helpers.test.ts`

**Step 1: Write the failing test**

Add tests for the pure parsing/normalization helpers used by the route.

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL because the parser/fallback logic is incomplete.

**Step 3: Write minimal implementation**

Create a route that:

- fetches the provided site and a small set of likely subpages
- extracts readable text
- optionally uses web search when website content is weak
- asks Claude to return structured partner context and discovered sections JSON

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS for helper coverage.

### Task 4: Wire the page to the new research pipeline

**Files:**

- Modify: `app/page.tsx`
- Modify: `lib/types.ts`

**Step 1: Write the failing test**

Use targeted helper tests for any extracted page logic that can be tested outside React, especially dynamic-section merging.

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL for new helper behavior.

**Step 3: Write minimal implementation**

Update the page to:

- request partner research from the new API route
- store structured partner context
- render partner research results
- render dynamic required/optional sections
- analyze all discovered sections instead of the fixed list only

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

### Task 5: Ground PRD and plan generation in partner context

**Files:**

- Modify: `app/page.tsx`
- Modify: `lib/types.ts`

**Step 1: Write the failing test**

Add tests for prompt helper functions if extracted; otherwise add helper-level tests for formatting structured partner context into prompts.

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL because prompt formatting helpers are missing.

**Step 3: Write minimal implementation**

Use structured partner context and discovered sections in:

- PRD generation prompt
- execution plan prompt
- memory-bank prompt inputs

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

### Task 6: Verify behavior end-to-end

**Files:**

- Modify: `app/page.tsx` if needed
- Modify: `app/globals.css` only if the new UI needs minimal styling

**Step 1: Write the failing test**

Only add tests if helper coverage reveals missing normalization behavior.

**Step 2: Run verification**

Run:

- `npm test`
- `npm run lint`
- `npm run build`

Expected:

- tests pass
- lint passes
- build succeeds

**Step 3: Fix any failures**

Make minimal follow-up changes until verification is clean.

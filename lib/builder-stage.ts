/**
 * Builder stage: write distilled docs to a workspace and run Claude Code (headless) to build.
 * Server-only. Requires Claude CLI installed (`claude -p "..."`).
 */
import { mkdtempSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import type { DistilledDocs } from "./pipeline-types";

const DOCS_SUBDIR_NAMES = new Set([
  "requirements.md", "scope.md", "phases.md", "architecture.md",
  "decisions.md", "system-map.md", "constraints.md",
]);

const BUILD_PROMPT = `Using the documentation in this directory (requirements.md, scope.md, phases.md, architecture.md, decisions.md, system-map.md, constraints.md, AGENTS.md, README.md), scaffold and build this project.

1. Create the project structure (package.json or equivalent, source files, config).
2. Run install (e.g. npm install).
3. Run build (e.g. npm run build) if the project defines one.
4. Run tests (e.g. npm test) if the project defines one.

Work in this directory. Output a brief summary of what you created and any commands you ran.`;

export interface BuilderResult {
  success: boolean;
  workspacePath: string;
  summary?: string;
  error?: string;
}

/**
 * Write repo docs to a workspace. Files like "docs/requirements.md" go in workspace/docs/requirements.md.
 */
function writeDistilledDocs(workspacePath: string, docs: DistilledDocs): void {
  const docsDir = join(workspacePath, "docs");
  if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });
  for (const f of docs) {
    const isInDocs = DOCS_SUBDIR_NAMES.has(f.name);
    const filePath = isInDocs ? join(docsDir, f.name) : join(workspacePath, f.name);
    const parent = join(filePath, "..");
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    writeFileSync(filePath, f.content, "utf8");
  }
}

/**
 * Run Claude Code headless. Expects `claude` on PATH (Claude CLI).
 */
export async function runBuilderStage(params: {
  distilledDocs: DistilledDocs;
}): Promise<BuilderResult> {
  const { distilledDocs } = params;
  const workspacePath = mkdtempSync(join(tmpdir(), "builder-"));

  try {
    writeDistilledDocs(workspacePath, distilledDocs);

    execSync(`claude -p "${BUILD_PROMPT.replace(/"/g, '\\"')}"`, {
      cwd: workspacePath,
      stdio: "pipe",
      timeout: 300_000,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      workspacePath,
      error: message,
    };
  }

  return {
    success: true,
    workspacePath,
    summary: "Build completed. See workspace for generated project.",
  };
}

/**
 * List files in the workspace (for manifest). Recursive, relative paths.
 */
export function listWorkspaceFiles(workspacePath: string): string[] {
  const out: string[] = [];
  function walk(dir: string, prefix: string) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        walk(join(dir, e.name), rel);
      } else {
        out.push(rel);
      }
    }
  }
  walk(workspacePath, "");
  return out;
}

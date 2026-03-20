import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const PROD_DIRS = ["app", "lib"] as const;
const ROOT = path.resolve(path.dirname(__dirname));

const MAX_ANY_TYPE = 0;
const MAX_AS_UNKNOWN_AS = 0;
const MAX_TS_SUPPRESS = 0;
const MAX_VOID_DISPATCH = 0;
const MAX_JSON_PARSE = 6;
const MAX_CONSOLE = 4;

interface SourceFile {
  filePath: string;
  lines: string[];
}

function collectSourceFiles(): SourceFile[] {
  const results: SourceFile[] = [];
  for (const dir of PROD_DIRS) {
    const fullDir = path.join(ROOT, dir);
    if (!fs.existsSync(fullDir)) continue;
    const walk = (d: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const fullPath = path.join(d, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx"))
          continue;
        if (
          entry.name.endsWith("_test.ts") ||
          entry.name.endsWith(".test.ts") ||
          entry.name.endsWith(".spec.ts")
        )
          continue;
        results.push({
          filePath: fullPath,
          lines: fs.readFileSync(fullPath, "utf8").split("\n"),
        });
      }
    };
    walk(fullDir);
  }
  return results;
}

function countMatches(files: SourceFile[], pattern: string | RegExp): number {
  if (typeof pattern === "string") {
    return files.reduce(
      (total, file) =>
        total + file.lines.filter((line) => line.includes(pattern)).length,
      0,
    );
  }
  return files.reduce(
    (total, file) =>
      total + file.lines.filter((line) => pattern.test(line)).length,
    0,
  );
}

const files = collectSourceFiles();

describe("hygiene ratchet", () => {
  it(": any budget", () => {
    const count = countMatches(files, ": any");
    expect(count).toBeLessThanOrEqual(MAX_ANY_TYPE);
  });

  it("as unknown as budget", () => {
    const count = countMatches(files, "as unknown as");
    expect(count).toBeLessThanOrEqual(MAX_AS_UNKNOWN_AS);
  });

  it("@ts- suppress budget", () => {
    const count = countMatches(files, "@ts-");
    expect(count).toBeLessThanOrEqual(MAX_TS_SUPPRESS);
  });

  it("void fire-and-forget budget", () => {
    const count = files.reduce(
      (total, file) =>
        total +
        file.lines.filter(
          (line) => /\bvoid\s+/.test(line) && !/: void/.test(line),
        ).length,
      0,
    );
    expect(count).toBeLessThanOrEqual(MAX_VOID_DISPATCH);
  });

  it("JSON.parse budget", () => {
    const count = countMatches(files, "JSON.parse");
    expect(count).toBeLessThanOrEqual(MAX_JSON_PARSE);
  });

  it("console. budget", () => {
    const count = countMatches(files, "console.");
    expect(count).toBeLessThanOrEqual(MAX_CONSOLE);
  });
});

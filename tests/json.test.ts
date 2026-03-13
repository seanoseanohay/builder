import { describe, expect, it } from "vitest";
import { safeParseJSON } from "../lib/json";

describe("safeParseJSON", () => {
  it("parses valid JSON", () => {
    expect(safeParseJSON('{"a":1}')).toEqual({ a: 1 });
    expect(safeParseJSON("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("strips markdown code fences", () => {
    expect(
      safeParseJSON('```json\n{"x": "y"}\n```')
    ).toEqual({ x: "y" });
  });

  it("throws when no JSON object/array found", () => {
    expect(() => safeParseJSON("plain text")).toThrow("No JSON found in response");
  });

  it("repairs truncated JSON missing closing braces", () => {
    const truncated = '{"a": 1, "b": {"c": 3}';
    const result = safeParseJSON<{ a: number }>(truncated);
    expect(result).toEqual({ a: 1 });
  });
});

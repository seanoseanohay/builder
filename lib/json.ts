/**
 * Parse JSON from Claude output: strip markdown code fences and attempt repair
 * if truncated (e.g. missing closing braces).
 */
export function safeParseJSON<T = unknown>(raw: string): T {
  let text = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  try {
    return JSON.parse(text) as T;
  } catch {
    // ignore
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1) throw new Error("No JSON found in response");
  text = text.slice(start, end + 1);
  try {
    return JSON.parse(text) as T;
  } catch {
    // Repair truncated JSON: walk backwards, drop incomplete items
  }
  let t = text;
  for (let i = 0; i < 20; i++) {
    const lc = t.lastIndexOf(",");
    const lb = t.lastIndexOf("{");
    const la = t.lastIndexOf("[");
    const cut = Math.max(lc, lb, la);
    if (cut === -1) break;
    const candidate = t.slice(0, cut);
    const closes =
      (candidate.match(/\{/g) || []).length -
      (candidate.match(/\}/g) || []).length;
    const acloses =
      (candidate.match(/\[/g) || []).length -
      (candidate.match(/\]/g) || []).length;
    const fixed =
      candidate +
      "]".repeat(Math.max(0, acloses)) +
      "}".repeat(Math.max(0, closes));
    try {
      return JSON.parse(fixed) as T;
    } catch {
      t = candidate;
    }
  }
  throw new Error("Could not repair JSON");
}

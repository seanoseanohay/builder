/**
 * Parse structured output from Refiner/Projgen: ---QUESTION--- or ---DOCUMENTS--- blocks.
 */

export interface ParsedQuestion {
  kind: "question";
  question: string;
  options: string[];
  recommendedIndex: number;
}

export interface ParsedDocuments {
  kind: "documents";
  files: Array<{ name: string; content: string }>;
}

export type ParsedOutput = ParsedQuestion | ParsedDocuments;

const QUESTION_START = "---QUESTION---";
const QUESTION_END = "---END---";
const OPTIONS_MARKER = "---OPTIONS---";
const RECOMMENDED_MARKER = "---RECOMMENDED---";
const DOCUMENTS_START = "---DOCUMENTS---";

function extractBlock(text: string, startTag: string, endTag: string): string | null {
  const start = text.indexOf(startTag);
  if (start === -1) return null;
  const afterStart = start + startTag.length;
  const end = text.indexOf(endTag, afterStart);
  if (end === -1) return null;
  return text.slice(afterStart, end).trim();
}

/** Parse ---OPTIONS--- section: lines like "A. text" and return options array. */
function parseOptions(block: string): string[] {
  const optStart = block.indexOf(OPTIONS_MARKER);
  const optEnd = block.indexOf(RECOMMENDED_MARKER);
  const optBlock =
    optEnd === -1
      ? block.slice(optStart + OPTIONS_MARKER.length)
      : block.slice(optStart + OPTIONS_MARKER.length, optEnd);
  const lines = optBlock
    .trim()
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const options: string[] = [];
  for (const line of lines) {
    const match = line.match(/^[A-Z]\.\s*(.+)$/);
    if (match) options.push(match[1].trim());
    else options.push(line);
  }
  return options;
}

/** Parse ---RECOMMENDED--- to get option index (0-based). A=0, B=1, ... */
function parseRecommended(block: string): number {
  const start = block.indexOf(RECOMMENDED_MARKER);
  if (start === -1) return 0;
  const after = block.slice(start + RECOMMENDED_MARKER.length).trim();
  const letter = after.split(/\s/)[0]?.trim().toUpperCase();
  if (!letter) return 0;
  const code = letter.charCodeAt(0);
  if (code >= 65 && code <= 90) return code - 65;
  return 0;
}

export function parseStructuredOutput(text: string): ParsedOutput | null {
  const trimmed = text.trim();

  const questionBlock = extractBlock(trimmed, QUESTION_START, QUESTION_END);
  if (questionBlock) {
    const optionsBlock = questionBlock.includes(OPTIONS_MARKER)
      ? questionBlock
      : "";
    const questionPart = optionsBlock
      ? questionBlock.slice(0, questionBlock.indexOf(OPTIONS_MARKER)).trim()
      : questionBlock;
    const question = questionPart.replace(/^---\w+---/g, "").trim();
    const options = parseOptions(questionBlock);
    const recommendedIndex = parseRecommended(questionBlock);
    return {
      kind: "question",
      question,
      options,
      recommendedIndex: Math.min(recommendedIndex, options.length - 1),
    };
  }

  const docsBlock = extractBlock(trimmed, DOCUMENTS_START, "---END---");
  if (docsBlock) {
    const files: Array<{ name: string; content: string }> = [];
    const fileRegex = /---([a-z0-9.-]+\.(?:md|txt))---/gi;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    const names: { name: string; start: number }[] = [];
    while ((match = fileRegex.exec(docsBlock)) !== null) {
      names.push({ name: match[1], start: match.index + match[0].length });
    }
    for (let i = 0; i < names.length; i++) {
      const start = names[i].start;
      const nextMarker = names[i + 1]
        ? docsBlock.indexOf("---" + names[i + 1].name + "---", start)
        : -1;
      const end = nextMarker >= 0 ? nextMarker : docsBlock.length;
      const content = docsBlock.slice(start, end).trim();
      files.push({ name: names[i].name, content });
    }
    if (files.length > 0) return { kind: "documents", files };
  }

  return null;
}

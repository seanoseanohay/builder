const API_GAP_MS = 1200;
const STORAGE_KEY = "anthropic-api-key";
let lastCall = 0;
const queue: Array<() => void> = [];
let draining = false;

function drain() {
  if (draining || queue.length === 0) return;
  const now = Date.now();
  const wait = Math.max(0, lastCall + API_GAP_MS - now);
  draining = true;
  setTimeout(() => {
    const fn = queue.shift();
    draining = false;
    if (fn) fn();
    drain();
  }, wait);
}

function getStoredApiKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function getStoredApiKeyIfSet(): string | null {
  return getStoredApiKey();
}

export function setStoredApiKey(key: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (key == null || key.trim() === "") {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, key.trim());
    }
  } catch {
    // ignore
  }
}

export function callClaude(
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const run = async () => {
      lastCall = Date.now();
      const apiKey = getStoredApiKey();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey) headers["X-Anthropic-API-Key"] = apiKey;
      const body: {
        systemPrompt: string;
        userPrompt: string;
        apiKey?: string;
      } = {
        systemPrompt,
        userPrompt,
      };
      if (apiKey) body.apiKey = apiKey;
      try {
        const res = await fetch("/api/claude", {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as { error?: string; text?: string };
        if (!res.ok) {
          const msg = data.error || `API error: ${res.status}`;
          reject(new Error(res.status === 401 ? "NO_API_KEY:" + msg : msg));
          return;
        }
        resolve(data.text ?? "");
      } catch (e) {
        reject(e);
      }
    };
    queue.push(() => {
      run();
    });
    drain();
  });
}

/** Stream Claude response; onChunk is called with each text delta; resolves with full text. */
export async function callClaudeStream(
  systemPrompt: string,
  userPrompt: string,
  onChunk: (chunk: string) => void,
): Promise<string> {
  const apiKey = getStoredApiKey();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers["X-Anthropic-API-Key"] = apiKey;
  const body: {
    systemPrompt: string;
    userPrompt: string;
    apiKey?: string;
    stream?: boolean;
  } = {
    systemPrompt,
    userPrompt,
    stream: true,
  };
  if (apiKey) body.apiKey = apiKey;

  const res = await fetch("/api/claude", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    const msg = data.error || `API error: ${res.status}`;
    throw new Error(res.status === 401 ? "NO_API_KEY:" + msg : msg);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const dataLine = event.split("\n").find((l) => l.startsWith("data: "));
      if (!dataLine) continue;
      try {
        const data = JSON.parse(dataLine.slice(6)) as {
          type?: string;
          delta?: { type?: string; text?: string };
        };
        if (
          data.type === "content_block_delta" &&
          data.delta?.type === "text_delta" &&
          data.delta.text
        ) {
          fullText += data.delta.text;
          onChunk(data.delta.text);
        }
      } catch {
        // skip unparseable lines
      }
    }
  }
  return fullText;
}

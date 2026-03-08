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
  userPrompt: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const run = async () => {
      lastCall = Date.now();
      const apiKey = getStoredApiKey();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers["X-Anthropic-API-Key"] = apiKey;
      const body: { systemPrompt: string; userPrompt: string; apiKey?: string } = {
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

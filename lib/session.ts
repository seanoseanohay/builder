import type { SavedSession } from "./types";

const SESSION_KEY = "kickstarter-session-v1";

export function saveSession(session: Omit<SavedSession, "savedAt">): void {
  try {
    const full: SavedSession = { ...session, savedAt: Date.now() };
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(full));
    }
  } catch (e) {
    console.warn("Save failed:", e);
  }
}

export function loadSession(): SavedSession | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedSession;
    if (!s.state?.brief?.intake?.company) return null;
    return s;
  } catch {
    return null;
  }
}

export function deleteSession(): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // ignore
  }
}

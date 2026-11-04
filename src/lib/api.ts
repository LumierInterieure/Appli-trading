import type { HistoryResponse, Quote, SearchResult } from "../../shared/types.ts";

export interface Status { demo: boolean; forcedDemo: boolean; ai: boolean }

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  status: () => json<Status>("/api/status"),
  history: (symbol: string, range: string, interval: string) =>
    json<HistoryResponse>(`/api/history?${new URLSearchParams({ symbol, range, interval })}`),
  quotes: (symbols: string[]) =>
    json<{ quotes: (Quote | { symbol: string; error: string })[]; demo: boolean }>(`/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`),
  search: (q: string) => json<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}`),
};

export interface AiEvent { type: "text" | "status" | "error" | "done"; text?: string; model?: string }

/** Analyse IA en streaming (Server-Sent Events via fetch). */
export async function streamAi(body: unknown, onEvent: (e: AiEvent) => void, signal: AbortSignal) {
  const res = await fetch("/api/ai/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (line) {
        try {
          onEvent(JSON.parse(line.slice(6)));
        } catch {
          /* fragment invalide */
        }
      }
    }
  }
}

import { useEffect, useMemo, useState } from "react";
import type { AssetDef, Bar, HistoryResponse, Quote } from "../../shared/types.ts";
import { api, type Status } from "./api.ts";

export function useStatus(pollMs = 30000) {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () => api.status().then((s) => alive && setStatus(s)).catch(() => alive && setStatus(null));
    tick();
    const id = setInterval(tick, pollMs);
    return () => { alive = false; clearInterval(id); };
  }, [pollMs]);
  return status;
}

/** Cotations : interrogation régulière du serveur + flux Binance temps réel pour la crypto. */
export function useQuotes(assets: AssetDef[], pollMs: number, demo: boolean) {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [lastUpdate, setLastUpdate] = useState<number>(0);
  const [wsLive, setWsLive] = useState(false);
  const key = assets.map((a) => a.symbol).join(",");

  useEffect(() => {
    let alive = true;
    const symbols = key.split(",").filter(Boolean);
    const tick = async () => {
      try {
        // par lots pour ne pas dépasser la longueur d'URL
        for (let i = 0; i < symbols.length; i += 40) {
          const { quotes: qs } = await api.quotes(symbols.slice(i, i + 40));
          if (!alive) return;
          setQuotes((prev) => {
            const next = { ...prev };
            for (const q of qs) if ("price" in q) {
              const cur = prev[q.symbol];
              // ne jamais remplacer une cotation réelle par une cotation simulée
              if (cur && !cur.demo && q.demo) continue;
              // ne pas écraser un prix temps réel plus récent (Binance)
              next[q.symbol] = cur && cur.time > q.time + 5 && !q.demo ? { ...q, price: cur.price, change: cur.price - q.previousClose, changePct: (cur.price / q.previousClose - 1) * 100, time: cur.time } : q;
            }
            return next;
          });
        }
        setLastUpdate(Date.now());
      } catch {
        /* réseau : on réessaiera */
      }
    };
    tick();
    const id = setInterval(tick, pollMs);
    return () => { alive = false; clearInterval(id); };
  }, [key, pollMs]);

  // Binance WebSocket (BTC, ETH, SOL...) : prix à la seconde.
  const streams = assets.filter((a) => a.binance).map((a) => ({ stream: `${a.binance}@miniTicker`, symbol: a.symbol }));
  const streamKey = streams.map((s) => s.stream).join("/");
  useEffect(() => {
    if (demo || !streamKey) return;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const map = new Map(streams.map((s) => [s.stream.split("@")[0].toUpperCase(), s.symbol]));
    const pending = new Map<string, { price: number; time: number }>();
    const flush = setInterval(() => {
      if (!pending.size) return;
      const batch = new Map(pending);
      pending.clear();
      setQuotes((prev) => {
        const next = { ...prev };
        for (const [sym, { price, time }] of batch) {
          const q = prev[sym];
          if (!q) continue;
          next[sym] = { ...q, price, time, change: price - q.previousClose, changePct: (price / q.previousClose - 1) * 100 };
        }
        return next;
      });
    }, 1000);
    const connect = () => {
      try {
        ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streamKey}`);
      } catch {
        return;
      }
      ws.onopen = () => setWsLive(true);
      ws.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data).data;
          const sym = map.get(String(d.s));
          if (sym) pending.set(sym, { price: Number(d.c), time: Math.floor(Number(d.E) / 1000) });
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        setWsLive(false);
        if (!closed) retry = setTimeout(connect, 10000);
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      closed = true;
      clearInterval(flush);
      clearTimeout(retry);
      ws?.close();
      setWsLive(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamKey, demo]);

  return { quotes, lastUpdate, wsLive };
}

const memCache = new Map<string, { at: number; data: HistoryResponse }>();

export function refreshMs(interval: string) {
  if (interval.endsWith("m")) return 30_000;
  if (interval === "1d") return 120_000;
  return 600_000;
}

/** Historique d'un ou plusieurs symboles, rafraîchi périodiquement. */
export function useHistories(symbols: string[], range: string, interval: string) {
  // indexé par symbole|plage|intervalle : on ne renvoie jamais les données d'une autre période
  const [store, setStore] = useState<Record<string, HistoryResponse>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const key = `${symbols.join(",")}|${range}|${interval}`;

  useEffect(() => {
    let alive = true;
    const syms = symbols.slice();
    const load = async (force: boolean) => {
      setLoading(true);
      const results = await Promise.all(
        syms.map(async (s) => {
          const ck = `${s}|${range}|${interval}`;
          const hit = memCache.get(ck);
          if (!force && hit && Date.now() - hit.at < refreshMs(interval)) return [ck, s, hit.data, null] as const;
          try {
            const d = await api.history(s, range, interval);
            memCache.set(ck, { at: Date.now(), data: d });
            return [ck, s, d, null] as const;
          } catch (e) {
            return [ck, s, null, e instanceof Error ? e.message : "Erreur"] as const;
          }
        }),
      );
      if (!alive) return;
      setStore((prev) => {
        const next = { ...prev };
        for (const [ck, , d] of results) if (d) next[ck] = d;
        return next;
      });
      const errs: Record<string, string> = {};
      for (const [, s, , err] of results) if (err) errs[s] = err;
      setErrors(errs);
      setLoading(false);
    };
    load(false);
    const id = setInterval(() => load(true), refreshMs(interval));
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const data = useMemo(() => {
    const out: Record<string, HistoryResponse> = {};
    for (const s of symbols) {
      const d = store[`${s}|${range}|${interval}`];
      if (d) out[s] = d;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, key]);

  return { data, errors, loading };
}

/** Historique journalier long (5 ans) de tout l'univers, pour les performances et l'analyse. */
export function useUniverse(assets: AssetDef[], enabled: boolean) {
  const [bars, setBars] = useState<Record<string, Bar[]>>({});
  const [demo, setDemo] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const key = assets.map((a) => a.symbol).join(",");

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const syms = key.split(",").filter(Boolean);
    const run = async () => {
      setProgress({ done: 0, total: syms.length });
      let done = 0;
      let next = 0;
      let anyDemo = false;
      const worker = async () => {
        while (alive && next < syms.length) {
          const s = syms[next++];
          try {
            const ck = `${s}|5y|1d`;
            const hit = memCache.get(ck);
            const d = hit && Date.now() - hit.at < 300_000 ? hit.data : await api.history(s, "5y", "1d");
            memCache.set(ck, { at: Date.now(), data: d });
            anyDemo ||= d.demo;
            if (alive) setBars((prev) => ({ ...prev, [s]: d.bars }));
          } catch {
            /* actif ignoré */
          }
          done++;
          if (alive) setProgress({ done, total: syms.length });
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      if (alive) setDemo(anyDemo);
    };
    run();
    const id = setInterval(run, 10 * 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [key, enabled]);

  return { bars, demo, progress };
}

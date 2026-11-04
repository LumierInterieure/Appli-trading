import { useEffect, useMemo, useRef, useState } from "react";
import type { AssetDef } from "../../shared/types.ts";
import { type MarketReport, reportMarkdown, snapshotForAI } from "../lib/analysis.ts";
import { streamAi } from "../lib/api.ts";
import { renderMarkdown } from "../lib/markdown.ts";

export interface AnalyzeRequest {
  nonce: number;
  ai: boolean;
  focus: string[];
  question?: string;
}

interface Props {
  report: MarketReport | null;
  assets: AssetDef[];
  defaultFocus: string[];
  aiAvailable: boolean;
  loading: { done: number; total: number };
  request: AnalyzeRequest | null;
  onSelect: (id: string) => void;
}

interface Turn { role: "user" | "assistant"; content: string }

export function AnalysisPanel(p: Props) {
  const [focus, setFocus] = useState<string[]>(p.defaultFocus);
  const [localMd, setLocalMd] = useState<string | null>(null);
  const [aiText, setAiText] = useState("");
  const [aiStatus, setAiStatus] = useState("");
  const [aiError, setAiError] = useState("");
  const [busy, setBusy] = useState(false);
  const [web, setWeb] = useState(true);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const abort = useRef<AbortController | null>(null);
  const assetMap = useMemo(() => new Map(p.assets.map((a) => [a.id, a])), [p.assets]);

  useEffect(() => setFocus(p.defaultFocus), [p.defaultFocus.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const runLocal = (f = focus) => {
    if (!p.report) return;
    setLocalMd(reportMarkdown(p.report, assetMap, f));
  };

  const runAi = async (f = focus, q?: string, followUp = false) => {
    if (!p.report) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    setAiError("");
    setAiStatus("Connexion à Claude…");
    const ask = q?.trim() || "";
    const history = followUp ? [...turns] : [];
    if (!followUp) setTurns([]);
    let acc = "";
    setAiText("");
    try {
      await streamAi(
        { snapshot: snapshotForAI(p.report), focus: f.map((id) => assetMap.get(id)?.name ?? id), web, question: ask || undefined, history: history.length ? history : undefined },
        (e) => {
          if (e.type === "text" && e.text) { acc += e.text; setAiText(acc); }
          else if (e.type === "status") setAiStatus(e.text ?? "");
          else if (e.type === "error") setAiError(e.text ?? "Erreur");
        },
        ctrl.signal,
      );
      const userTurn = ask || "Analyse le marché à partir de cet instantané : régime, inter-marchés, actifs clés, scénarios et prévisions.";
      if (acc) setTurns([...history, { role: "user", content: userTurn }, { role: "assistant", content: acc }]);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) setAiError(`Serveur injoignable : ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
      setAiStatus("");
    }
  };

  // requêtes venant de la barre de commandes
  const lastNonce = useRef(0);
  useEffect(() => {
    const r = p.request;
    if (!r || r.nonce === lastNonce.current || !p.report) return;
    lastNonce.current = r.nonce;
    const f = r.focus.length ? r.focus : focus;
    if (r.focus.length) setFocus(r.focus);
    runLocal(f);
    if (r.ai) runAi(f, r.question);
  }, [p.request, p.report]); // eslint-disable-line react-hooks/exhaustive-deps

  const rep = p.report;
  const ready = rep && p.loading.done >= p.loading.total;
  const regimeColor = !rep ? "var(--muted)" : rep.regime.score >= 0.75 ? "var(--up)" : rep.regime.score <= -0.75 ? "var(--down)" : "#f7c948";

  return (
    <div className="panel-body analysis">
      <div className="panel-controls">
        <button className="btn primary" disabled={!rep} onClick={() => runLocal()}>Analyse instantanée</button>
        <button className="btn ai" disabled={!rep || busy} onClick={() => runAi()} title={p.aiAvailable ? "Analyse rédigée par Claude" : "Ajoutez ANTHROPIC_API_KEY dans .env côté serveur"}>
          ✦ Analyse IA (Claude){!p.aiAvailable ? " — clé requise" : ""}
        </button>
        {busy && <button className="btn ghost" onClick={() => abort.current?.abort()}>Stop</button>}
        <label className="chk" title="Claude consulte l'actualité récente pour contextualiser"><input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} /> Actualités web</label>
        <span className="tb-sep" />
        <span>Prévisions sur :</span>
        <div className="focus-chips">
          {p.assets.filter((a) => a.core || focus.includes(a.id)).map((a) => (
            <button key={a.id} className={`chip ${focus.includes(a.id) ? "on" : ""}`} onClick={() => setFocus((f) => (f.includes(a.id) ? f.filter((x) => x !== a.id) : [...f, a.id]))}>{a.short}</button>
          ))}
        </div>
        {!ready && <span className="muted">Données {p.loading.done}/{p.loading.total}…</span>}
      </div>
      <div className="analysis-grid">
        <div className="analysis-side">
          {rep && (
            <>
              <div className="regime" style={{ borderColor: regimeColor }}>
                <div className="regime-label" style={{ color: regimeColor }}>{rep.regime.label}</div>
                <div className="regime-bar"><i style={{ left: `${Math.max(0, Math.min(100, 50 + rep.regime.score * 10))}%` }} /></div>
                <div className="regime-scale"><span>Risk-off</span><span>Risk-on</span></div>
                <ul>{rep.regime.drivers.map((d, i) => <li key={i}>{d}</li>)}</ul>
              </div>
              <div className="signals">
                <div className="card-title">Signaux automatiques ({rep.signals.length})</div>
                {rep.signals.length === 0 && <p className="muted">Aucun signal marquant.</p>}
                {rep.signals.map((s, i) => (
                  <button key={i} className={`signal ${s.type}`} onClick={() => p.onSelect(s.assetId)}><b>{s.short}</b> {s.text}</button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="analysis-main">
          {(aiText || busy || aiError) && (
            <section className="ai-out">
              <div className="ai-head">✦ Analyse Claude {aiStatus && <span className="muted"> — {aiStatus}</span>}</div>
              {aiError && <p className="error">{aiError}</p>}
              <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(aiText) }} />
              {!busy && turns.length > 0 && (
                <form className="followup" onSubmit={(e) => { e.preventDefault(); if (question.trim()) { runAi(focus, question, true); setQuestion(""); } }}>
                  <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Question de suivi (ex. « et si la Fed baisse ses taux ? », « niveau d'achat sur BTC ? »)" />
                  <button className="btn">Envoyer</button>
                </form>
              )}
            </section>
          )}
          {localMd ? (
            <section className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(localMd) }} />
          ) : (
            !aiText && !busy && (
              <div className="pad muted">
                <p><b>Analyse instantanée</b> : diagnostic calculé localement (tendances, momentum, volatilité, corrélations, courbe des taux, régime risk-on/off) et prévisions statistiques à ~1 mois pour les actifs choisis.</p>
                <p><b>Analyse IA</b> : Claude rédige une lecture complète du marché à partir de ces chiffres (et de l'actualité si activée), avec scénarios et objectifs. Vous pouvez ensuite poser des questions de suivi.</p>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

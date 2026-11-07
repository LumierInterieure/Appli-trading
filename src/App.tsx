import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ASSETS, customAsset, TIMEFRAMES } from "../shared/assets.ts";
import type { AssetDef, Bar, SearchResult } from "../shared/types.ts";
import { AlertsPanel } from "./components/AlertsPanel.tsx";
import { type AnalyzeRequest, AnalysisPanel } from "./components/AnalysisPanel.tsx";
import { Chart, type Measure, type SeriesInput } from "./components/Chart.tsx";
import { CommandBar } from "./components/CommandBar.tsx";
import { CorrelationPanel } from "./components/CorrelationPanel.tsx";
import { PerformancePanel } from "./components/PerformancePanel.tsx";
import { Toolbar } from "./components/Toolbar.tsx";
import { ToolsPanel } from "./components/ToolsPanel.tsx";
import { Watchlist } from "./components/Watchlist.tsx";
import { buildReport, type UniverseEntry } from "./lib/analysis.ts";
import { type Action, parseCommand } from "./lib/commands.ts";
import type { Pt } from "./lib/drawings.ts";
import { fmtPct, fmtPrice } from "./lib/format.ts";
import { useHistories, useQuotes, useStatus, useUniverse } from "./lib/hooks.ts";
import {
  type Alert,
  type AlertEvent,
  BUILTIN_TEMPLATES,
  type ChartSettings,
  DEFAULT_SETTINGS,
  describeAlert,
  type IndicatorId,
  SERIES_COLORS,
  type Template,
} from "./lib/state.ts";
import { barAtOrAfter, closeAtOrBefore, isPlausibleLive, periodChange } from "./lib/stats.ts";
import { load, save } from "./lib/storage.ts";
import { runTools, TOOL_INFO, type ToolId } from "./lib/tools.ts";

type Tab = "tools" | "perf" | "corr" | "analysis" | "alerts";
const TABS: { id: Tab; label: string }[] = [
  { id: "tools", label: "Outils & niveaux" },
  { id: "perf", label: "Performances" },
  { id: "corr", label: "Corrélations" },
  { id: "analysis", label: "Analyse & prévisions" },
  { id: "alerts", label: "Alertes" },
];

function toRelative(bars: Bar[], base: number): Bar[] {
  if (!base) return bars;
  const f = (v: number) => (v / base - 1) * 100;
  return bars.map((b) => ({ time: b.time, open: f(b.open), high: f(b.high), low: f(b.low), close: f(b.close), volume: b.volume }));
}

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.6);
  } catch {
    /* audio indisponible */
  }
}

export function App() {
  // ------------------------------------------------------------------ état persistant
  const [custom, setCustom] = useState<AssetDef[]>(() => load("custom", [] as AssetDef[]));
  const [settings, setSettings] = useState<ChartSettings>(() => load("settings", DEFAULT_SETTINGS));
  const [userTemplates, setUserTemplates] = useState<Template[]>(() => load("templates", [] as Template[]));
  const [alerts, setAlerts] = useState<Alert[]>(() => load("alerts", [] as Alert[]));
  const [events, setEvents] = useState<AlertEvent[]>(() => load("events", [] as AlertEvent[]));
  const [tab, setTab] = useState<Tab>(() => load("tab", "tools" as Tab));
  const [panelOpen, setPanelOpen] = useState(() => load("panelOpen", true));
  const [panelHeight, setPanelHeight] = useState(() => load("panelHeight", 330));
  useEffect(() => save("panelHeight", panelHeight), [panelHeight]);
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => setPanelHeight(Math.max(140, Math.min(window.innerHeight - 260, window.innerHeight - ev.clientY)));
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  useEffect(() => save("custom", custom), [custom]);
  useEffect(() => save("settings", settings), [settings]);
  useEffect(() => save("templates", userTemplates), [userTemplates]);
  useEffect(() => save("alerts", alerts), [alerts]);
  useEffect(() => save("events", events.slice(0, 100)), [events]);
  useEffect(() => save("tab", tab), [tab]);
  useEffect(() => save("panelOpen", panelOpen), [panelOpen]);

  // ------------------------------------------------------------------ état de session
  const [measures, setMeasures] = useState<Measure[]>([]);
  const [pending, setPending] = useState<Pt | null>(null);
  const [interaction, setInteraction] = useState<"none" | "measure" | "rebase">("none");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [analyzeReq, setAnalyzeReq] = useState<AnalyzeRequest | null>(null);

  const assets = useMemo(() => [...ASSETS, ...custom], [custom]);
  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const main = byId.get(settings.mainId) ?? ASSETS[1];
  const overlayAssets = settings.overlays.map((id) => byId.get(id)).filter((a): a is AssetDef => !!a && a.id !== main.id);
  const tf = TIMEFRAMES.find((x) => x.id === settings.timeframe) ?? TIMEFRAMES[6];

  const update = useCallback((patch: Partial<ChartSettings>) => setSettings((s) => ({ ...s, ...patch })), []);

  // ------------------------------------------------------------------ données
  const status = useStatus();
  const { quotes, lastUpdate, wsLive } = useQuotes(assets, 15000, status?.demo ?? true);
  const symbols = [main.symbol, ...overlayAssets.map((a) => a.symbol)];
  const hist = useHistories(symbols, tf.range, tf.interval);
  const universe = useUniverse(assets, true);

  const colors = useMemo(() => {
    const c: Record<string, string> = { [main.id]: SERIES_COLORS[0] };
    overlayAssets.forEach((a, i) => (c[a.id] = SERIES_COLORS[(i + 1) % SERIES_COLORS.length]));
    return c;
  }, [main.id, overlayAssets.map((a) => a.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------ séries affichées
  const relative = settings.mode === "relative";
  const mainRaw = hist.data[main.symbol]?.bars;
  const baseTime = useMemo(() => {
    if (!mainRaw?.length) return null;
    if (settings.rebaseTime) return (barAtOrAfter(mainRaw, settings.rebaseTime) ?? mainRaw[0]).time;
    return mainRaw[0].time;
  }, [mainRaw, settings.rebaseTime]);

  const fmtFor = useCallback((a: AssetDef) => (v: number) => fmtPrice(v, a), []);

  const mainInput: SeriesInput | null = useMemo(() => {
    if (!mainRaw?.length || baseTime == null) return null;
    const base = closeAtOrBefore(mainRaw, baseTime)?.close ?? mainRaw[0].close;
    return { key: main.id, label: main.short, color: SERIES_COLORS[0], raw: mainRaw, display: relative ? toRelative(mainRaw, base) : mainRaw, fmtRaw: fmtFor(main) };
  }, [mainRaw, baseTime, relative, main, fmtFor]);

  const overlayInputs: SeriesInput[] = useMemo(() => {
    if (baseTime == null) return [];
    return overlayAssets
      .map((a) => {
        const raw = hist.data[a.symbol]?.bars;
        if (!raw?.length) return null;
        const baseBar = closeAtOrBefore(raw, baseTime) ?? barAtOrAfter(raw, baseTime) ?? raw[0];
        return { key: a.id, label: a.short, color: colors[a.id], raw, display: relative ? toRelative(raw, baseBar.close) : raw, fmtRaw: fmtFor(a) };
      })
      .filter((x): x is SeriesInput => x !== null);
  }, [overlayAssets.map((a) => a.id).join(), hist.data, baseTime, relative, colors, fmtFor]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prix temps réel appliqués à la dernière bougie : uniquement s'ils viennent de la même source que
  // l'historique (réel vs démo) et restent plausibles par rapport à la dernière clôture connue.
  const live = useMemo(() => {
    const out: Record<string, number | undefined> = {};
    for (const a of [main, ...overlayAssets]) {
      const q = quotes[a.symbol];
      const h = hist.data[a.symbol];
      const last = h?.bars[h.bars.length - 1];
      if (!q || !h || !last) continue;
      if (q.demo !== h.demo) continue;
      if (!isPlausibleLive(q.price, last, tf.barSeconds)) continue;
      out[a.id] = q.price;
    }
    return out;
  }, [quotes, hist.data, main, tf.barSeconds, overlayAssets.map((a) => a.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const valueFmt = useCallback((v: number) => (relative ? fmtPct(v) : fmtPrice(v, main)), [relative, main]);

  // ------------------------------------------------------------------ outils automatiques
  const toolOut = useMemo(() => {
    if (!mainInput) return { drawings: [], reports: [] };
    return runTools(settings.tools, {
      bars: mainInput.display,
      fmt: valueFmt,
      sensitivity: settings.sensitivity,
      barSeconds: tf.barSeconds,
      alwaysOpen: !!main.alwaysOpen,
      forecastHorizon: settings.forecastHorizon,
    });
  }, [mainInput, settings.tools, settings.sensitivity, settings.forecastHorizon, tf.barSeconds, main.alwaysOpen, valueFmt]);

  // ------------------------------------------------------------------ univers & analyse
  const universeEntries: UniverseEntry[] = useMemo(
    () => assets.filter((a) => universe.bars[a.symbol]?.length).map((a) => ({ asset: a, bars: universe.bars[a.symbol], quote: quotes[a.symbol], demo: universe.demo || quotes[a.symbol]?.demo })),
    [assets, universe.bars, universe.demo, quotes],
  );
  // le rapport est recalculé au plus toutes les 60 s (les cotations bougent en continu)
  const [reportTick, setReportTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setReportTick((x) => x + 1), 60000);
    return () => clearInterval(id);
  }, []);
  const report = useMemo(
    () => (universeEntries.length >= 3 ? buildReport(universeEntries) : null),
    [universe.bars, reportTick, universe.progress.done === universe.progress.total], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ------------------------------------------------------------------ alertes
  const armed = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const now = Date.now();
    const fired: AlertEvent[] = [];
    const nextAlerts = alerts.map((a) => {
      if (!a.active) return a;
      const asset = byId.get(a.assetId);
      const q = asset ? quotes[asset.symbol] : undefined;
      if (!asset || !q) return a;
      let hit = false;
      let detail = "";
      if (a.kind === "above") { hit = q.price >= a.value; detail = fmtPrice(q.price, asset); }
      else if (a.kind === "below") { hit = q.price <= a.value; detail = fmtPrice(q.price, asset); }
      else {
        const b = universe.bars[asset.symbol];
        const chg = b?.length ? periodChange(b, a.period ?? "1D", q.price, q.previousClose) : a.period === "1D" ? q.changePct : null;
        if (chg == null) return a;
        hit = a.kind === "changeUp" ? chg >= a.value : chg <= -a.value;
        detail = fmtPct(chg);
      }
      const wasArmed = armed.current[a.id] ?? true;
      armed.current[a.id] = !hit;
      if (!hit || !wasArmed) return a;
      fired.push({ id: `${a.id}-${now}`, alertId: a.id, time: now, text: `🔔 ${describeAlert(a, asset.short)} — actuel : ${detail}` });
      return { ...a, lastTriggered: now, active: a.repeat };
    });
    if (fired.length) {
      setAlerts(nextAlerts);
      setEvents((e) => [...fired, ...e].slice(0, 100));
      beep();
      setToast(fired.map((f) => f.text).join("\n"));
      for (const f of fired) {
        try {
          if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("Market Desk", { body: f.text });
        } catch {
          /* notifications indisponibles */
        }
      }
    }
  }, [quotes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(id);
  }, [toast]);

  // ------------------------------------------------------------------ actions
  const setMain = useCallback((id: string) => {
    setSettings((s) => ({ ...s, mainId: id, overlays: s.overlays.filter((o) => o !== id), rebaseTime: null }));
    setMeasures([]);
    setPending(null);
  }, []);
  const toggleOverlay = useCallback((id: string) => {
    setSettings((s) => (s.overlays.includes(id) ? { ...s, overlays: s.overlays.filter((o) => o !== id) } : { ...s, overlays: [...s.overlays, id] }));
  }, []);
  const toggleTool = useCallback((t: ToolId) => {
    setSettings((s) => ({ ...s, tools: s.tools.includes(t) ? s.tools.filter((x) => x !== t) : [...s.tools, t] }));
    setTab("tools");
    setPanelOpen(true);
  }, []);
  const toggleIndicator = useCallback((i: IndicatorId) => {
    setSettings((s) => ({ ...s, indicators: s.indicators.includes(i) ? s.indicators.filter((x) => x !== i) : [...s.indicators, i] }));
  }, []);
  const addAlert = useCallback((a: Omit<Alert, "id" | "createdAt">) => {
    const id = `al-${Date.now().toString(36)}`;
    armed.current[id] = true;
    setAlerts((xs) => [...xs, { ...a, id, createdAt: Date.now() }]);
  }, []);

  const onChartClick = useCallback(
    (p: Pt) => {
      if (interaction === "rebase") {
        update({ rebaseTime: p.time });
        setInteraction("none");
        return;
      }
      if (interaction === "measure") {
        if (!pending) setPending(p);
        else {
          setMeasures((m) => [...m, { id: `m-${Date.now()}`, a: pending.time <= p.time ? pending : p, b: pending.time <= p.time ? p : pending }]);
          setPending(null);
          setInteraction("none");
          setTab("tools");
          setPanelOpen(true);
        }
      }
    },
    [interaction, pending, update],
  );

  // les mesures sont exprimées dans l'unité affichée : on les efface si le mode change
  useEffect(() => { setMeasures([]); setPending(null); }, [settings.mode, settings.timeframe, settings.rebaseTime]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setInteraction("none"); setPending(null); }
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        document.querySelector<HTMLInputElement>(".cmd input")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const runActions = useCallback(
    (actions: Action[]) => {
      for (const a of actions) {
        switch (a.type) {
          case "setMain": setMain(a.id); break;
          case "setOverlays":
            setSettings((s) => ({ ...s, overlays: [...new Set([...(a.append ? s.overlays : []), ...a.ids])].filter((id) => id !== s.mainId) }));
            break;
          case "removeOverlays": setSettings((s) => ({ ...s, overlays: s.overlays.filter((o) => !a.ids.includes(o)) })); break;
          case "set": update(a.patch); break;
          case "toolOn": setSettings((s) => ({ ...s, tools: s.tools.includes(a.tool) ? s.tools : [...s.tools, a.tool] })); setTab("tools"); setPanelOpen(true); break;
          case "toolOff": setSettings((s) => ({ ...s, tools: s.tools.filter((x) => x !== a.tool) })); break;
          case "clearTools": update({ tools: [] }); setMeasures([]); break;
          case "indicatorOn": setSettings((s) => ({ ...s, indicators: s.indicators.includes(a.id) ? s.indicators : [...s.indicators, a.id] })); break;
          case "indicatorOff": setSettings((s) => ({ ...s, indicators: s.indicators.filter((x) => x !== a.id) })); break;
          case "alert": addAlert({ ...a.alert, active: true, repeat: false }); break;
          case "analyze": setTab("analysis"); setPanelOpen(true); setAnalyzeReq({ nonce: Date.now(), ai: a.ai, focus: a.focus, question: a.question }); break;
          case "openTab": setTab(a.tab as Tab); setPanelOpen(true); break;
        }
      }
    },
    [setMain, update, addAlert],
  );

  const runCommand = useCallback(
    (text: string) => {
      const { actions, summary } = parseCommand(text, assets, settings);
      if (!actions.length) {
        setFeedback(summary[0] ?? "Commande non comprise. Exemples : « extension de fibonacci sur btc », « compare nasdaq et dxy en relatif », « alerte btc sous 95000 ».");
      } else {
        runActions(actions);
        const pretty = summary.map((s) => s.replace(/[+−] (\w+)$/, (m, id) => m.replace(id, TOOL_INFO[id as ToolId]?.short ?? id)));
        setFeedback(`✓ ${pretty.join(" · ")}`);
      }
      setTimeout(() => setFeedback(null), 6000);
    },
    [assets, settings, runActions],
  );

  const templates = [...BUILTIN_TEMPLATES, ...userTemplates];
  const applyTemplate = (t: Template) => {
    update({ tools: t.tools, indicators: t.indicators, ...(t.mode ? { mode: t.mode } : {}), ...(t.chartType ? { chartType: t.chartType } : {}), ...(t.timeframe ? { timeframe: t.timeframe } : {}) });
    if (t.tools.length) { setTab("tools"); setPanelOpen(true); }
  };
  const saveTemplate = () => {
    const name = window.prompt("Nom du modèle (outils, indicateurs, mode et type de graphique actuels) :");
    if (!name) return;
    setUserTemplates((ts) => [...ts, { id: `u-${Date.now()}`, name, tools: settings.tools, indicators: settings.indicators, mode: settings.mode, chartType: settings.chartType, timeframe: settings.timeframe }]);
  };

  const addCustom = (r: SearchResult) => {
    const a = customAsset(r.symbol, r.name);
    setCustom((c) => (c.some((x) => x.symbol === a.symbol) || ASSETS.some((x) => x.symbol === a.symbol) ? c : [...c, a]));
    setMain(a.id);
  };

  const demo = status?.demo ?? false;
  const mainQuote = quotes[main.symbol];
  const histErr = hist.errors[main.symbol];
  const note = hist.data[main.symbol]?.note;

  return (
    <div className="app" style={{ gridTemplateRows: `52px minmax(0, 1fr) ${panelOpen ? panelHeight : 36}px` }}>
      <header className="topbar">
        <div className="brand">
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="7" fill="#131a26" /><path d="M5 22l7-7 5 5 10-11" stroke="#22c55e" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>Market Desk</span>
        </div>
        <div className={`status ${status == null ? "off" : demo ? "demo" : "live"}`} title={demo ? "Fournisseurs de données injoignables : données simulées" : "Données Yahoo Finance (≈ temps réel / léger différé selon la place), crypto via Binance"}>
          <i />{status == null ? "Serveur hors ligne" : demo ? "DÉMO (simulé)" : wsLive ? "LIVE · crypto temps réel" : "LIVE"}
          {lastUpdate > 0 && <span>{new Date(lastUpdate).toLocaleTimeString("fr-FR")}</span>}
        </div>
        <CommandBar onRun={runCommand} feedback={feedback} />
        <button className="btn ai" onClick={() => runActions([{ type: "analyze", ai: false, focus: [] }])}>Analyser le marché</button>
      </header>

      <Watchlist
        assets={assets}
        quotes={quotes}
        mainId={main.id}
        overlays={settings.overlays}
        colors={colors}
        onSelect={setMain}
        onToggleOverlay={toggleOverlay}
        onAddCustom={addCustom}
        onRemoveCustom={(id) => { setCustom((c) => c.filter((x) => x.id !== id)); setSettings((s) => ({ ...s, overlays: s.overlays.filter((o) => o !== id), mainId: s.mainId === id ? "spx" : s.mainId })); }}
      />

      <main className="center">
        <div className="chart-head">
          <div className="ch-title">
            <h1>{main.name}</h1>
            <span className="sym">{main.symbol === "@TOTAL3ES" ? "Indice reconstruit" : main.symbol}</span>
            <b className="px">{fmtPrice(mainQuote?.price, main)}</b>
            <span style={{ color: (mainQuote?.changePct ?? 0) >= 0 ? "var(--up)" : "var(--down)" }}>{fmtPct(mainQuote?.changePct)} aujourd'hui</span>
            {hist.loading && <span className="muted">chargement…</span>}
            {histErr && <span className="error">{histErr}</span>}
          </div>
          {note && <div className="muted small">{note}</div>}
        </div>
        <Toolbar
          settings={settings}
          update={update}
          toggleTool={toggleTool}
          toggleIndicator={toggleIndicator}
          interaction={interaction}
          setInteraction={(m) => { setInteraction(m); setPending(null); }}
          clearMeasures={() => setMeasures([])}
          hasMeasures={measures.length > 0}
          templates={templates}
          applyTemplate={applyTemplate}
          saveTemplate={saveTemplate}
          deleteTemplate={(id) => setUserTemplates((ts) => ts.filter((t) => t.id !== id))}
        />
        <Chart
          main={mainInput}
          overlays={overlayInputs}
          settings={settings}
          drawings={toolOut.drawings}
          measures={measures}
          pendingPoint={pending}
          live={live}
          interaction={interaction}
          onChartClick={onChartClick}
          onRemoveOverlay={toggleOverlay}
          onMakeMain={setMain}
          structureKey={`${main.id}|${settings.timeframe}|${settings.mode}|${settings.rebaseTime}`}
          barSeconds={tf.barSeconds}
          watermark={main.short}
        />
      </main>

      <section className="bottom">
        {panelOpen && <div className="resizer" onMouseDown={startResize} title="Glisser pour redimensionner" />}
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id && panelOpen ? "on" : ""} onClick={() => { setTab(t.id); setPanelOpen(true); }}>
              {t.label}
              {t.id === "tools" && toolOut.reports.length + measures.length > 0 && <em>{toolOut.reports.length + measures.length}</em>}
              {t.id === "alerts" && alerts.filter((a) => a.active).length > 0 && <em>{alerts.filter((a) => a.active).length}</em>}
              {t.id === "analysis" && report && report.signals.length > 0 && <em>{report.signals.length}</em>}
            </button>
          ))}
          <div className="tb-spacer" />
          <button className="collapse" onClick={() => setPanelOpen((o) => !o)} title={panelOpen ? "Réduire" : "Agrandir"}>{panelOpen ? "▾" : "▴"}</button>
        </nav>
        {panelOpen && (
          <div className="panel">
            {tab === "tools" && <ToolsPanel reports={toolOut.reports} measures={measures} relative={relative} fmt={valueFmt} barSeconds={tf.barSeconds} onRemoveMeasure={(id) => setMeasures((m) => m.filter((x) => x.id !== id))} />}
            {tab === "perf" && <PerformancePanel assets={assets} bars={universe.bars} quotes={quotes} progress={universe.progress} onSelect={setMain} onOverlay={(id) => id !== main.id && !settings.overlays.includes(id) && toggleOverlay(id)} />}
            {tab === "corr" && <CorrelationPanel assets={assets} bars={universe.bars} selected={[main.id, ...overlayAssets.map((a) => a.id)]} />}
            {tab === "analysis" && (
              <AnalysisPanel
                report={report}
                assets={assets}
                defaultFocus={[main.id, ...overlayAssets.map((a) => a.id)]}
                aiAvailable={!!status?.ai}
                loading={universe.progress}
                request={analyzeReq}
                onSelect={setMain}
              />
            )}
            {tab === "alerts" && (
              <AlertsPanel
                assets={assets}
                alerts={alerts}
                events={events}
                defaultAsset={main.id}
                onAdd={addAlert}
                onToggle={(id) => setAlerts((xs) => xs.map((a) => (a.id === id ? { ...a, active: !a.active } : a)))}
                onRemove={(id) => setAlerts((xs) => xs.filter((a) => a.id !== id))}
                onClearEvents={() => setEvents([])}
              />
            )}
          </div>
        )}
      </section>
      {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}
    </div>
  );
}

import type { AssetDef } from "../../shared/types.ts";
import { normalize } from "./format.ts";
import type { Alert, ChartSettings, IndicatorId } from "./state.ts";
import type { PerfPeriod } from "./stats.ts";
import type { ToolId } from "./tools.ts";
import { DRAW_TOOL_INFO, type DrawTool } from "./manual.ts";

/**
 * Barre de commandes en langage naturel (français/anglais).
 * Ex : « extension de fibonacci sur le bitcoin en 1 an »,
 *      « compare nasdaq, btc et dxy en relatif sur 6 mois »,
 *      « alerte si btc passe sous 95000 », « analyse le marché ».
 */
export type Action =
  | { type: "setMain"; id: string }
  | { type: "setOverlays"; ids: string[]; append: boolean }
  | { type: "removeOverlays"; ids: string[] }
  | { type: "set"; patch: Partial<ChartSettings> }
  | { type: "toolOn"; tool: ToolId }
  | { type: "toolOff"; tool: ToolId }
  | { type: "clearTools" }
  | { type: "indicatorOn"; id: IndicatorId }
  | { type: "indicatorOff"; id: IndicatorId }
  | { type: "analyze"; ai: boolean; focus: string[]; question?: string }
  | { type: "alert"; alert: Omit<Alert, "id" | "createdAt" | "active" | "repeat"> }
  | { type: "openTab"; tab: string }
  | { type: "drawTool"; tool: DrawTool }
  | { type: "clearDrawings" };

export interface ParseResult {
  actions: Action[];
  summary: string[];
}

const TIMEFRAME_WORDS: [RegExp, string][] = [
  [/\b(1|un)\s*(j|jour|day|d)\b|\baujourd'?hui\b|\bintraday\b/, "1D"],
  [/\b(5|cinq)\s*(j|jours|days|d)\b|\b(1|une)\s*semaine\b/, "5D"],
  [/\b(1|un)\s*(mois|m|month)\b/, "1M"],
  [/\b(3|trois)\s*(mois|m|months)\b|\btrimestre\b/, "3M"],
  [/\b(6|six)\s*(mois|m|months)\b|\bsemestre\b/, "6M"],
  [/\bytd\b|\bdepuis (le )?debut (de l'?annee|d'annee)\b/, "YTD"],
  [/\b(1|un)\s*(an|ans|annee|a|y|year)\b|\b12\s*mois\b/, "1Y"],
  [/\b(2|deux)\s*(ans|annees|a|y|years)\b/, "2Y"],
  [/\b(5|cinq)\s*(ans|annees|a|y|years)\b/, "5Y"],
  [/\b(10|dix)\s*(ans|annees|a|y|years)\b/, "10Y"],
  [/\bmax\b|\btout l'?historique\b/, "MAX"],
];

const PERIOD_WORDS: [RegExp, PerfPeriod][] = [
  [/(1|un)\s*(j|jour|day)|journee|aujourd/, "1D"],
  [/(1|une)\s*(s|sem|semaine|week)|7\s*j/, "1W"],
  [/(1|un)\s*(mois|m\b)/, "1M"],
  [/(3|trois)\s*mois/, "3M"],
  [/(6|six)\s*mois/, "6M"],
  [/ytd|debut d'?annee/, "YTD"],
  [/(1|un)\s*(an|annee)/, "1Y"],
];

const TOOL_WORDS: [RegExp, ToolId][] = [
  [/(extension|ext)s?( de| du)?( la)? fibo(nacci)?|fibo(nacci)?\s*ext(ension)?s?|\bextensions?\b|objectifs?( de)? fibo(nacci)?|\bcibles?\b/, "fibExtension"],
  [/(retracement|retrace)s?( de| du)?( la)? fibo(nacci)?|fibo(nacci)?\s*(retracement|retr)s?|\bretracements?\b|\bfibo(nacci)?\b/, "fibRetracement"],
  [/(ligne|droite)s? de tendance|trend\s*lines?|obliques?/, "trendlines"],
  [/supports?|resistances?|s\/r|niveaux? cles?/, "supportResistance"],
  [/canal|regression|channel/, "channel"],
  [/prevision|projection|forecast|monte[- ]?carlo|cone/, "forecast"],
  [/divergences?/, "divergences"],
  [/points? pivots?|pivot points?/, "pivotPoints"],
];

const INDICATOR_WORDS: [RegExp, IndicatorId][] = [
  [/\brsi\b/, "rsi"],
  [/\bmacd\b/, "macd"],
  [/bollinger/, "bollinger"],
  [/\b(mm|ma|sma|moyenne mobile)\s*20\b/, "sma20"],
  [/\b(mm|ma|sma|moyenne mobile)\s*50\b/, "sma50"],
  [/\b(mm|ma|sma|moyenne mobile)\s*200\b/, "sma200"],
  [/\bema\s*21?\b/, "ema21"],
  [/\bvolumes?\b/, "volume"],
];

const REMOVE = /\b(enleve|enlever|retire|retirer|supprime|supprimer|efface|effacer|cache|cacher|masque|masquer|desactive|sans|stop|remove|hide|off)\b/;
const COMPARE = /\b(compare|comparer|comparaison|superpose|superposer|ajoute|ajouter|avec|vs|versus|contre|et|overlay|add)\b/;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Repère les actifs cités, dans l'ordre d'apparition. */
export function findAssets(text: string, assets: AssetDef[]): { id: string; pos: number }[] {
  return scanAssets(text, assets).found;
}

function scanAssets(text: string, assets: AssetDef[]): { found: { id: string; pos: number }[]; masked: string } {
  const terms: { term: string; id: string }[] = [];
  for (const a of assets) {
    const set = new Set([a.short, a.symbol, a.id, ...(a.aliases ?? [])].map((x) => normalize(x)));
    for (const t of set) if (t.length >= 2) terms.push({ term: t, id: a.id });
  }
  terms.sort((x, y) => y.term.length - x.term.length);
  let masked = text;
  const found: { id: string; pos: number }[] = [];
  for (const { term, id } of terms) {
    const re = new RegExp(`(^|[^a-z0-9&^])${escapeRe(term)}(?=$|[^a-z0-9&])`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked))) {
      const pos = m.index + m[1].length;
      if (!found.some((f) => f.id === id)) found.push({ id, pos });
      masked = masked.slice(0, pos) + " ".repeat(term.length) + masked.slice(pos + term.length);
      re.lastIndex = pos + term.length;
    }
  }
  return { found: found.sort((a, b) => a.pos - b.pos), masked };
}

function parseNumber(s: string): number {
  return Number(s.replace(/\s/g, "").replace(/k$/i, "000").replace(",", "."));
}

export function parseCommand(input: string, assets: AssetDef[], settings: ChartSettings): ParseResult {
  const actions: Action[] = [];
  const summary: string[] = [];
  let text = normalize(input).replace(/[’']/g, "'").trim();
  if (!text) return { actions, summary };
  const nameOf = (id: string) => assets.find((a) => a.id === id)?.short ?? id;

  // --- Alertes
  if (/\b(alerte|alert|previens|previens-moi|notifie|avertis)\b/.test(text)) {
    const found = findAssets(text, assets);
    const assetId = found[0]?.id ?? settings.mainId;
    const num = /(-?\d[\d\s]*(?:[.,]\d+)?k?)\s*(%|pour ?cent)?/i.exec(text.replace(/\b(1|3|6|5|7|12)\s*(j|jour|jours|mois|semaine|semaines|an|ans|s|m)\b/g, ""));
    const isPct = /%|pour ?cent/.test(text) || /\b(baisse|chute|perd|recule|hausse|monte|gagne|prend|grimpe)\s+(de\s+)?\d/.test(text);
    if (num) {
      const value = Math.abs(parseNumber(num[1]));
      if (isPct) {
        const down = /baisse|chute|perd|recule|plonge|descend/.test(text);
        const period = PERIOD_WORDS.find(([re]) => re.test(text))?.[1] ?? "1D";
        actions.push({ type: "alert", alert: { assetId, kind: down ? "changeDown" : "changeUp", value, period } });
        summary.push(`Alerte : ${nameOf(assetId)} ${down ? "−" : "+"}${value} % sur ${period}`);
      } else {
        const below = /(sous|dessous|inferieur|moins de|casse|below|<|tombe)/.test(text);
        actions.push({ type: "alert", alert: { assetId, kind: below ? "below" : "above", value } });
        summary.push(`Alerte : ${nameOf(assetId)} ${below ? "<" : ">"} ${value.toLocaleString("fr-FR")}`);
      }
      actions.push({ type: "openTab", tab: "alerts" });
    } else summary.push("Alerte : précisez un niveau (ex. « alerte btc sous 95000 » ou « alerte si spx baisse de 3 % sur 1 semaine »).");
    return { actions, summary };
  }

  // --- Analyse
  const wantsAnalysis = /\b(analyse|analyser|analyze|prevois|que penses|comprendre|explique|diagnostic)\b/.test(text);
  const mentionsTool = TOOL_WORDS.some(([re]) => re.test(text));
  if (wantsAnalysis && (!mentionsTool || /\b(marche|marches|ia|claude)\b/.test(text))) {
    const ai = /\b(ia|ai|claude|intelligence|detaille|approfondi|actu|actualites|news)\b/.test(text);
    const focus = findAssets(text, assets).map((f) => f.id);
    actions.push({ type: "analyze", ai, focus, question: ai ? input : undefined });
    summary.push(`Analyse ${ai ? "IA (Claude)" : "locale"}${focus.length ? ` — focus : ${focus.map(nameOf).join(", ")}` : ""}`);
    return { actions, summary };
  }

  // --- Dessins à la main
  if (/\b(efface|effacer|supprime|supprimer|enleve|enlever)\b.*\b(dessins?|traces? manuels?)\b/.test(text)) {
    actions.push({ type: "clearDrawings" });
    summary.push("Dessins effacés");
    return { actions, summary };
  }
  if (/\b(a la main|manuel|manuelle|moi[- ]meme|dessine|dessiner)\b/.test(text)) {
    let tool: DrawTool | null = null;
    if (/horizontal/.test(text)) tool = "hline";
    else if (/(extension|ext)\b.*fibo|fibo\w*\s*ext/.test(text)) tool = "fibE";
    else if (/fibo|retracement/.test(text)) tool = "fibR";
    else if (/rectangle|zone de prix|boite/.test(text)) tool = "rect";
    else if (/regle|mesure/.test(text)) tool = "measure";
    else if (/ligne|droite|tendance|oblique/.test(text)) tool = "trend";
    if (tool) {
      actions.push({ type: "drawTool", tool });
      summary.push(`${DRAW_TOOL_INFO[tool].label} : cliquez sur le graphique`);
      return { actions, summary };
    }
  }
  // --- Zone d'analyse ciblée (« fibo extension en ciblant une zone »)
  const wantsZone = /\b(cible|cibler|ciblant|zone d'analyse|intervalle|sur une zone|periode precise)\b/.test(text);

  const removing = REMOVE.test(text);
  // Les actifs sont repérés d'abord pour que « taux 10 ans » ne soit pas lu comme une période.
  const scan = scanAssets(text, assets);
  const found = scan.found.map((f) => f.id);
  text = scan.masked;

  // --- Périodes
  for (const [re, tf] of TIMEFRAME_WORDS) {
    if (re.test(text)) {
      actions.push({ type: "set", patch: { timeframe: tf } });
      summary.push(`Période ${tf}`);
      text = text.replace(re, " ");
      break;
    }
  }

  // --- Modes d'affichage
  if (/\b(relatif|relative|pourcentage|en %|base 0|normalise)\b/.test(text)) { actions.push({ type: "set", patch: { mode: "relative" } }); summary.push("Mode relatif (%)"); }
  if (/\b(absolu|absolue|absolute|prix reel|valeur)\b/.test(text)) { actions.push({ type: "set", patch: { mode: "absolute" } }); summary.push("Mode absolu"); }
  if (/\b(log|logarithmique)\b/.test(text)) { actions.push({ type: "set", patch: { logScale: !removing } }); summary.push(`Échelle log ${removing ? "désactivée" : "activée"}`); }
  if (/\b(bougies?|chandeliers?|candles?)\b/.test(text)) { actions.push({ type: "set", patch: { chartType: "candles" } }); summary.push("Bougies"); }
  if (/\b(ligne|line)\b/.test(text) && !/ligne(s)? de tendance/.test(text)) { actions.push({ type: "set", patch: { chartType: "line" } }); summary.push("Ligne"); }
  if (/\b(aire|area)\b/.test(text)) { actions.push({ type: "set", patch: { chartType: "area" } }); summary.push("Aire"); }

  // --- Outils
  if (/\b(tout effacer|efface tout|clear all|reset|reinitialise|nettoie)\b/.test(text)) {
    actions.push({ type: "clearTools" });
    summary.push("Outils effacés");
  } else {
    let toolText = text;
    for (const [re, tool] of TOOL_WORDS) {
      if (re.test(toolText)) {
        actions.push({ type: removing ? "toolOff" : "toolOn", tool });
        summary.push(`${removing ? "−" : "+"} ${tool}`);
        toolText = toolText.replace(re, " ");
      }
    }
    if (/sensibilite (fine|elevee|haute)|plus de pivots|micro/.test(text)) actions.push({ type: "set", patch: { sensitivity: "fine" } });
    if (/sensibilite (large|faible|basse)|moins de pivots|majeur/.test(text)) actions.push({ type: "set", patch: { sensitivity: "large" } });
  }
  for (const [re, id] of INDICATOR_WORDS) {
    if (re.test(text)) {
      actions.push({ type: removing ? "indicatorOff" : "indicatorOn", id });
      summary.push(`${removing ? "−" : "+"} ${id}`);
    }
  }

  // --- Actifs
  if (found.length) {
    if (removing && !actions.some((a) => a.type === "toolOff" || a.type === "indicatorOff")) {
      actions.push({ type: "removeOverlays", ids: found });
      summary.push(`Retirer ${found.map(nameOf).join(", ")}`);
    } else if (/\b(compare|comparer|superpose|superposer|ajoute|ajouter|overlay|add)\b/.test(text) && found.length === 1 && !/\bsur\b/.test(text)) {
      actions.push({ type: "setOverlays", ids: found, append: true });
      summary.push(`Superposer ${nameOf(found[0])}`);
    } else {
      actions.push({ type: "setMain", id: found[0] });
      summary.push(`Graphique : ${nameOf(found[0])}`);
      if (found.length > 1 || COMPARE.test(text)) {
        if (found.length > 1) {
          actions.push({ type: "setOverlays", ids: found.slice(1), append: false });
          summary.push(`Superposés : ${found.slice(1).map(nameOf).join(", ")}`);
        }
      }
    }
  }

  if (wantsZone) {
    actions.push({ type: "drawTool", tool: "zone" });
    summary.push("Zone d'analyse : cliquez le début puis la fin de la période");
  }

  return { actions, summary };
}

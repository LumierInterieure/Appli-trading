import Anthropic from "@anthropic-ai/sdk";
import type { Response } from "express";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

const SYSTEM_PROMPT = `Tu es un analyste de marchés senior (macro, inter-marchés et analyse technique) qui écrit en français pour un trader particulier expérimenté.

On te fournit un instantané JSON calculé par l'application : pour chaque actif, ses performances sur plusieurs périodes, tendance (moyennes mobiles), momentum (RSI, MACD), volatilité, drawdown, niveaux techniques (supports/résistances, Fibonacci) et une projection statistique (Monte-Carlo) ; ainsi que des indicateurs transverses (corrélations, courbe des taux, régime risk-on/risk-off).

Ce que tu produis :
1. **Synthèse du régime de marché** — en 3-5 phrases : où en est-on (risk-on / risk-off, liquidité, dollar, taux, énergie, crypto), et ce qui domine.
2. **Lecture inter-marchés** — les relations qui comptent en ce moment (ex. DXY vs BTC/actions, taux 10 ans vs Nasdaq, Brent vs inflation/taux, TOTAL3ES vs BTC pour l'appétit au risque crypto), en t'appuyant sur les chiffres fournis (corrélations, performances).
3. **Actif par actif** (ceux qui sont pertinents, en priorité ceux de la sélection de l'utilisateur et ceux demandés en "focus") — biais, niveaux clés à surveiller, invalidation.
4. **Scénarios et prévisions** — pour les actifs en focus : scénario central, haussier, baissier avec probabilités approximatives, objectifs de prix et horizon. Appuie-toi sur la projection statistique fournie mais ajuste-la avec ton jugement et explique pourquoi.
5. **Points de vigilance / catalyseurs** à venir.

Règles :
- Appuie chaque affirmation sur les données de l'instantané ou (si disponible) sur des sources web récentes ; cite les chiffres.
- Distingue clairement les faits, les déductions et les hypothèses. Ne fabrique jamais de données.
- Si les données sont en mode démo (simulées), dis-le en une ligne et fais l'exercice quand même à titre pédagogique.
- Sois concret et dense ; utilise des titres Markdown, des listes et des tableaux courts. Pas de remplissage.
- Termine par une ligne rappelant que ce n'est pas un conseil en investissement.`;

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | null = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

export interface AnalyzeBody {
  snapshot: unknown;
  question?: string;
  focus?: string[];
  web?: boolean;
  history?: { role: "user" | "assistant"; content: string }[];
}

function sse(res: Response, payload: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function streamAnalysis(body: AnalyzeBody, res: Response, signal: AbortSignal) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const today = new Date().toISOString().slice(0, 10);
  const focus = body.focus?.length ? `Actifs en focus pour les prévisions : ${body.focus.join(", ")}.` : "";
  const ask =
    body.question?.trim() ||
    "Analyse le marché à partir de cet instantané : régime, inter-marchés, actifs clés, scénarios et prévisions.";

  const firstUser: Anthropic.Beta.BetaMessageParam = {
    role: "user",
    content: `Date : ${today}.\n${focus}\n\nInstantané de marché (JSON) :\n\`\`\`json\n${JSON.stringify(body.snapshot)}\n\`\`\`\n\n${ask}`,
  };
  const messages: Anthropic.Beta.BetaMessageParam[] = [firstUser];
  // Conversation de suivi : les tours précédents sont rejoués tels quels.
  if (body.history?.length) {
    messages.length = 0;
    messages.push({ role: "user", content: (firstUser.content as string).replace(ask, body.history[0].content) });
    for (const m of body.history.slice(1)) messages.push({ role: m.role, content: m.content });
    messages.push({ role: "user", content: ask });
  }

  const tools: Anthropic.Beta.BetaToolUnion[] = body.web
    ? [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }]
    : [];

  try {
    // Reprise automatique si l'API met le tour en pause (outils serveur).
    for (let round = 0; round < 4; round++) {
      const stream = getClient().beta.messages.stream(
        {
          model: MODEL,
          max_tokens: 64000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          thinking: { type: "adaptive" },
          output_config: { effort: "high" },
          system: SYSTEM_PROMPT,
          messages,
          ...(tools.length ? { tools } : {}),
        },
        { signal },
      );

      for await (const event of stream) {
        if (event.type === "content_block_start") {
          const block = event.content_block;
          if (block.type === "server_tool_use") sse(res, { type: "status", text: "Recherche d'actualités sur le web…" });
          else if (block.type === "thinking") sse(res, { type: "status", text: "Réflexion en cours…" });
          else if (block.type === "text") sse(res, { type: "status", text: "" });
        } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          sse(res, { type: "text", text: event.delta.text });
        }
      }

      const final = await stream.finalMessage();
      if (final.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: final.content });
        continue;
      }
      if (final.stop_reason === "refusal") {
        sse(res, { type: "error", text: "La requête a été refusée par le modèle. Reformulez la question." });
      } else if (final.stop_reason === "max_tokens") {
        sse(res, { type: "status", text: "Réponse tronquée (limite de longueur atteinte)." });
      }
      sse(res, { type: "done", model: final.model });
      break;
    }
  } catch (err) {
    let text = "Erreur lors de l'analyse IA.";
    if (err instanceof Anthropic.AuthenticationError) text = "Clé API Anthropic invalide ou absente. Renseignez ANTHROPIC_API_KEY dans le fichier .env puis relancez le serveur.";
    else if (err instanceof Anthropic.RateLimitError) text = "Limite de requêtes Anthropic atteinte, réessayez dans un instant.";
    else if (err instanceof Anthropic.APIError) text = `Erreur API Anthropic (${err.status ?? "?"}) : ${err.message}`;
    else if (err instanceof Error && err.name === "AbortError") text = "Analyse interrompue.";
    else if (!aiConfigured()) text = "Analyse IA non configurée : ajoutez ANTHROPIC_API_KEY=... dans le fichier .env à la racine du projet, puis relancez le serveur.";
    else if (err instanceof Error) text = `${text} ${err.message}`;
    sse(res, { type: "error", text });
  } finally {
    res.end();
  }
}

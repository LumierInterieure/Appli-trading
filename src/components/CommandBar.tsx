import { useState } from "react";

const EXAMPLES = [
  "extension de fibonacci sur btc en 1 an",
  "compare nasdaq, sp500 et dxy en relatif sur 6 mois",
  "supports et résistances + mm200 sur le brent",
  "prévision sur total3es",
  "alerte si btc passe sous 95000",
  "alerte si le nasdaq baisse de 5% sur 1 semaine",
  "analyse le marché avec l'IA, focus btc et us10y",
  "rsi macd divergences sur nvidia en 3 mois",
];

export function CommandBar({ onRun, feedback }: { onRun: (text: string) => void; feedback: string | null }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <div className="cmd">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          onRun(text);
          setText("");
          setOpen(false);
        }}
      >
        <span className="cmd-icon">⌘</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Dites ce que vous voulez : « extension de fibonacci sur btc », « compare nasdaq et dxy »…"
        />
      </form>
      {open && !text && (
        <div className="cmd-pop">
          {EXAMPLES.map((ex) => (
            <button key={ex} onMouseDown={(e) => { e.preventDefault(); onRun(ex); setOpen(false); }}>{ex}</button>
          ))}
        </div>
      )}
      {feedback && <div className="cmd-feedback">{feedback}</div>}
    </div>
  );
}

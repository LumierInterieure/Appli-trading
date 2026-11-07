/** Objets graphiques produits par les outils automatiques, rendus par le calque de dessin. */
export interface Pt { time: number; value: number }

export type Drawing = (
  | { kind: "line"; id: string; points: Pt[]; color: string; width?: number; style?: "solid" | "dashed" | "dotted"; label?: string; showLabel?: boolean; autoscale?: boolean }
  | { kind: "priceLine"; id: string; price: number; color: string; title: string; style?: "solid" | "dashed" | "dotted"; width?: number }
  | { kind: "fib"; id: string; anchors: Pt[]; levels: { ratio: number; value: number; color: string }[]; color: string; label?: string; autoscale?: boolean }
  | { kind: "markers"; id: string; markers: Marker[] }
) & {
  /** Outil automatique qui a produit ce dessin. */
  tool?: string;
};

export interface Marker {
  time: number;
  position: "aboveBar" | "belowBar" | "inBar";
  shape: "circle" | "square" | "arrowUp" | "arrowDown";
  color: string;
  text?: string;
}

/** Résumé lisible de ce qu'un outil a tracé (affiché dans le panneau Outils). */
export interface ToolReport {
  tool: string;
  title: string;
  lines: { label: string; value: string; color?: string }[];
  note?: string;
}

export interface ToolOutput {
  drawings: Drawing[];
  reports: ToolReport[];
}

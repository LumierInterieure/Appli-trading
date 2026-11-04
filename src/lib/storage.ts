/** Persistance locale (navigateur). Toutes les lectures/écritures sont protégées. */
const PREFIX = "market-desk:";

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    if (fallback && typeof fallback === "object" && !Array.isArray(fallback)) return { ...fallback, ...v };
    return v as T;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* stockage indisponible */
  }
}

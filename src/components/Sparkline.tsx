export function Sparkline({ values, width = 64, height = 22, base }: { values: number[]; width?: number; height?: number; base?: number }) {
  if (values.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...values, base ?? Infinity);
  const max = Math.max(...values, base ?? -Infinity);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => height - 1 - ((v - min) / span) * (height - 2);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const up = values[values.length - 1] >= (base ?? values[0]);
  const color = up ? "var(--up)" : "var(--down)";
  return (
    <svg width={width} height={height} className="spark" aria-hidden>
      {base != null && <line x1={0} x2={width} y1={y(base)} y2={y(base)} stroke="var(--border)" strokeDasharray="2 2" />}
      <path d={d} fill="none" stroke={color} strokeWidth={1.3} />
    </svg>
  );
}

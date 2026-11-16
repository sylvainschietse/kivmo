/** Graphiques SVG sans dépendance ; toujours accompagnés d'un tableau équivalent (§17). */
export function BarChart({ data, label, format, signed }: { data: { x: string; y: number | null }[]; label: string; format: (n: number) => string; signed?: boolean }) {
  const vals = data.map((d) => d.y ?? 0);
  const max = Math.max(1e-9, ...vals.map(Math.abs));
  const hasNeg = signed && vals.some((v) => v < 0);
  const H = 160, W = Math.max(280, data.length * 44), base = hasNeg ? H / 2 : H - 20;
  const scale = (hasNeg ? H / 2 - 20 : H - 40) / max;
  return (
    <figure className="overflow-x-auto">
      <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} className="h-40 min-w-full" preserveAspectRatio="none">
        <line x1="0" x2={W} y1={base} y2={base} stroke="var(--line)" />
        {data.map((d, i) => {
          const v = d.y ?? 0;
          const h = Math.abs(v) * scale;
          const x = i * 44 + 8;
          return (
            <g key={d.x}>
              <rect x={x} width="28" y={v >= 0 ? base - h : base} height={Math.max(h, d.y == null ? 0 : 1)} rx="4" fill={v < 0 ? "var(--loss)" : "var(--green)"}>
                <title>{`${d.x} : ${d.y == null ? "non mesuré" : format(v)}`}</title>
              </rect>
              <text x={x + 14} y={H - 4} textAnchor="middle" fontSize="10" fill="var(--muted)">{d.x.slice(5)}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export function LineChart({ data, label, format }: { data: { x: string; y: number | null }[]; label: string; format: (n: number) => string }) {
  const pts = data.filter((d) => d.y != null) as { x: string; y: number }[];
  if (pts.length < 2) return <p className="text-sm text-muted">Pas assez de mesures pour tracer une courbe.</p>;
  const min = Math.min(...pts.map((p) => p.y)), max = Math.max(...pts.map((p) => p.y));
  const W = 320, H = 140, pad = 16;
  const sx = (i: number) => pad + (i * (W - 2 * pad)) / (pts.length - 1);
  const sy = (v: number) => H - pad - ((v - min) / Math.max(1e-9, max - min)) * (H - 2 * pad);
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} className="h-36 w-full">
      <polyline fill="none" stroke="var(--green)" strokeWidth="2.5" points={pts.map((p, i) => `${sx(i)},${sy(p.y)}`).join(" ")} />
      {pts.map((p, i) => (
        <circle key={i} cx={sx(i)} cy={sy(p.y)} r="4" fill="var(--green)"><title>{`${p.x} : ${format(p.y)}`}</title></circle>
      ))}
    </svg>
  );
}

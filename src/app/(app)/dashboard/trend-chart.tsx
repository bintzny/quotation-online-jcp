// Monthly proposed vs Won (before VAT), with the target as a dashed tick. Plain HTML/CSS bars
// rendered on the server: text keeps its normal size on every screen, no chart library and nothing
// sent to the browser beyond the markup. Hover shows a native tooltip; the same numbers are in the
// table below the chart.

type Point = { key: string; label: string; proposed: number; won: number; target: number | null; tooltip: string };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

export function TrendChart({
  points, axisLabel, labels,
}: {
  points: Point[];
  axisLabel: (v: number) => string;
  labels: { proposed: string; won: string; target: string; title: string };
}) {
  const max = niceMax(Math.max(...points.flatMap((p) => [p.proposed, p.won, p.target ?? 0])));
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  const ticks = [max, max / 2, 0];

  return (
    <figure className="grid gap-2" aria-label={labels.title}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: "var(--viz-proposed)" }} />{labels.proposed}</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: "var(--viz-won)" }} />{labels.won}</span>
        <span className="flex items-center gap-1.5"><span className="h-0 w-3 border-t-2 border-dashed border-foreground" />{labels.target}</span>
      </div>
      <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-2" aria-hidden>
        {/* y axis */}
        <div className="relative h-44 w-10 text-right text-[11px] text-muted-foreground tabular-nums sm:h-52">
          {ticks.map((v, i) => (
            <span key={v} className="absolute right-0 -translate-y-1/2" style={{ top: `${(i / (ticks.length - 1)) * 100}%` }}>{axisLabel(v)}</span>
          ))}
        </div>
        {/* plot */}
        <div className="relative h-44 sm:h-52">
          {ticks.map((v, i) => (
            <div key={v} className="absolute inset-x-0 border-t border-border" style={{ top: `${(i / (ticks.length - 1)) * 100}%` }} />
          ))}
          <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
            {points.map((p) => (
              <div key={p.key} title={p.tooltip} className="relative flex items-end justify-center gap-0.5 rounded-sm px-0.5 hover:bg-muted/60 sm:gap-[2px]">
                <div className="w-full max-w-4 rounded-t-[4px]" style={{ height: pct(p.proposed), background: "var(--viz-proposed)" }} />
                <div className="w-full max-w-4 rounded-t-[4px]" style={{ height: pct(p.won), background: "var(--viz-won)" }} />
                {p.target !== null && p.target > 0 && (
                  <div className="absolute inset-x-0.5 border-t-2 border-dashed border-foreground" style={{ bottom: pct(p.target) }} />
                )}
              </div>
            ))}
          </div>
        </div>
        {/* x axis */}
        <div />
        <div className="grid pt-1 text-center text-[10px] text-muted-foreground sm:text-[11px]" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
          {points.map((p, i) => (
            <span key={p.key} className={(points.length - 1 - i) % 2 === 1 ? "max-sm:invisible" : ""}>{p.label}</span>
          ))}
        </div>
      </div>
    </figure>
  );
}

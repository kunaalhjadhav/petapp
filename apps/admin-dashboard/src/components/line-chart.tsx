'use client';

import { useId, useRef, useState } from 'react';
import { formatMetric, niceMax } from '@/lib/analytics';
import type { MetricFormat } from '@/lib/types';

// One measure per chart (never two y-scales). Thin 2px line, recessive grid, a crosshair and tooltip on hover or
// keyboard focus, and the numbers as a table for screen readers and anyone who prefers them.
const MARK = '#0d9488';
const W = 640;
const H = 180;
const PAD = { top: 12, right: 12, bottom: 28 };

const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

export function LineChart({
  label,
  format,
  points,
}: {
  label: string;
  format: MetricFormat;
  points: Array<{ day: string; value: number }>;
}) {
  const id = useId();
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const ticks = max <= 2 && format !== 'paise' ? [0, max] : [0, max / 2, max];
  const tickText = (t: number) => formatMetric(t, format === 'pct' ? 'count' : format);
  // Room for the longest axis label (about 8 units a character at this size).
  const left = Math.max(36, Math.max(...ticks.map((t) => tickText(t).length)) * 8 + 14);
  const iw = W - left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (i: number) =>
    left + (points.length <= 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => PAD.top + ih - (v / max) * ih;
  const path = points
    .map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join('');
  const xTicks =
    points.length > 2
      ? [0, Math.floor((points.length - 1) / 2), points.length - 1]
      : points.map((_, i) => i);
  const total = points.reduce((a, p) => a + p.value, 0);

  const pick = (clientX: number) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r || !points.length) return;
    const px = ((clientX - r.left) / r.width) * W;
    const i = Math.round(((px - left) / iw) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };
  const h = hover !== null ? points[hover] : null;

  return (
    <figure className="rounded-lg border border-line bg-panel p-4">
      <figcaption className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted">
          {format === 'pct' ? '' : `Total ${formatMetric(total, format)}`}
        </span>
      </figcaption>
      <div className="relative">
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none outline-none"
          role="img"
          aria-labelledby={`${id}-t`}
          tabIndex={0}
          onPointerMove={(e) => pick(e.clientX)}
          onPointerLeave={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') setHover((v) => Math.min(points.length - 1, (v ?? -1) + 1));
            if (e.key === 'ArrowLeft') setHover((v) => Math.max(0, (v ?? points.length) - 1));
            if (e.key === 'Escape') setHover(null);
          }}
          onBlur={() => setHover(null)}
        >
          <title
            id={`${id}-t`}
          >{`${label}, daily, ${points[0]?.day ?? ''} to ${points.at(-1)?.day ?? ''}`}</title>
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--color-line-soft)"
                strokeWidth={1}
              />
              <text
                x={left - 8}
                y={y(t) + 4}
                textAnchor="end"
                fontSize={14}
                fill="var(--color-muted)"
              >
                {tickText(t)}
              </text>
            </g>
          ))}
          <line
            x1={left}
            x2={W - PAD.right}
            y1={y(0)}
            y2={y(0)}
            stroke="var(--color-line)"
            strokeWidth={1}
          />
          {xTicks.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={H - 6}
              textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
              fontSize={14}
              fill="var(--color-muted)"
            >
              {dayLabel(points[i].day)}
            </text>
          ))}
          <path
            d={path}
            fill="none"
            stroke={MARK}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {points.length === 1 && <circle cx={x(0)} cy={y(points[0].value)} r={4} fill={MARK} />}
          {h && hover !== null && (
            <g pointerEvents="none">
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={PAD.top + ih}
                stroke="var(--color-faint)"
                strokeWidth={1}
              />
              <circle
                cx={x(hover)}
                cy={y(h.value)}
                r={5}
                fill={MARK}
                stroke="var(--color-panel)"
                strokeWidth={2}
              />
            </g>
          )}
        </svg>
        {h && hover !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 whitespace-nowrap rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs shadow-sm"
            style={{
              left: `${(x(hover) / W) * 100}%`,
              transform:
                hover > points.length / 2 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)',
            }}
          >
            <span className="block text-muted">{dayLabel(h.day)}</span>
            <span className="font-medium tabular-nums">{formatMetric(h.value, format)}</span>
          </div>
        )}
      </div>
      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer">Show as a table</summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr>
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 text-right font-medium">{label}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.day} className="border-t border-line-soft">
                <td className="py-1">{p.day}</td>
                <td className="py-1 text-right tabular-nums text-ink">
                  {formatMetric(p.value, format)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

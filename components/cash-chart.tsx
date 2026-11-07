"use client";
import { useEffect, useRef, useState } from "react";
import { money, shortDate } from "@/lib/forecast";
import type { Forecast } from "@/lib/model";
export default function CashChart({
  result,
  baseline,
  cushion,
  compare,
  scenarioLabel = "Your scenario",
  baselineLabel = "Stay in Dallas",
}: {
  result: Forecast;
  baseline: Forecast;
  cushion: number;
  compare: boolean;
  scenarioLabel?: string;
  baselineLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(280, entry.contentRect.width)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const height = width < 500 ? 240 : 294,
    left = width < 500 ? 48 : 64,
    right = 20,
    top = 20,
    bottom = 35;
  const values = [
    ...result.days.map((d) => d.balanceCents),
    ...(compare ? baseline.days.map((d) => d.balanceCents) : []),
    cushion,
    0,
  ];
  const low = Math.floor((Math.min(...values) - 20000) / 100000) * 100000;
  const high = Math.max(
    100000,
    Math.ceil((Math.max(...values) + 30000) / 100000) * 100000,
  );
  const x = (i: number) =>
    left + (i / Math.max(1, result.days.length - 1)) * (width - left - right);
  const y = (value: number) =>
    top + ((high - value) / (high - low)) * (height - top - bottom);
  const path = (f: Forecast) =>
    f.days
      .map(
        (d, i) =>
          `${i ? "L" : "M"}${x(i).toFixed(2)},${y(d.balanceCents).toFixed(2)}`,
      )
      .join(" ");
  const area = `${path(result)} L${x(result.days.length - 1)},${height - bottom} L${left},${height - bottom} Z`;
  const cursor = hover === null ? null : result.days[hover];
  const minimumIndex = result.days.findIndex(
    (d) => d.date === result.minimumDate,
  );
  return (
    <div className="chart-shell">
      <div className="chart-legend">
        <span>
          <i className="legend-dot purple" />
          {scenarioLabel}
        </span>
        {compare && (
          <span>
            <i className="legend-dash" />
            {baselineLabel}
          </span>
        )}
        <span>
          <i className="legend-dot amber" />
          Cash cushion
        </span>
      </div>
      <div
        ref={chartRef}
        className="chart-interactive"
        role="img"
        aria-label={`Projected cash over ${result.days.length} days. Lowest balance ${money(result.minimumCents)} on ${shortDate(result.minimumDate)}. Ending balance ${money(result.endingCents)}.`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            setHover(
              Math.max(
                0,
                Math.min(
                  result.days.length - 1,
                  (hover ?? 0) + (e.key === "ArrowRight" ? 1 : -1),
                ),
              ),
            );
          }
        }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const scaleX = ((e.clientX - r.left) / r.width) * width;
          setHover(
            Math.max(
              0,
              Math.min(
                result.days.length - 1,
                Math.round(
                  ((scaleX - left) / (width - left - right)) *
                    (result.days.length - 1),
                ),
              ),
            ),
          );
        }}
      >
        <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
          <defs>
            <linearGradient id="cashFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8472ef" stopOpacity=".17" />
              <stop offset="100%" stopColor="#8472ef" stopOpacity=".015" />
            </linearGradient>
          </defs>
          {low < 0 && (
            <rect
              x={left}
              y={y(0)}
              width={width - left - right}
              height={height - bottom - y(0)}
              fill="#fff4ef"
              rx="4"
            />
          )}
          {Array.from(
            { length: 5 },
            (_, i) => high - (i * (high - low)) / 4,
          ).map((v, i) => (
            <g key={i}>
              <line
                x1={left}
                x2={width - right}
                y1={y(v)}
                y2={y(v)}
                stroke="#eae9ee"
                strokeDasharray="3 5"
              />
              <text
                x={left - 14}
                y={y(v) + 4}
                textAnchor="end"
                fill="#93909f"
                fontSize="11"
              >
                {Math.abs(v) >= 100000
                  ? `${v < 0 ? "−" : ""}$${Math.abs(v / 100000).toFixed(1)}k`
                  : money(v)}
              </text>
            </g>
          ))}
          <line
            x1={left}
            x2={width - right}
            y1={y(cushion)}
            y2={y(cushion)}
            stroke="#d8ac61"
            strokeDasharray="5 5"
          />
          <path d={area} fill="url(#cashFill)" />
          {compare && (
            <path
              d={path(baseline)}
              stroke="#b6b4c4"
              fill="none"
              strokeWidth="2"
              strokeDasharray="6 5"
            />
          )}
          <path
            d={path(result)}
            stroke="#7560df"
            fill="none"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <circle
            cx={x(minimumIndex)}
            cy={y(result.minimumCents)}
            r="6"
            fill={result.minimumCents < cushion ? "#e29855" : "#7560df"}
            stroke="white"
            strokeWidth="3"
          />
          {Array.from({ length: width < 500 ? 4 : 6 }, (_, i) =>
            Math.round((i * (result.days.length - 1)) / (width < 500 ? 3 : 5)),
          ).map((i) => (
            <text
              key={i}
              x={x(i)}
              y={height - 9}
              textAnchor={
                i === 0
                  ? "start"
                  : i === result.days.length - 1
                    ? "end"
                    : "middle"
              }
              fill="#93909f"
              fontSize="11"
            >
              {shortDate(result.days[i].date)}
            </text>
          ))}
          {cursor && (
            <>
              <line
                x1={x(hover!)}
                x2={x(hover!)}
                y1={top}
                y2={height - bottom}
                stroke="#a69bd6"
                strokeDasharray="3 3"
              />
              <circle
                cx={x(hover!)}
                cy={y(cursor.balanceCents)}
                r="5"
                fill="#6854dc"
                stroke="white"
                strokeWidth="2"
              />
            </>
          )}
        </svg>
        {cursor && (
          <div
            className="chart-tooltip"
            style={{
              left: `${Math.max(17, Math.min(78, (x(hover!) / width) * 100))}%`,
            }}
          >
            <span>{shortDate(cursor.date)}</span>
            <strong>{money(cursor.balanceCents, 2)}</strong>
            <small>
              {cursor.events.length
                ? cursor.events.map((e) => e.name).join(" · ")
                : "No scheduled transactions"}
            </small>
          </div>
        )}
      </div>
      <div className="chart-footnote">
        <span>End-of-day cash · selected accounts</span>
        <span>Hover or use arrow keys to explore</span>
      </div>
    </div>
  );
}

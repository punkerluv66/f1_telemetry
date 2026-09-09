import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { displayPoints } from "../lib/chartDisplay";

type Point = { distanceM: number; value: number };
type Series = { label: string; color: string; points: Point[] };
type Props = {
  title: string;
  subtitle: string;
  unit: string;
  series: Series[];
  maxDistance: number;
  hoverDistance: number | null;
  onHover: (value: number | null) => void;
  centerZero?: boolean;
  discrete?: boolean;
  highlightedRange?: { start: number; end: number };
  guides?: Array<{ distanceM: number; label: string }>;
};
const height = 260;
const padding = { top: 18, right: 20, bottom: 30, left: 54 };
const plotHeight = height - padding.top - padding.bottom;
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

export const ChartCard = memo(function ChartCard(props: Props) {
  const plot = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const plotWidth = width - padding.left - padding.right;
  useEffect(() => {
    if (!plot.current) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(260, Math.round(entries[0].contentRect.width))),
    );
    observer.observe(plot.current);
    return () => observer.disconnect();
  }, []);
  const geometry = useMemo(() => {
    let min = Infinity,
      max = -Infinity;
    for (const series of props.series)
      for (const point of series.points) {
        min = Math.min(min, point.value);
        max = Math.max(max, point.value);
      }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = 0;
      max = 1;
    }
    if (props.unit === "%") {
      min = 0;
      max = 100;
    }
    if (props.centerZero) {
      max = Math.max(Math.abs(min), Math.abs(max), 1);
      min = -max;
    }
    if (min === max) {
      min--;
      max++;
    }
    const y = (value: number) =>
      height - padding.bottom - ((value - min) / (max - min)) * plotHeight;
    const x = (distance: number) =>
      padding.left + (distance / Math.max(props.maxDistance, 1)) * plotWidth;
    const paths = props.series.map((series) =>
      displayPoints(series.points, props.maxDistance, plotWidth)
        .map((point, index) => {
          const px = x(point.distanceM).toFixed(2),
            py = y(point.value).toFixed(2);
          return index === 0
            ? "M " + px + " " + py
            : props.discrete
              ? "H " + px + " V " + py
              : "L " + px + " " + py;
        })
        .join(" "),
    );
    return { min, max, y, x, paths };
  }, [
    props.series,
    props.maxDistance,
    props.centerZero,
    props.discrete,
    props.unit,
    width,
    plotWidth,
  ]);
  const hoverPoints =
    props.hoverDistance === null
      ? []
      : props.series.map((series) =>
          sample(series.points, props.hoverDistance!, !!props.discrete),
        );
  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    if (
      point.x < padding.left ||
      point.x > width - padding.right ||
      point.y < padding.top ||
      point.y > height - padding.bottom
    ) {
      props.onHover(null);
      return;
    }
    props.onHover(
      clamp((point.x - padding.left) / plotWidth, 0, 1) * props.maxDistance,
    );
  }
  return (
    <article className="panel chart-card">
      <div className="chart-card__header">
        <div>
          <h3>{props.title}</h3>
          <p className="chart-subtitle">{props.subtitle}</p>
        </div>
        <div className="chart-card__value">
          <strong>
            {props.hoverDistance === null
              ? "—"
              : Math.round(props.hoverDistance) + " m"}
          </strong>
          <p className="chart-subtitle">
            {hoverPoints
              .map((point) =>
                point
                  ? props.discrete && props.unit === "%"
                    ? point.value >= 50
                      ? "On"
                      : "Off"
                    : (props.centerZero && point.value > 0 ? "+" : "") +
                      Math.round(point.value) +
                      " " +
                      props.unit
                  : "—",
              )
              .join(" / ")}
          </p>
        </div>
      </div>
      <div className="chart-card__plot" ref={plot}>
        <svg
          viewBox={"0 0 " + width + " " + height}
          role="img"
          aria-label={props.title}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => props.onHover(null)}
        >
          {props.highlightedRange && (
            <rect
              x={geometry.x(props.highlightedRange.start)}
              y={padding.top}
              width={
                geometry.x(props.highlightedRange.end) -
                geometry.x(props.highlightedRange.start)
              }
              height={plotHeight}
              fill="#cf2f27"
              fillOpacity={0.08}
            />
          )}
          {(props.unit === "gear"
            ? Array.from(
                {
                  length:
                    Math.floor(geometry.max) - Math.ceil(geometry.min) + 1,
                },
                (_, i) => Math.floor(geometry.max) - i,
              )
            : [0, 1, 2, 3, 4].map(
                (i) => geometry.max - ((geometry.max - geometry.min) * i) / 4,
              )
          ).map((value, i) => {
            const y = geometry.y(value);
            return (
              <g key={i}>
                <line
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y}
                  y2={y}
                  stroke="#e2e8f0"
                />
                <text
                  x={padding.left - 10}
                  y={y + 4}
                  textAnchor="end"
                  fill="#64748b"
                  fontSize={11}
                >
                  {props.discrete && props.unit === "%"
                    ? i === 0
                      ? "On"
                      : i === 4
                        ? "Off"
                        : ""
                    : Math.round(value)}
                </text>
              </g>
            );
          })}
          {[0, 1, 2, 3, 4].map((i) => (
            <text
              key={i}
              x={geometry.x((props.maxDistance * i) / 4)}
              y={height - 7}
              textAnchor="middle"
              fill="#64748b"
              fontSize={11}
            >
              {Math.round((props.maxDistance * i) / 4)} m
            </text>
          ))}
          {props.guides?.map((guide) => (
            <g key={guide.label}>
              <line
                x1={geometry.x(guide.distanceM)}
                x2={geometry.x(guide.distanceM)}
                y1={padding.top}
                y2={height - padding.bottom}
                stroke="#cbd5e1"
                strokeDasharray="3 5"
              />
              <text
                x={geometry.x(guide.distanceM) + 4}
                y={padding.top + 12}
                fill="#64748b"
                fontSize={10}
              >
                {guide.label}
              </text>
            </g>
          ))}
          {props.centerZero && (
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={geometry.y(0)}
              y2={geometry.y(0)}
              stroke="#94a3b8"
              strokeDasharray="4 4"
            />
          )}
          {props.series.map((series, i) => (
            <path
              key={series.label + i}
              d={geometry.paths[i]}
              fill="none"
              stroke={series.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeDasharray={i === 1 ? "7 3" : undefined}
            />
          ))}
          {props.hoverDistance !== null && (
            <>
              <line
                x1={geometry.x(props.hoverDistance)}
                x2={geometry.x(props.hoverDistance)}
                y1={padding.top}
                y2={height - padding.bottom}
                stroke="#64748b"
                strokeDasharray="4 4"
              />
              {hoverPoints.map(
                (point, i) =>
                  point && (
                    <circle
                      key={i}
                      cx={geometry.x(props.hoverDistance!)}
                      cy={geometry.y(point.value)}
                      r={4}
                      fill={props.series[i].color}
                      stroke="white"
                      strokeWidth={2}
                    />
                  ),
              )}
            </>
          )}
        </svg>
      </div>
      <div className="legend">
        {props.series.map((series, i) => (
          <span className="legend__item" key={series.label + i}>
            <span
              className="legend__swatch"
              style={{ background: series.color }}
            />
            {series.label}
            {i === 1 ? " · dashed" : ""}
          </span>
        ))}
      </div>
      {props.series.some((series) => series.points.length > plotWidth * 4) && (
        <p className="chart-subtitle">
          Display simplified to screen resolution; cursor values use all
          samples.
        </p>
      )}
    </article>
  );
});
function sample(
  points: Point[],
  distance: number,
  discrete: boolean,
): Point | null {
  if (!points.length) return null;
  if (distance <= points[0].distanceM) return points[0];
  let left = 0,
    right = points.length - 1;
  while (left + 1 < right) {
    const middle = Math.floor((left + right) / 2);
    if (points[middle].distanceM <= distance) left = middle;
    else right = middle;
  }
  const a = points[left],
    b = points[right];
  if (distance >= b.distanceM) return b;
  if (discrete) return a;
  return {
    distanceM: distance,
    value:
      a.value +
      (b.value - a.value) *
        clamp(
          (distance - a.distanceM) / Math.max(0.001, b.distanceM - a.distanceM),
          0,
          1,
        ),
  };
}

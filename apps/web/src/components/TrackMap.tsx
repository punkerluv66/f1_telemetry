import { useMemo } from "react";
import type { PointerEvent } from "react";
import type { ComparisonResponse } from "../types";

export function TrackMap(props: {
  comparison: ComparisonResponse;
  hoverDistance: number | null;
  onHover?: (distance: number | null) => void;
}) {
  const geometry = useMemo(() => {
    const points = props.comparison.referenceLap.points.filter(
      (p) => p.x !== null && p.y !== null,
    );
    if (!points.length) return null;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x!);
      maxX = Math.max(maxX, p.x!);
      minY = Math.min(minY, p.y!);
      maxY = Math.max(maxY, p.y!);
    }
    const scale = Math.min(
      720 / Math.max(maxX - minX, 1),
      300 / Math.max(maxY - minY, 1),
    );
    const mapped = points.map((p) => ({
      ...p,
      px: 400 + (p.x! - (minX + maxX) / 2) * scale,
      py: 180 - (p.y! - (minY + maxY) / 2) * scale,
    }));
    const path = mapped
      .map(
        (p, i) => (i ? "L " : "M ") + p.px.toFixed(2) + " " + p.py.toFixed(2),
      )
      .join(" ");
    return { points: mapped, path };
  }, [props.comparison]);
  if (!geometry)
    return (
      <div className="panel empty-state">
        No location data available for this lap.
      </div>
    );
  const hovered =
    props.hoverDistance === null
      ? null
      : nearestDistance(geometry.points, props.hoverDistance);
  function move(event: PointerEvent<SVGSVGElement>) {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix || !geometry) return;
    const mouse = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    let best = geometry.points[0],
      gap = Infinity;
    for (const p of geometry.points) {
      const d = (p.px - mouse.x) ** 2 + (p.py - mouse.y) ** 2;
      if (d < gap) {
        gap = d;
        best = p;
      }
    }
    props.onHover?.(gap < 2500 ? best.distanceM : null);
  }
  return (
    <article className="panel chart-card">
      <div className="chart-card__header">
        <div>
          <h3>Track map</h3>
          <p className="chart-subtitle">
            Reference lap position · approximate distance alignment
          </p>
        </div>
      </div>
      <svg
        className="track-map"
        viewBox="0 0 800 360"
        role="img"
        aria-label="Reference lap track map"
        onPointerMove={move}
        onPointerLeave={() => props.onHover?.(null)}
      >
        <path
          d={geometry.path}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={10}
          strokeLinejoin="round"
        />
        <path d={geometry.path} fill="none" stroke="#64748b" strokeWidth={2} />
        {hovered && (
          <circle
            cx={hovered.px}
            cy={hovered.py}
            r={6}
            fill="#2563eb"
            stroke="white"
            strokeWidth={2}
          />
        )}
      </svg>
    </article>
  );
}

function nearestDistance<T extends { distanceM: number }>(
  points: T[],
  distance: number,
): T {
  let low = 0,
    high = points.length - 1;
  while (low + 1 < high) {
    const mid = (low + high) >> 1;
    if (points[mid].distanceM < distance) low = mid;
    else high = mid;
  }
  return Math.abs(points[low].distanceM - distance) <=
    Math.abs(points[high].distanceM - distance)
    ? points[low]
    : points[high];
}

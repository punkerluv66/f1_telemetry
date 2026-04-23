import type { MouseEvent } from "react";

type SeriesPoint = {
  distanceM: number;
  value: number;
};

type Series = {
  label: string;
  color: string;
  points: SeriesPoint[];
};

type EventMarker = {
  peakDistanceM: number;
};

type EventMarkerGroup = {
  key: string;
  color: string;
  dashArray?: string;
  events: EventMarker[];
};

type ChartCardProps = {
  title: string;
  subtitle: string;
  unit: string;
  series: Series[];
  maxDistance: number;
  hoverDistance: number | null;
  onHover: (distance: number | null) => void;
  centerZero?: boolean;
  eventMarkerGroups?: EventMarkerGroup[];
};

export function ChartCard(props: ChartCardProps) {
  const width = 940;
  const height = 280;
  const padding = { top: 18, right: 20, bottom: 28, left: 46 };
  const values = props.series.flatMap((entry) => entry.points.map((point) => point.value));
  let min = Math.min(...values);
  let max = Math.max(...values);

  if (props.centerZero) {
    const amplitude = Math.max(Math.abs(min), Math.abs(max), 1);
    min = -amplitude;
    max = amplitude;
  }

  if (min === max) {
    min -= 1;
    max += 1;
  }

  const hoverPoints =
    props.hoverDistance === null
      ? []
      : props.series.map((entry) => findClosestPoint(entry.points, props.hoverDistance ?? 0));

  const handlePointerMove = (event: MouseEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    props.onHover(props.maxDistance * ratio);
  };

  const hoverLabel =
    props.hoverDistance === null ? "Move on chart" : `${Math.round(props.hoverDistance)} m`;

  return (
    <article className="panel chart-card">
      <div className="chart-card__header">
        <div>
          <h3 className="chart-card__title">{props.title}</h3>
          <p className="chart-subtitle">{props.subtitle}</p>
        </div>
        <div className="chart-card__value">
          <p className="chart-card__current">{hoverLabel}</p>
          <p className="chart-subtitle">{formatHoverValues(hoverPoints, props.unit)}</p>
        </div>
      </div>

      <div className="chart-card__plot">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={props.title}
          onMouseMove={handlePointerMove}
          onMouseLeave={() => props.onHover(null)}
        >
          {Array.from({ length: 5 }).map((_, index) => {
            const ratio = index / 4;
            const y = padding.top + (height - padding.top - padding.bottom) * ratio;
            const labelValue = max - (max - min) * ratio;

            return (
              <g key={`grid-${index}`}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  stroke="rgba(20,20,20,0.12)"
                  strokeWidth={1}
                />
                <text
                  x={padding.left - 12}
                  y={y + 4}
                  textAnchor="end"
                  fill="rgba(20,20,20,0.52)"
                  fontSize="11"
                >
                  {Math.round(labelValue)}
                </text>
              </g>
            );
          })}

          {props.eventMarkerGroups?.flatMap((group) =>
            group.events.map((event, index) => {
              const x = mapDistance(event.peakDistanceM, width, padding, props.maxDistance);

              return (
                <line
                  key={`${group.key}-${index}`}
                  x1={x}
                  y1={padding.top}
                  x2={x}
                  y2={height - padding.bottom}
                  stroke={group.color}
                  strokeOpacity={0.18}
                  strokeWidth={2}
                  strokeDasharray={group.dashArray ?? "4 6"}
                />
              );
            })
          )}

          {props.centerZero ? (
            <line
              x1={padding.left}
              y1={mapValue(0, height, padding, min, max)}
              x2={width - padding.right}
              y2={mapValue(0, height, padding, min, max)}
              stroke="rgba(20,20,20,0.24)"
              strokeWidth={2}
            />
          ) : null}

          {props.series.map((entry) => (
            <path
              key={entry.label}
              d={buildLine(entry.points, width, height, padding, props.maxDistance, min, max)}
              fill="none"
              stroke={entry.color}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {props.hoverDistance !== null ? (
            <>
              <line
                x1={mapDistance(props.hoverDistance, width, padding, props.maxDistance)}
                y1={padding.top}
                x2={mapDistance(props.hoverDistance, width, padding, props.maxDistance)}
                y2={height - padding.bottom}
                stroke="rgba(20,20,20,0.55)"
                strokeWidth={2}
                strokeDasharray="5 5"
              />
              {hoverPoints.map((point, index) => (
                <circle
                  key={`hover-${props.series[index].label}`}
                  cx={mapDistance(props.hoverDistance ?? 0, width, padding, props.maxDistance)}
                  cy={mapValue(point.value, height, padding, min, max)}
                  r={5}
                  fill={props.series[index].color}
                  stroke="white"
                  strokeWidth={2}
                />
              ))}
            </>
          ) : null}
        </svg>
      </div>

      <div className="legend">
        {props.series.map((entry) => (
          <span className="legend__item" key={entry.label}>
            <span className="legend__swatch" style={{ background: entry.color }} />
            {entry.label}
          </span>
        ))}
      </div>
    </article>
  );
}

function buildLine(
  points: SeriesPoint[],
  width: number,
  height: number,
  padding: { top: number; right: number; bottom: number; left: number },
  maxDistance: number,
  min: number,
  max: number
) {
  return points
    .map((point, index) => {
      const x = mapDistance(point.distanceM, width, padding, maxDistance);
      const y = mapValue(point.value, height, padding, min, max);

      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function findClosestPoint(points: SeriesPoint[], distance: number) {
  let closest = points[0];
  let gap = Math.abs(points[0].distanceM - distance);

  for (let index = 1; index < points.length; index += 1) {
    const candidateGap = Math.abs(points[index].distanceM - distance);

    if (candidateGap < gap) {
      gap = candidateGap;
      closest = points[index];
    }
  }

  return closest;
}

function formatHoverValues(points: SeriesPoint[], unit: string) {
  if (points.length === 0) {
    return "Hover to inspect telemetry";
  }

  return points.map((point) => `${Math.round(point.value)} ${unit}`).join(" • ");
}

function mapDistance(
  distance: number,
  width: number,
  padding: { top: number; right: number; bottom: number; left: number },
  maxDistance: number
) {
  const usableWidth = width - padding.left - padding.right;
  return padding.left + (distance / maxDistance) * usableWidth;
}

function mapValue(
  value: number,
  height: number,
  padding: { top: number; right: number; bottom: number; left: number },
  min: number,
  max: number
) {
  const usableHeight = height - padding.top - padding.bottom;
  const normalized = (value - min) / (max - min);
  return height - padding.bottom - normalized * usableHeight;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

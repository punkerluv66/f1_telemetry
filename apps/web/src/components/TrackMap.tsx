import type { ComparisonResponse } from "../types";

export function TrackMap(props: {
  comparison: ComparisonResponse;
  hoverDistance: number | null;
}) {
  const width = 800;
  const height = 400;
  const padding = 40;

  // We use the reference lap to draw the track layout
  const trackPoints = props.comparison.referenceLap.points.filter(
    (p) => p.x !== null && p.y !== null
  );

  if (trackPoints.length === 0) {
    return (
      <article className="panel">
        <p className="muted">No GPS location data available for this lap.</p>
      </article>
    );
  }

  // Find bounds
  const xs = trackPoints.map((p) => p.x!);
  const ys = trackPoints.map((p) => p.y!);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  // Keep aspect ratio
  const scale = Math.min(
    (width - padding * 2) / rangeX,
    (height - padding * 2) / rangeY
  );

  const mapX = (x: number) => padding + (x - minX) * scale;
  // Invert Y axis for SVG (usually Y goes down, but GPS goes up for north)
  const mapY = (y: number) => height - padding - (y - minY) * scale;

  const pathD = trackPoints
    .map((p, index) => {
      const x = mapX(p.x!);
      const y = mapY(p.y!);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  // Find hover points
  const getHoverPoint = (points: typeof trackPoints, distance: number) => {
    let closest = points[0];
    let minGap = Math.abs(points[0].distanceM - distance);
    for (const p of points) {
      const gap = Math.abs(p.distanceM - distance);
      if (gap < minGap) {
        minGap = gap;
        closest = p;
      }
    }
    return closest;
  };

  const refHover = props.hoverDistance !== null
    ? getHoverPoint(trackPoints, props.hoverDistance)
    : null;
    
  const targetPoints = props.comparison.targetLap.points.filter((p) => p.x !== null && p.y !== null);
  const targetHover = props.hoverDistance !== null && targetPoints.length > 0
    ? getHoverPoint(targetPoints, props.hoverDistance)
    : null;

  return (
    <article className="panel chart-card">
      <div className="chart-card__header">
        <div>
          <h3 className="chart-card__title">2D Track Map</h3>
          <p className="chart-subtitle">GPS Trace of the reference lap</p>
        </div>
      </div>
      <div className="chart-card__plot" style={{ height: `${height}px`, display: "flex", justifyContent: "center" }}>
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%">
          <path
            d={pathD}
            fill="none"
            stroke="rgba(255,255,255,0.2)"
            strokeWidth={8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={pathD}
            fill="none"
            stroke="rgba(20,20,20,0.5)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          
          {refHover && refHover.x !== null && refHover.y !== null ? (
            <circle
              cx={mapX(refHover.x)}
              cy={mapY(refHover.y)}
              r={6}
              fill={props.comparison.referenceLap.driver.color}
              stroke="white"
              strokeWidth={2}
            />
          ) : null}
          
          {targetHover && targetHover.x !== null && targetHover.y !== null ? (
            <circle
              cx={mapX(targetHover.x)}
              cy={mapY(targetHover.y)}
              r={6}
              fill={props.comparison.targetLap.driver.color}
              stroke="white"
              strokeWidth={2}
            />
          ) : null}
        </svg>
      </div>
    </article>
  );
}

import { MouseEvent, useMemo } from "react";
import type { ComparisonResponse } from "../types";

export function TrackMap(props: {
  comparison: ComparisonResponse;
  hoverDistance: number | null;
  onHover?: (distance: number | null) => void;
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

  const handleMouseMove = (event: MouseEvent<SVGSVGElement>) => {
    if (!props.onHover) return;

    const svg = event.currentTarget;
    const rect = svg.getBoundingClientRect();
    
    // Calculate mouse position in SVG coordinates
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    
    const mouseX = (event.clientX - rect.left) * scaleX;
    const mouseY = (event.clientY - rect.top) * scaleY;

    // Find the closest point by Euclidean distance
    let closest = trackPoints[0];
    let minDistSq = Infinity;

    for (const p of trackPoints) {
      const px = mapX(p.x!);
      const py = mapY(p.y!);
      const distSq = (px - mouseX) ** 2 + (py - mouseY) ** 2;
      
      if (distSq < minDistSq) {
        minDistSq = distSq;
        closest = p;
      }
    }

    // Only update if we are reasonably close to the track
    if (minDistSq < 10000) { // roughly 100px radius
      props.onHover(closest.distanceM);
    }
  };

  const handleMouseLeave = () => {
    if (props.onHover) {
      props.onHover(null);
    }
  };

  const sectorMarkers = useMemo(() => {
    const sectorTimes = [
      props.comparison.referenceLap.sectors.sector1Ms,
      props.comparison.referenceLap.sectors.sector2Ms
    ];
    const cumulativeTimes: number[] = [];
    let runningTime = 0;

    for (const sectorTime of sectorTimes) {
      if (sectorTime === null || sectorTime <= 0) break;
      runningTime += sectorTime;
      cumulativeTimes.push(runningTime);
    }

    return cumulativeTimes.map((timeOffsetMs, index) => {
      const p = props.comparison.referenceLap.points.reduce((prev, curr) => {
        return Math.abs(curr.timeOffsetMs - timeOffsetMs) < Math.abs(prev.timeOffsetMs - timeOffsetMs) ? curr : prev;
      });
      return { key: `sector-${index + 1}`, x: p.x, y: p.y, label: `S${index + 1}` };
    }).filter(marker => marker.x !== null && marker.y !== null);
  }, [props.comparison]);

  return (
    <article className="panel chart-card">
      <div className="chart-card__header">
        <div>
          <h3 className="chart-card__title">2D Track Map</h3>
          <p className="chart-subtitle">Location on track (Distance synchronized)</p>
        </div>
      </div>
      <div className="chart-card__plot" style={{ height: `${height}px`, display: "flex", justifyContent: "center" }}>
        <svg 
          viewBox={`0 0 ${width} ${height}`} 
          width="100%" 
          height="100%"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{ cursor: props.onHover ? "crosshair" : "default" }}
        >
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

          {sectorMarkers.map(marker => {
            const mx = mapX(marker.x!);
            const my = mapY(marker.y!);
            return (
              <g key={marker.key}>
                <circle cx={mx} cy={my} r={4} fill="#cf2f27" />
                <text x={mx + 8} y={my + 4} fontSize="12" fill="#cf2f27" fontWeight="bold">{marker.label}</text>
              </g>
            );
          })}
          
          {refHover && refHover.x !== null && refHover.y !== null ? (
            <circle
              cx={mapX(refHover.x)}
              cy={mapY(refHover.y)}
              r={7}
              fill="white"
              stroke="rgba(20,20,20,0.8)"
              strokeWidth={3}
              style={{ pointerEvents: "none" }}
            />
          ) : null}
        </svg>
      </div>
    </article>
  );
}

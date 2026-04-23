import type { DriverSessionSummary } from "../types";
import { formatLapTime } from "../lib/formatters";

type CleanLapPoint = {
  lapNumber: number;
  lapDuration: number;
};

export function StintPerformancePanel(props: {
  leftDriver: DriverSessionSummary;
  rightDriver: DriverSessionSummary;
}) {
  const leftSeries = getCleanLapSeries(props.leftDriver);
  const rightSeries = getCleanLapSeries(props.rightDriver);
  const allPoints = [...leftSeries, ...rightSeries];

  if (allPoints.length < 2) {
    return (
      <section className="panel analysis-panel">
        <div className="analysis-panel__header">
          <div>
            <p className="hero__eyebrow">Long-Run View</p>
            <h3 className="section-title">Stint Pace Breakdown</h3>
          </div>
        </div>
        <p className="muted">Not enough timed laps are available for a long-run or stint comparison.</p>
      </section>
    );
  }

  const width = 1120;
  const height = 280;
  const padding = { top: 16, right: 24, bottom: 44, left: 52 };
  const minLap = Math.min(...allPoints.map((point) => point.lapNumber));
  const maxLap = Math.max(...allPoints.map((point) => point.lapNumber));
  const minValue = Math.min(...allPoints.map((point) => point.lapDuration));
  const maxValue = Math.max(...allPoints.map((point) => point.lapDuration));
  const lapTicks = buildLapTicks(minLap, maxLap);

  return (
    <section className="panel analysis-panel">
      <div className="analysis-panel__header">
        <div>
          <p className="hero__eyebrow">Long-Run View</p>
          <h3 className="section-title">Stint Pace Breakdown</h3>
        </div>
        <p className="muted">
          X-axis is lap number, Y-axis is lap time. We use clean laps first, excluding pit-in and pit-out laps when possible.
        </p>
      </div>

      <div className="long-run-chart">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Stint pace chart">
          {Array.from({ length: 5 }).map((_, index) => {
            const ratio = index / 4;
            const y = padding.top + (height - padding.top - padding.bottom) * ratio;
            const labelValue = maxValue - (maxValue - minValue) * ratio;

            return (
              <g key={`grid-${index}`}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  stroke="rgba(20,20,20,0.1)"
                />
                <text
                  x={padding.left - 10}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="11"
                  fill="rgba(20,20,20,0.58)"
                >
                  {formatLapTime(labelValue)}
                </text>
              </g>
            );
          })}

          {lapTicks.map((lap) => {
            const x = mapX(lap, width, padding, minLap, maxLap);

            return (
              <g key={`lap-${lap}`}>
                <line
                  x1={x}
                  y1={padding.top}
                  x2={x}
                  y2={height - padding.bottom}
                  stroke="rgba(20,20,20,0.08)"
                />
                <text
                  x={x}
                  y={height - 14}
                  textAnchor="middle"
                  fontSize="11"
                  fill="rgba(20,20,20,0.62)"
                >
                  L{lap}
                </text>
              </g>
            );
          })}

          <line
            x1={padding.left}
            y1={height - padding.bottom}
            x2={width - padding.right}
            y2={height - padding.bottom}
            stroke="rgba(20,20,20,0.16)"
            strokeWidth={1}
          />

          <path
            d={buildLine(leftSeries, width, height, padding, minLap, maxLap, minValue, maxValue)}
            fill="none"
            stroke={props.leftDriver.teamColour ? `#${props.leftDriver.teamColour}` : "#cf2f27"}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={buildLine(rightSeries, width, height, padding, minLap, maxLap, minValue, maxValue)}
            fill="none"
            stroke={props.rightDriver.teamColour ? `#${props.rightDriver.teamColour}` : "#1d4ed8"}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="8 6"
          />
        </svg>
      </div>

      <div className="legend">
        <span className="legend__item">
          <span className="legend__swatch" style={{ background: props.leftDriver.teamColour ? `#${props.leftDriver.teamColour}` : "#cf2f27" }} />
          {props.leftDriver.acronym} clean laps
        </span>
        <span className="legend__item">
          <span className="legend__swatch" style={{ background: props.rightDriver.teamColour ? `#${props.rightDriver.teamColour}` : "#1d4ed8" }} />
          {props.rightDriver.acronym} clean laps
        </span>
      </div>

      <p className="muted">
        Each stint card shows the best clean lap, average clean lap, and degradation from the first clean lap of that stint to the last one.
      </p>

      <div className="stint-driver-grid">
        <article className="stint-driver">
          <div className="stint-driver__header">
            <h4>{props.leftDriver.acronym}</h4>
            <p>{props.leftDriver.fullName}</p>
          </div>
          <div className="stint-card-grid">
            {props.leftDriver.stints.map((stint) => {
              const stats = buildStintStats(props.leftDriver, stint.stintNumber);
              return (
                <div className="stint-card" key={stint.id}>
                  <p className="stint-card__title">{stint.compound ?? "Unknown"} stint</p>
                  <p className="stint-card__meta">L{stint.lapStart} to L{stint.lapEnd}</p>
                  <p className="stint-card__stats">
                    Best {formatLapTime(stats.bestLap)} | Avg {formatLapTime(stats.averageLap)}
                  </p>
                  <p className="stint-card__stats">
                    Degradation {formatSignedSeconds(stats.degradation)}
                  </p>
                </div>
              );
            })}
          </div>
        </article>

        <article className="stint-driver">
          <div className="stint-driver__header">
            <h4>{props.rightDriver.acronym}</h4>
            <p>{props.rightDriver.fullName}</p>
          </div>
          <div className="stint-card-grid">
            {props.rightDriver.stints.map((stint) => {
              const stats = buildStintStats(props.rightDriver, stint.stintNumber);
              return (
                <div className="stint-card" key={stint.id}>
                  <p className="stint-card__title">{stint.compound ?? "Unknown"} stint</p>
                  <p className="stint-card__meta">L{stint.lapStart} to L{stint.lapEnd}</p>
                  <p className="stint-card__stats">
                    Best {formatLapTime(stats.bestLap)} | Avg {formatLapTime(stats.averageLap)}
                  </p>
                  <p className="stint-card__stats">
                    Degradation {formatSignedSeconds(stats.degradation)}
                  </p>
                </div>
              );
            })}
          </div>
        </article>
      </div>
    </section>
  );
}

function buildLapTicks(minLap: number, maxLap: number) {
  if (minLap === maxLap) {
    return [minLap];
  }

  const range = Math.max(maxLap - minLap, 1);
  const targetTickCount = Math.min(8, range + 1);
  const step = Math.max(1, Math.ceil(range / targetTickCount));
  const ticks: number[] = [];

  for (let lap = minLap; lap <= maxLap; lap += step) {
    ticks.push(lap);
  }

  if (ticks[ticks.length - 1] !== maxLap) {
    ticks.push(maxLap);
  }

  return ticks;
}

function getCleanLapSeries(driver: DriverSessionSummary): CleanLapPoint[] {
  const cleanLaps = driver.laps
    .filter((lap) => lap.lapDuration !== null && !lap.isPitOutLap && !lap.isPitLap)
    .map((lap) => ({
      lapNumber: lap.lapNumber,
      lapDuration: lap.lapDuration as number
    }));

  return cleanLaps.length > 0
    ? cleanLaps
    : driver.laps
        .filter((lap) => lap.lapDuration !== null)
        .map((lap) => ({
          lapNumber: lap.lapNumber,
          lapDuration: lap.lapDuration as number
        }));
}

function buildLine(
  points: CleanLapPoint[],
  width: number,
  height: number,
  padding: { top: number; right: number; bottom: number; left: number },
  minLap: number,
  maxLap: number,
  minValue: number,
  maxValue: number
) {
  if (points.length === 0) {
    return "";
  }

  return points
    .map((point, index) => {
      const x = mapX(point.lapNumber, width, padding, minLap, maxLap);
      const y = mapY(point.lapDuration, height, padding, minValue, maxValue);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function mapX(
  lapNumber: number,
  width: number,
  padding: { top: number; right: number; bottom: number; left: number },
  minLap: number,
  maxLap: number
) {
  const usableWidth = width - padding.left - padding.right;
  const range = Math.max(maxLap - minLap, 1);
  return padding.left + ((lapNumber - minLap) / range) * usableWidth;
}

function mapY(
  value: number,
  height: number,
  padding: { top: number; right: number; bottom: number; left: number },
  minValue: number,
  maxValue: number
) {
  const usableHeight = height - padding.top - padding.bottom;
  const range = Math.max(maxValue - minValue, 0.001);
  const normalized = (value - minValue) / range;
  return height - padding.bottom - normalized * usableHeight;
}

function buildStintStats(driver: DriverSessionSummary, stintNumber: number) {
  const stintLaps = driver.laps
    .filter((lap) => lap.stint === stintNumber && lap.lapDuration !== null && !lap.isPitOutLap && !lap.isPitLap)
    .sort((left, right) => left.lapNumber - right.lapNumber);
  const lapDurations = stintLaps.map((lap) => lap.lapDuration as number);
  const bestLap = lapDurations.length > 0 ? Math.min(...lapDurations) : null;
  const averageLap = lapDurations.length > 0
    ? lapDurations.reduce((sum, lap) => sum + lap, 0) / lapDurations.length
    : null;
  const degradation = lapDurations.length > 1
    ? lapDurations[lapDurations.length - 1] - lapDurations[0]
    : null;

  return {
    bestLap,
    averageLap,
    degradation
  };
}

function formatSignedSeconds(seconds: number | null) {
  if (seconds === null) {
    return "N/A";
  }

  return `${seconds > 0 ? "+" : ""}${seconds.toFixed(3)} s`;
}

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { DriverSessionSummary } from "../types";
import { formatLapTime } from "../lib/formatters";
type CleanLapPoint = {
  lapNumber: number;
  lapDuration: number;
  tyreCompound?: string | null;
  tyreAge?: number | null;
};
const height = 350;
const padding = { top: 42, right: 24, bottom: 100, left: 58 };
const colours = ["#cf2f27", "#1d658a"];
const tyreColour: Record<string, string> = {
  SOFT: "#d4483e",
  MEDIUM: "#e2b640",
  HARD: "#d8d3cb",
  INTERMEDIATE: "#5a9b68",
  WET: "#548eb6",
};
export function StintPerformancePanel({
  leftDriver,
  rightDriver,
}: {
  leftDriver: DriverSessionSummary;
  rightDriver: DriverSessionSummary;
}) {
  const [hoverLap, setHoverLap] = useState<number | null>(null);
  const [width, setWidth] = useState(1000);
  const plot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!plot.current) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(280, Math.round(entries[0].contentRect.width))),
    );
    observer.observe(plot.current);
    return () => observer.disconnect();
  }, []);
  const drivers = useMemo(
    () => [leftDriver, rightDriver],
    [leftDriver, rightDriver],
  );
  const geometry = useMemo(() => {
    const series = drivers.map(getCleanLapSeries);
    const all = series.flat();
    const lapNumbers = drivers.flatMap((driver) =>
      driver.laps.map((lap) => lap.lapNumber),
    );
    const minLap = Math.min(...lapNumbers, 1),
      maxLap = Math.max(...lapNumbers, 1);
    const minValue = all.length
      ? Math.min(...all.map((p) => p.lapDuration))
      : 0;
    const maxValue = all.length
      ? Math.max(...all.map((p) => p.lapDuration))
      : 1;
    const ticks: number[] = [];
    const step = Math.max(
      1,
      Math.ceil(
        (maxLap - minLap) /
          Math.max(2, Math.floor((width - padding.left - padding.right) / 90)),
      ),
    );
    for (let lap = minLap; lap <= maxLap; lap += step) ticks.push(lap);
    if (ticks.at(-1) !== maxLap) {
      if (ticks.length > 1 && maxLap - ticks[ticks.length - 1] < step * 0.6)
        ticks.pop();
      ticks.push(maxLap);
    }
    return {
      series,
      minLap,
      maxLap,
      minValue,
      maxValue,
      ticks,
      paths: series.map((points) =>
        buildLine(
          points,
          width,
          height,
          padding,
          minLap,
          maxLap,
          minValue,
          maxValue,
        ),
      ),
      byLap: series.map(
        (points) => new Map(points.map((p) => [p.lapNumber, p])),
      ),
      stints: drivers.map((driver) =>
        driver.stints.map((stint) => ({
          ...stint,
          ...buildStintStats(driver, stint.stintNumber),
        })),
      ),
    };
  }, [drivers, width]);
  const { minLap, maxLap, minValue, maxValue } = geometry;
  const x = (lap: number) => mapX(lap, width, padding, minLap, maxLap);
  const y = (time: number) => mapY(time, height, padding, minValue, maxValue);
  function move(event: PointerEvent<SVGSVGElement>) {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    setHoverLap(
      point.x >= padding.left && point.x <= width - padding.right
        ? Math.max(
            minLap,
            Math.min(
              maxLap,
              Math.round(
                minLap +
                  ((point.x - padding.left) /
                    (width - padding.left - padding.right)) *
                    Math.max(1, maxLap - minLap),
              ),
            ),
          )
        : null,
    );
  }
  return (
    <section className="panel analysis-panel">
      <div className="analysis-panel__header">
        <div>
          <p className="eyebrow">WHOLE RACE</p>
          <h3>Lap times & tyre stints</h3>
        </div>
        <p className="muted">
          Pit-in, pit-out and untimed laps create gaps. Pit markers show
          recorded stops; tyre bands show stint ranges.
        </p>
      </div>
      <div className="long-run-chart" ref={plot}>
        <svg
          viewBox={"0 0 " + width + " " + height}
          role="img"
          aria-label="Stint pace chart with pit stops and tyre compounds"
          onPointerMove={move}
          onPointerLeave={() => setHoverLap(null)}
        >
          {[0, 1, 2, 3, 4].map((i) => {
            const value = maxValue - ((maxValue - minValue) * i) / 4;
            return (
              <g key={i}>
                <line
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y(value)}
                  y2={y(value)}
                  stroke="#ddd2c4"
                />
                <text
                  x={padding.left - 8}
                  y={y(value) + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="#73695f"
                >
                  {formatLapTime(value)}
                </text>
              </g>
            );
          })}
          {geometry.ticks.map((lap) => (
            <g key={lap}>
              <line
                x1={x(lap)}
                x2={x(lap)}
                y1={padding.top}
                y2={height - padding.bottom}
                stroke="#e8dfd3"
              />
              <text
                x={x(lap)}
                y={height - padding.bottom + 20}
                textAnchor="middle"
                fontSize={11}
                fill="#73695f"
              >
                L{lap}
              </text>
            </g>
          ))}
          {drivers.map((driver, side) => (
            <g key={side}>
              {driver.pitStops
                .filter(
                  (pit) =>
                    pit.lapNumber !== null &&
                    pit.lapNumber >= minLap &&
                    pit.lapNumber <= maxLap,
                )
                .map((pit) => (
                  <g key={pit.id}>
                    <title>
                      {driver.acronym + " pit stop on lap " + pit.lapNumber}
                    </title>
                    <line
                      x1={x(pit.lapNumber!)}
                      x2={x(pit.lapNumber!)}
                      y1={padding.top}
                      y2={height - padding.bottom}
                      stroke={colours[side]}
                      strokeOpacity={0.5}
                      strokeDasharray="3 5"
                    />
                    <text
                      x={x(pit.lapNumber!)}
                      y={14 + side * 17}
                      textAnchor="middle"
                      fontSize={10}
                      fill={colours[side]}
                    >
                      {driver.acronym + " PIT"}
                    </text>
                  </g>
                ))}
              <path
                d={geometry.paths[side]}
                fill="none"
                stroke={colours[side]}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeDasharray={side === 1 ? "8 5" : undefined}
              />
              <text
                x={0}
                y={height - 43 + side * 25}
                fill={colours[side]}
                fontSize={11}
              >
                {driver.acronym}
              </text>
              {driver.stints.map((stint) => {
                const start = x(Math.max(minLap, stint.lapStart - 0.5)),
                  end = x(Math.min(maxLap, stint.lapEnd + 0.5));
                return (
                  <g key={stint.id}>
                    <title>
                      {driver.acronym +
                        " stint " +
                        stint.stintNumber +
                        ": " +
                        (stint.compound ?? "Unknown") +
                        ", L" +
                        stint.lapStart +
                        "–" +
                        stint.lapEnd}
                    </title>
                    <rect
                      x={start}
                      y={height - 55 + side * 25}
                      width={Math.max(0, end - start - 2)}
                      height={18}
                      rx={3}
                      fill={tyreColour[stint.compound ?? ""] ?? "#bba58c"}
                    />
                    {end - start > 45 && (
                      <text
                        x={(start + end) / 2}
                        y={height - 42 + side * 25}
                        textAnchor="middle"
                        fill="#211e1a"
                        fontSize={10}
                      >
                        {stint.compound ?? "?"}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          ))}
          {hoverLap !== null && (
            <g>
              <line
                x1={x(hoverLap)}
                x2={x(hoverLap)}
                y1={padding.top}
                y2={height - padding.bottom}
                stroke="#73695f"
                strokeDasharray="4 4"
              />
              {geometry.byLap.map((points, side) => {
                const point = points.get(hoverLap);
                return (
                  point && (
                    <circle
                      key={side}
                      cx={x(hoverLap)}
                      cy={y(point.lapDuration)}
                      r={4}
                      fill={colours[side]}
                      stroke="white"
                    />
                  )
                );
              })}
            </g>
          )}
        </svg>
      </div>
      <div className="long-run-legend">
        {drivers.map((driver, side) => (
          <span key={side}>
            <i
              className={
                "trace-dot trace-dot--" + (side ? "target" : "reference")
              }
            />
            {driver.acronym}
            {side ? " · dashed" : ""}
            {hoverLap !== null
              ? " · L" +
                hoverLap +
                ": " +
                (geometry.byLap[side].has(hoverLap)
                  ? formatLapTime(
                      geometry.byLap[side].get(hoverLap)!.lapDuration,
                    )
                  : "excluded / unavailable")
              : ""}
          </span>
        ))}
      </div>
      <p className="muted">
        Pit stops:{" "}
        {drivers
          .map(
            (driver) =>
              driver.acronym +
              " " +
              (driver.pitStops.length
                ? driver.pitStops
                    .map((pit) =>
                      pit.lapNumber === null
                        ? "lap unavailable"
                        : "L" + pit.lapNumber,
                    )
                    .join(", ")
                : "none recorded"),
          )
          .join(" · ")}
      </p>
      {geometry.series.flat().length < 2 && (
        <p className="muted">
          Not enough eligible timed laps to assess race pace.
        </p>
      )}
      <details className="stint-method">
        <summary>How to read this analysis</summary>
        <p className="muted">
          Lap times exclude pit-in, pit-out and untimed laps. First-to-last
          change is descriptive: fuel, traffic, flags and track evolution are
          not corrected. Tyre bands come from recorded stint ranges; a missing
          timing sample is not necessarily a pit stop.
        </p>
      </details>
      <div className="stint-driver-grid">
        {drivers.map((driver, side) => (
          <article className="stint-driver" key={side}>
            <div className="stint-driver__header">
              <h4>{driver.acronym}</h4>
              <p>{driver.fullName}</p>
            </div>
            <div className="stint-card-grid">
              {geometry.stints[side].map((stint) => (
                <div className="stint-card" key={stint.id}>
                  <p className="stint-card__title">
                    {stint.compound ?? "Unknown"} · stint {stint.stintNumber}
                  </p>
                  <p className="stint-card__meta">
                    L{stint.lapStart} to L{stint.lapEnd}
                  </p>
                  <p className="stint-card__stats">
                    Best {formatLapTime(stint.bestLap)} · Avg{" "}
                    {formatLapTime(stint.averageLap)}
                  </p>
                  <p className="stint-card__stats">
                    Last − first: {formatSignedSeconds(stint.degradation)}
                  </p>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
function getCleanLapSeries(driver: DriverSessionSummary): CleanLapPoint[] {
  const cleanLaps = driver.laps
    .filter(
      (lap) =>
        lap.lapDuration !== null &&
        lap.lapDuration > 0 &&
        !lap.isPitOutLap &&
        !lap.isPitLap,
    )
    .sort((a, b) => a.lapNumber - b.lapNumber)
    .map((lap) => ({
      lapNumber: lap.lapNumber,
      lapDuration: lap.lapDuration as number,
      tyreCompound: lap.tyreCompound,
      tyreAge: lap.tyreAge,
    }));

  return cleanLaps;
}

function buildLine(
  points: CleanLapPoint[],
  width: number,
  height: number,
  padding: { top: number; right: number; bottom: number; left: number },
  minLap: number,
  maxLap: number,
  minValue: number,
  maxValue: number,
) {
  if (points.length === 0) {
    return "";
  }

  return points
    .map((point, index) => {
      const x = mapX(point.lapNumber, width, padding, minLap, maxLap);
      const y = mapY(point.lapDuration, height, padding, minValue, maxValue);
      return `${index === 0 || point.lapNumber !== points[index - 1].lapNumber + 1 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function mapX(
  lapNumber: number,
  width: number,
  padding: { top: number; right: number; bottom: number; left: number },
  minLap: number,
  maxLap: number,
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
  maxValue: number,
) {
  const usableHeight = height - padding.top - padding.bottom;
  const range = Math.max(maxValue - minValue, 0.001);
  const normalized = (value - minValue) / range;
  return height - padding.bottom - normalized * usableHeight;
}

function buildStintStats(driver: DriverSessionSummary, stintNumber: number) {
  const stintLaps = driver.laps
    .filter(
      (lap) =>
        lap.stint === stintNumber &&
        lap.lapDuration !== null &&
        lap.lapDuration > 0 &&
        !lap.isPitOutLap &&
        !lap.isPitLap,
    )
    .sort((left, right) => left.lapNumber - right.lapNumber);
  const lapDurations = stintLaps.map((lap) => lap.lapDuration as number);
  const bestLap = lapDurations.length > 0 ? Math.min(...lapDurations) : null;
  const averageLap =
    lapDurations.length > 0
      ? lapDurations.reduce((sum, lap) => sum + lap, 0) / lapDurations.length
      : null;
  const degradation =
    lapDurations.length > 1
      ? lapDurations[lapDurations.length - 1] - lapDurations[0]
      : null;

  return {
    bestLap,
    averageLap,
    degradation,
  };
}

function formatSignedSeconds(seconds: number | null) {
  if (seconds === null) {
    return "N/A";
  }

  return `${seconds > 0 ? "+" : ""}${seconds.toFixed(3)} s`;
}

import type { DriverSessionSummary } from "../types";
import { formatClockTime, formatLapTime } from "../lib/formatters";

export function DriverSummaryCard(props: {
  sideLabel: string;
  driver: DriverSessionSummary;
  sessionType: string | null;
}) {
  return (
    <article className="panel driver-card">
      <p className="driver-card__side">{props.sideLabel}</p>
      <div className="driver-card__header">
        <div>
          <p className="driver-card__team">{props.driver.teamName}</p>
          <h3>{props.driver.fullName}</h3>
          <p className="driver-card__meta">
            #{props.driver.driverNumber} • {props.driver.acronym}
          </p>
        </div>
        <div className={`driver-card__status driver-card__status--${props.driver.result.status}`}>
          {props.driver.result.classificationLabel}
        </div>
      </div>

      <div className="driver-stat-grid">
        <div className="driver-stat">
          <span>Best lap</span>
          <strong>
            {formatLapTime(props.driver.stats.bestLapSeconds)}
            {props.driver.stats.bestLapSeconds ? 
              (() => {
                const bestLapObj = props.driver.laps.find(l => l.lapDuration === props.driver.stats.bestLapSeconds);
                return bestLapObj ? ` (L${bestLapObj.lapNumber})` : "";
              })() : ""}
          </strong>
        </div>
        <div className="driver-stat">
          <span>Average lap</span>
          <strong>{formatLapTime(props.driver.stats.averageLapSeconds)}</strong>
        </div>
        <div className="driver-stat">
          <span>{props.sessionType === "Race" ? "Laps finished" : "Timed laps"}</span>
          <strong>
            {props.driver.result.numberOfLaps ?? props.driver.stats.timedLaps}
          </strong>
        </div>
        <div className="driver-stat">
          <span>Pit stops</span>
          <strong>{props.driver.stats.pitStopCount}</strong>
        </div>
      </div>

      <div className="driver-card__detail-grid">
        <div>
          <p className="driver-card__detail-label">Official time</p>
          <p className="driver-card__detail-value">
            {props.driver.result.officialDurationText ?? "N/A"}
          </p>
        </div>
        <div>
          <p className="driver-card__detail-label">Gap to leader</p>
          <p className="driver-card__detail-value">
            {props.driver.result.gapToLeaderText ?? "N/A"}
          </p>
        </div>
        <div>
          <p className="driver-card__detail-label">Points</p>
          <p className="driver-card__detail-value">
            {props.driver.result.points ?? "—"}
          </p>
        </div>
        <div>
          <p className="driver-card__detail-label">Cached telemetry laps</p>
          <p className="driver-card__detail-value">
            {props.driver.stats.telemetryCachedLaps}
          </p>
        </div>
      </div>

      <div className="driver-card__pit-block">
        <p className="driver-card__detail-label">Tire Strategy</p>
        {props.driver.stints && props.driver.stints.length > 0 ? (
          <div className="strategy-list">
            {props.driver.stints.map((stint, idx) => (
              <span key={stint.id}>
                {stint.compound ?? "UNKNOWN"} ({stint.lapEnd - stint.lapStart + 1} laps)
                {idx < props.driver.stints.length - 1 ? " ➔ " : ""}
              </span>
            ))}
          </div>
        ) : (
          <p className="driver-card__pit-empty">No strategy data available.</p>
        )}
      </div>

      <div className="driver-card__pit-block">
        <p className="driver-card__detail-label">Pit stop timeline</p>
        {props.driver.pitStops.length > 0 ? (
          <ul className="pit-list">
            {props.driver.pitStops.map((pitStop) => (
              <li key={pitStop.id}>
                <strong>Lap {pitStop.lapNumber ?? "?"}</strong>
                <span>
                  {formatClockTime(pitStop.date)}
                  {pitStop.stopDuration !== null ? ` • stop ${pitStop.stopDuration.toFixed(1)}s` : ""}
                  {pitStop.laneDuration !== null ? ` • lane ${pitStop.laneDuration.toFixed(1)}s` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="driver-card__pit-empty">
            No pit stops recorded for this driver in the selected session.
          </p>
        )}
      </div>
    </article>
  );
}

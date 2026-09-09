import { formatDelta } from "../lib/formatters";
import type { ComparisonResponse } from "../types";

export function CornerAnalysisPanel(props: { comparison: ComparisonResponse }) {
  const { comparison } = props;
  const corners = comparison.cornerAnalysis.corners;

  if (corners.length === 0) {
    return (
      <section className="panel analysis-panel">
        <div className="analysis-panel__header">
          <div>
            <p className="hero__eyebrow">Braking Points</p>
            <h3 className="section-title">Braking-Zone Comparison</h3>
            <p className="muted">
              Delta = left minus right. Positive means the left lap loses time.
            </p>
          </div>
        </div>
        <p className="muted">
          Not enough braking windows were detected for a zone-by-zone breakdown.
        </p>
      </section>
    );
  }

  return (
    <section className="panel analysis-panel">
      <div className="analysis-panel__header">
        <div>
          <p className="hero__eyebrow">Braking Points</p>
          <h3 className="section-title">Braking-Zone Comparison</h3>
        </div>
        <div className="analysis-summary">
          <span className="analysis-summary__pill">
            {comparison.cornerAnalysis.summary.referenceBetterCorners} zones for{" "}
            {comparison.referenceLap.driver.acronym +
              " L" +
              comparison.referenceLap.lapNumber}
          </span>
          <span className="analysis-summary__pill">
            {comparison.cornerAnalysis.summary.targetBetterCorners} zones for{" "}
            {comparison.targetLap.driver.acronym +
              " L" +
              comparison.targetLap.lapNumber}
          </span>
        </div>
      </div>

      <div className="corner-grid">
        {corners.map((corner) => {
          const phaseClass =
            corner.fasterDriver ===
            comparison.targetLap.driver.acronym +
              " L" +
              comparison.targetLap.lapNumber
              ? "corner-card__delta--gain"
              : corner.fasterDriver ===
                  comparison.referenceLap.driver.acronym +
                    " L" +
                    comparison.referenceLap.lapNumber
                ? "corner-card__delta--loss"
                : "corner-card__delta--even";

          return (
            <article className="corner-card" key={corner.key}>
              <div className="corner-card__header">
                <div>
                  <h4>{corner.label}</h4>
                  <p className="muted">
                    {Math.round(corner.distanceM)} m braking marker
                  </p>
                </div>
                <div className={`corner-card__delta ${phaseClass}`}>
                  {corner.fasterDriver === "Even"
                    ? "Even"
                    : `${corner.fasterDriver} quicker by ${(Math.abs(corner.phaseDeltaMs) / 1000).toFixed(3)} s`}
                </div>
              </div>

              <div className="corner-card__drivers">
                <div className="corner-driver corner-driver--reference">
                  <p className="corner-driver__label">
                    {comparison.referenceLap.driver.acronym +
                      " L" +
                      comparison.referenceLap.lapNumber}
                  </p>
                  <p className="corner-driver__stats">
                    Speed (km/h): Entry{" "}
                    {Math.round(corner.reference.entrySpeedKph)} | Apex{" "}
                    {Math.round(corner.reference.apexSpeedKph)} | Exit{" "}
                    {Math.round(corner.reference.exitSpeedKph)}
                  </p>
                  <p className="corner-driver__meta">
                    Throttle exit{" "}
                    {Math.round(corner.reference.throttleAtExitPct)}%
                  </p>
                </div>
                <div className="corner-driver corner-driver--target">
                  <p className="corner-driver__label">
                    {comparison.targetLap.driver.acronym +
                      " L" +
                      comparison.targetLap.lapNumber}
                  </p>
                  <p className="corner-driver__stats">
                    Speed (km/h): Entry{" "}
                    {Math.round(corner.target.entrySpeedKph)} | Apex{" "}
                    {Math.round(corner.target.apexSpeedKph)} | Exit{" "}
                    {Math.round(corner.target.exitSpeedKph)}
                  </p>
                  <p className="corner-driver__meta">
                    Throttle exit {Math.round(corner.target.throttleAtExitPct)}%
                  </p>
                </div>
              </div>

              <div className="corner-card__footer">
                <span>Entry delta {formatDelta(corner.entryDeltaMs)}</span>
                <span>Apex delta {formatDelta(corner.apexDeltaMs)}</span>
                <span>Exit delta {formatDelta(corner.exitDeltaMs)}</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

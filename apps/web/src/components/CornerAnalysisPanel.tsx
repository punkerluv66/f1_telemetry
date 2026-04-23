import { formatDelta } from "../lib/formatters";
import type { ComparisonResponse } from "../types";

export function CornerAnalysisPanel(props: {
  comparison: ComparisonResponse;
}) {
  const { comparison } = props;
  const corners = comparison.cornerAnalysis.corners;

  if (corners.length === 0) {
    return (
      <section className="panel analysis-panel">
        <div className="analysis-panel__header">
          <div>
            <p className="hero__eyebrow">Braking Points</p>
            <h3 className="section-title">Braking-Zone Comparison</h3>
          </div>
        </div>
        <p className="muted">Not enough braking windows were detected for a corner-by-corner breakdown.</p>
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
            {comparison.cornerAnalysis.summary.referenceBetterCorners} corners for {comparison.referenceLap.driver.acronym}
          </span>
          <span className="analysis-summary__pill">
            {comparison.cornerAnalysis.summary.targetBetterCorners} corners for {comparison.targetLap.driver.acronym}
          </span>
        </div>
      </div>

      <div className="corner-grid">
        {corners.map((corner) => {
          const phaseClass =
            corner.fasterDriver === comparison.targetLap.driver.acronym
              ? "corner-card__delta--gain"
              : corner.fasterDriver === comparison.referenceLap.driver.acronym
                ? "corner-card__delta--loss"
                : "corner-card__delta--even";

          return (
            <article className="corner-card" key={corner.key}>
              <div className="corner-card__header">
                <div>
                  <h4>{corner.label}</h4>
                  <p className="muted">
                    {Math.round(corner.distanceM)} m apex window
                  </p>
                </div>
                <div className={`corner-card__delta ${phaseClass}`}>
                  {corner.fasterDriver === "Even" ? "Even" : `${corner.fasterDriver} ${formatDelta(corner.phaseDeltaMs)}`}
                </div>
              </div>

              <div className="corner-card__drivers">
                <div className="corner-driver corner-driver--reference">
                  <p className="corner-driver__label">{comparison.referenceLap.driver.acronym}</p>
                  <p className="corner-driver__stats">
                    Speed (km/h): Entry {Math.round(corner.reference.entrySpeedKph)} | Apex {Math.round(corner.reference.apexSpeedKph)} | Exit {Math.round(corner.reference.exitSpeedKph)}
                  </p>
                  <p className="corner-driver__meta">
                    Brake {Math.round(corner.reference.peakBrakePct)}% | Throttle exit {Math.round(corner.reference.throttleAtExitPct)}%
                  </p>
                </div>
                <div className="corner-driver corner-driver--target">
                  <p className="corner-driver__label">{comparison.targetLap.driver.acronym}</p>
                  <p className="corner-driver__stats">
                    Speed (km/h): Entry {Math.round(corner.target.entrySpeedKph)} | Apex {Math.round(corner.target.apexSpeedKph)} | Exit {Math.round(corner.target.exitSpeedKph)}
                  </p>
                  <p className="corner-driver__meta">
                    Brake {Math.round(corner.target.peakBrakePct)}% | Throttle exit {Math.round(corner.target.throttleAtExitPct)}%
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

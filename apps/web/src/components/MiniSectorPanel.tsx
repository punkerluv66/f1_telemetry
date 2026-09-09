import type { ComparisonResponse } from "../types";
import { formatDelta } from "../lib/formatters";

export function MiniSectorPanel({
  comparison,
  selected,
  onSelect,
}: {
  comparison: ComparisonResponse;
  selected: number | null;
  onSelect: (number: number | null) => void;
}) {
  const section = comparison.miniSectors.find(
    (item) => item.number === selected,
  );
  const left =
    comparison.referenceLap.driver.acronym +
    " L" +
    comparison.referenceLap.lapNumber;
  const right =
    comparison.targetLap.driver.acronym + " L" + comparison.targetLap.lapNumber;
  return (
    <section className="panel mini-panel" aria-label="Mini-sector analysis">
      <div className="mini-heading">
        <div>
          <p className="eyebrow">WHERE TIME CHANGES</p>
          <h3>Mini-sectors</h3>
        </div>
        <div className="mini-legend">
          <span>
            <i className="trace-dot trace-dot--reference" />
            {left} quicker
          </span>
          <span>
            <i className="trace-dot trace-dot--target" />
            {right} quicker
          </span>
          <span>
            <i className="trace-dot trace-dot--even" />
            Even
          </span>
        </div>
      </div>
      <div className="mini-strip">
        {comparison.miniSectors.map((sector) => (
          <button
            type="button"
            key={sector.number}
            className={"mini-cell mini-cell--" + sector.winner}
            aria-pressed={selected === sector.number}
            aria-label={
              "Mini-sector " +
              sector.number +
              ", " +
              Math.round(sector.startDistanceM) +
              " to " +
              Math.round(sector.endDistanceM) +
              " metres, left minus right " +
              formatDelta(sector.deltaMs)
            }
            title={"M" + sector.number + ": " + formatDelta(sector.deltaMs)}
            onClick={() =>
              onSelect(selected === sector.number ? null : sector.number)
            }
          >
            {String(sector.number).padStart(2, "0")}
          </button>
        ))}
      </div>
      {section ? (
        <div className="mini-detail" aria-live="polite">
          <strong>
            M{section.number} · {Math.round(section.startDistanceM)}–
            {Math.round(section.endDistanceM)} m
          </strong>
          <span>
            {left}: {(section.referenceMs / 1000).toFixed(3)} s
          </span>
          <span>
            {right}: {(section.targetMs / 1000).toFixed(3)} s
          </span>
          <strong>Δ {formatDelta(section.deltaMs)}</strong>
          <span className="mini-outcome">
            {section.winner === "even"
              ? "Effectively matched"
              : (section.deltaMs > 0 ? left + " loses " : left + " gains ") +
                (Math.abs(section.deltaMs) / 1000).toFixed(3) +
                " s here"}
          </span>
          <button
            type="button"
            className="text-button"
            onClick={() => onSelect(null)}
          >
            Clear selection
          </button>
        </div>
      ) : (
        <p className="muted mini-help">
          20 equal-distance sections, estimated from telemetry.{" "}
          {comparison.quality.sectorAlignment.mode === "sector-anchored"
            ? "Aligned to official sector timing; times within sectors remain approximate. "
            : "Official sector alignment unavailable; only lap boundaries are anchored. "}
          Select a section
          to inspect its time difference.
        </p>
      )}
    </section>
  );
}
